/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "1. 감리원 일정 현황표" PPT 생성
 * (이 파일은 새로 추가된 파일이며, 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식
 * 방법은 src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 첨부 템플릿(표 1개, [제목][대상사업명][주관기관] + 이름별 반복 그룹 [이름][감리구분][단계][시작일][종료일])을
 * 해당 사업에 투입된 "감리원"(member_type = '감리원') 인력만으로 채웁니다.
 * 전문가/테스터는 포함하지 않습니다 (2026-09-01 사용자 확인: 이 표는 감리원 전용).
 *
 * 필드 매핑:
 *   [제목]        고정 문자열 "감리원 일정 현황표"
 *   [대상사업명]   audit_projects.target_project_name
 *   [주관기관]     audit_projects.client_org
 *   [감리사업명]   audit_projects.project_name (레이아웃 브레드크럼 — 공유 파트에서 치환)
 *   [이름]        audit_phase_assignments.person_name (member_type='감리원'만)
 *   [감리구분]     아래 규칙:
 *                   - 단계명이 "검수지원"(공백 무시)이면 → "검수지원"
 *                   - 그 외 단계는 클라이언트가 넘긴 additionalPhaseIds에 포함되면 → "추가", 아니면 → "정기"
 *                   ("추가/정기" 여부는 PPT 생성 모달에서 사용자가 단계별로 체크하는 값 — 프로젝트마다 다름)
 *   [시작일] ~ [종료일] 아래 규칙:
 *                   - 단계명이 "검수지원"이면 → "사업종료시점" (실제 방문일이 사업 종료 시점에 맞춰
 *                     유동적으로 잡히므로 날짜를 못박지 않음)
 *                   - 그 외에는 phase_start_date~phase_end_date를 "YYYY.MM.DD ~ YYYY.MM.DD"로 포맷
 *
 * 표의 실제 행 개수(인원×일정 수)는 사업마다 다르므로, src/lib/pptx-table-rows.ts 의
 * expandScheduleTable()이 템플릿의 첫 행/이어지는 행 서식을 그대로 복제해서 늘립니다.
 * 폰트/색/테두리 등 스타일은 이 파일에 전혀 하드코딩하지 않고 템플릿 그대로 유지됩니다.
 *
 * 핵심 로직은 buildScheduleZip()으로 분리돼 있어서, 이 라우트(단독 다운로드)뿐 아니라
 * "첨부 PPT 묶음 생성"(ppt-attachment-bundle.ts)에서도 그대로 재사용합니다.
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장 없음).
 *
 * POST /api/ppt-schedule/:projectId
 *   multipart/form-data:
 *     - template: File (.pptx)
 *     - additionalPhaseIds: JSON 배열 문자열 (예: "[3,4]") — "추가" 단계로 표시할 phase_id 목록. 생략 가능(= 전부 정기).
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { query, queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { planScheduleSlides, expandScheduleTable, type ScheduleGroup } from '../lib/pptx-table-rows.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'

const app = new Hono()

const PAGE_TITLE = '감리원 일정 현황표'
const PROJECT_END_PHASES = new Set(['검수지원'])

interface AssignmentRow {
  person_name: string
  phase_id: number
  phase_name: string
  phase_start_date: string | null
  phase_end_date: string | null
}

export interface ScheduleZipResult {
  zip: JSZip
  auditorCount: number
  pageCount: number
  projectName: string
}

function isProjectEndPhase(phaseName: string): boolean {
  return PROJECT_END_PHASES.has(phaseName.replace(/\s+/g, ''))
}

function fmtDate(d: string | null): string {
  return d ? d.replace(/-/g, '.') : ''
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("1. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildScheduleZip(
  templateBuf: Buffer,
  projectId: number,
  additionalPhaseIds: number[],
  titlePrefix = ''
): Promise<ScheduleZipResult> {
  const additionalSet = new Set(additionalPhaseIds)

  const project = await queryOne<Record<string, unknown>>(
    `SELECT project_name, client_org, target_project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const assignments = await query<AssignmentRow>(
    `SELECT a.person_name, ph.id AS phase_id, ph.phase_name, ph.phase_start_date, ph.phase_end_date
     FROM audit_phase_assignments a
     JOIN audit_phases ph ON ph.id = a.phase_id
     WHERE a.project_id = $1 AND a.member_type = '감리원'
     ORDER BY a.person_name, ph.phase_start_date`,
    [projectId]
  )
  if (!assignments.length) throw new Error('이 사업에 등록된 감리원 일정이 없습니다')

  // ── person_name 가나다순 그룹핑, 그룹 내부는 이미 phase_start_date 순 ─────
  const byName = new Map<string, AssignmentRow[]>()
  for (const a of assignments) {
    if (!byName.has(a.person_name)) byName.set(a.person_name, [])
    byName.get(a.person_name)!.push(a)
  }
  const groups: ScheduleGroup[] = [...byName.keys()]
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .map(name => ({
      name,
      entries: byName.get(name)!.map(a => {
        const endPhase = isProjectEndPhase(a.phase_name)
        return {
          label: endPhase ? '검수지원' : additionalSet.has(a.phase_id) ? '추가' : '정기',
          phase: a.phase_name,
          schedule: endPhase ? '사업종료시점' : `${fmtDate(a.phase_start_date)} ~ ${fmtDate(a.phase_end_date)}`,
        }
      }),
    }))

  // ── 사업 공통 필드 ─────────────────────────────────────────────
  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[대상사업명]': String(project.target_project_name ?? ''),
    '[주관기관]': String(project.client_org ?? ''),
    '[감리사업명]': String(project.project_name ?? ''),
  }

  const zip = await JSZip.loadAsync(templateBuf)

  // 레이아웃/마스터의 브레드크럼([감리사업명] 등)도 공통값으로 한 번 치환
  const sharedPartNames = Object.keys(zip.files).filter(
    f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
  )
  for (const partName of sharedPartNames) {
    const partXml = await zip.file(partName)!.async('string')
    const patched = applyPlaceholderMap(partXml, commonMap)
    if (patched !== partXml) zip.file(partName, patched)
  }

  const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  let expandedAny = false
  let pageCount = 1
  for (const name of slideFiles) {
    const rawXml = await zip.files[name].async('string')
    const withCommon = applyPlaceholderMap(rawXml, commonMap)

    const pages = planScheduleSlides(withCommon, groups)
    if (pages === null) {
      zip.file(name, withCommon) // 이 슬라이드는 일정 표가 아님 — 공통값 치환만 반영
      continue
    }
    expandedAny = true

    if (pages.length <= 1) {
      const expanded = expandScheduleTable(withCommon, groups, pages[0]?.dataRowH)
      zip.file(name, expanded ?? withCommon)
      continue
    }

    // ── 한 페이지에 안 들어가서 여러 슬라이드로 나눠야 하는 경우 ──────────
    // buildMultiSlideDeck은 "템플릿 슬라이드 1장 → N장"으로 재구성하므로,
    // 이 템플릿이 슬라이드 1장짜리일 때만 안전하게 적용할 수 있다.
    if (slideFiles.length !== 1) {
      throw new Error('일정 표가 있는 템플릿에 슬라이드가 여러 장 있어 페이지 분할을 적용할 수 없습니다 (표 슬라이드 1장짜리 템플릿만 지원)')
    }
    pageCount = pages.length
    await buildMultiSlideDeck(
      zip,
      (tplSlideXml, page: { groups: ScheduleGroup[]; dataRowH: number; pageIndex: number }) => {
        const pageMap = { ...commonMap, '[제목]': `${titlePrefix}${PAGE_TITLE} (${page.pageIndex + 1}/${pageCount})` }
        const patched = applyPlaceholderMap(tplSlideXml, pageMap)
        const out = expandScheduleTable(patched, page.groups, page.dataRowH)
        if (out === null) throw new Error('페이지 확장 중 표 구조를 다시 찾지 못했습니다')
        return out
      },
      pages.map((p, i) => ({ ...p, pageIndex: i }))
    )
  }
  if (!expandedAny) {
    throw new Error('템플릿에서 감리원 일정 표를 찾지 못했습니다 (헤더 "감리원명/감리 구분/단계 구분/일정" 확인 필요)')
  }

  return { zip, auditorCount: groups.length, pageCount, projectName: String(project.project_name ?? 'proposal') }
}

app.post('/:projectId', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'))
    if (!projectId) return c.json({ ok: false, error: 'projectId가 필요합니다' }, 400)

    const contentType = c.req.header('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ ok: false, error: 'multipart/form-data 로 template 파일을 보내주세요' }, 400)
    }
    const form = await c.req.formData()
    const file = form.get('template') as File | null
    if (!file || file.size === 0) {
      return c.json({ ok: false, error: '첨부 템플릿(.pptx) 파일이 필요합니다' }, 400)
    }

    let additionalPhaseIds: number[] = []
    const rawIds = form.get('additionalPhaseIds')
    if (typeof rawIds === 'string' && rawIds.trim()) {
      try {
        const parsed = JSON.parse(rawIds)
        if (Array.isArray(parsed)) additionalPhaseIds = parsed.map(Number).filter(n => !Number.isNaN(n))
      } catch {
        return c.json({ ok: false, error: 'additionalPhaseIds는 JSON 배열이어야 합니다' }, 400)
      }
    }

    const templateBuf = Buffer.from(await file.arrayBuffer())
    const { zip, auditorCount, pageCount, projectName } = await buildScheduleZip(templateBuf, projectId, additionalPhaseIds)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('1_감리원일정현황표_' + safeName)}.pptx"`)
    c.header('X-Auditor-Count', String(auditorCount))
    c.header('X-Page-Count', String(pageCount))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-schedule] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
