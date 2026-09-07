/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "상근감리원인력현황" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 다른 항목들과 달리 "이미지 한 장 박아넣기"가 아니라 실제 편집 가능한 파워포인트 표를
 * 채운다 — 사용자가 나중에 표 내용을 직접 수정할 수 있어야 하기 때문(2026-09-04 사용자
 * 확인: "수정할 수 있도록 표로 넣어야 해"). 그래서 NAS의 표준재무제표류가 쓰는
 * "범용(도장X)" 이미지 템플릿이 아니라, 감리원 일정 현황표/투입 감리원별 실적 및 경력과
 * 같은 "실제 표가 들어있는" 전용 템플릿을 쓴다.
 *
 * 데이터 출처: NAS "07.상근인력보유현황" 폴더의 "상근인력현황_날짜.xlsx"(괄호 접미사 없는
 * 것, 파일이름 기준 최신 — src/lib/nas-client.ts의 fetchStaffingStatusXlsx) 안 "상근인력현황"
 * 시트. A~H열(번호/이름/직위/주요경력/자격증/감리경력(년)/감리참여 건수/참여여부) 중
 * I열(구분)이 "감리원" 또는 "수석감리원"인 행만 걸러서 쓴다(2026-09-04 사용자 확인).
 * 번호(A열)는 원본 값을 안 쓰고 필터링 후 순서대로 새로 1부터 매긴다.
 *
 * 템플릿의 표 구조(2026-09-04 실측):
 *   헤더 행 다음에 데이터 행 1개(견본)만 있고, 그 행의 각 셀에 [번호][이름]
 *   [수석/이사/교수 등][주요 경력][자격증]([수석감리원/감리원])[감리경력][감리참여건수]
 *   토큰이 있다. "자격증" 칸은 두 줄로 나뉘어 있는데(1번째 줄=[자격증], 2번째 줄=
 *   "([수석감리원/감리원])") — 원본 엑셀의 자격증 원문 자체가 이미 "실제 자격증
 *   번호(수석감리원)" 형태로 구분 접미사를 포함하고 있어서(2026-09-04 실측), [자격증]
 *   자리에는 그 접미사를 뗀 원문만 넣고 [수석감리원/감리원] 자리에 그 사람의 실제 구분값을
 *   넣어 재구성한다 — 그래야 접미사가 중복 표시되지 않는다.
 *   "참여여부" 열은 원본 데이터에 값이 있는 행이 하나도 없어(2026-09-04 실측) 템플릿에도
 *   placeholder가 없다 — 손대지 않고 빈 칸 그대로 둔다.
 *
 * 표 프레임의 높이 예산과 데이터 행 높이로 한 페이지에 몇 행이 들어가는지 계산해서
 * (원본 템플릿이 정확히 22행이 들어가도록 만들어져 있었다 — 2026-09-04 실측), 필터링된
 * 전체 인원을 그 행수만큼씩 나눠 슬라이드를 여러 장으로 복제한다(2026-09-04 사용자 확인
 * — "아마 여러 장 나올 거임").
 *
 * ⚠️ 템플릿 파일과 NAS에서 받아온 엑셀은 이 요청 처리 중에만 메모리에 있다가 폐기됩니다
 *    (DB/디스크 저장 없음).
 *
 * POST /api/ppt-staffing-status/:projectId
 *   multipart/form-data: template (.pptx, 표 1개 — 헤더 행 + 견본 데이터 행 1개)
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'
import { fetchStaffingStatusXlsx } from '../lib/nas-client.js'
import { loadSheetRows } from '../lib/xlsx-parse.js'

const app = new Hono()

const PAGE_TITLE = '상근감리원인력현황'
const TARGET_CATEGORIES = new Set(['감리원', '수석감리원'])
const HEADER_MARKERS = ['번호', '이름', '직위', '주요경력', '자격증', '감리경력', '감리참여 건수']

interface StaffingRow {
  no: number
  name: string
  position: string
  majorCareer: string
  certification: string
  category: string
  auditCareerYears: string
  auditCount: string
}

/** 원본 자격증 원문 끝에 이미 "(수석감리원)" 같은 구분 접미사가 붙어있는 경우가 많아
 *  (2026-09-04 실측), 템플릿이 그 접미사를 별도 줄로 다시 그리기 전에 원문에서 떼어낸다
 *  — 안 그러면 접미사가 두 번 표시된다. */
function stripCategorySuffix(certification: string): string {
  return certification.replace(/\s*\([^)]*\)\s*$/, '')
}

/** 원본 엑셀 셀에 사람이 직접 입력하다 보니 눈에 안 보이는 탭 문자가 줄 맨 앞에 섞여
 *  들어간 경우가 있다(2026-09-04 실측 — "강휘진"의 주요경력 3번째 줄 앞에 탭 문자 하나가
 *  껴있었음). 파워포인트가 탭을 넓은 공백으로 그려서 그 뒤 글자가 칸 밖으로 튀어나와
 *  보이는 원인이었다 — 탭을 없애고, 줄바꿈은 캐리지리턴(\r)을 없애 \n 하나로 정리한다. */
function sanitizeCellText(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** "105회(총괄 13 회)"처럼 "(총괄 N회)"가 붙어있으면, 그 앞뒤 사이에 줄바꿈을 넣는다
 *  (2026-09-04 사용자 확인 — "NN회하고 (총괄 NN회) 사이에 엔터 쳐줘"). 그런 접미사가
 *  없으면 그대로 둔다. */
function formatAuditCount(raw: string): string {
  return raw.replace(/(\S)(\(총괄[^)]*\))/, '$1\n$2')
}

async function loadStaffingRows(xlsxBuf: Buffer): Promise<StaffingRow[]> {
  const rows = await loadSheetRows(xlsxBuf, '상근인력현황')
  const result: StaffingRow[] = []
  let no = 0
  for (const cells of rows) {
    const category = cells.get('I') ?? ''
    if (!TARGET_CATEGORIES.has(category)) continue
    no++
    result.push({
      no,
      name: sanitizeCellText(cells.get('B') ?? ''),
      position: sanitizeCellText(cells.get('C') ?? ''),
      majorCareer: sanitizeCellText(cells.get('D') ?? ''),
      certification: sanitizeCellText(stripCategorySuffix(cells.get('E') ?? '')),
      category,
      auditCareerYears: sanitizeCellText(cells.get('F') ?? ''),
      auditCount: sanitizeCellText(cells.get('G') ?? ''),
    })
  }
  return result
}

function rowToMap(r: StaffingRow): Record<string, string> {
  return {
    '[번호]': String(r.no),
    '[이름]': r.name,
    '[수석/이사/교수 등]': r.position,
    '[주요 경력]': r.majorCareer,
    '[자격증]': r.certification,
    '[수석감리원/감리원]': r.category,
    '[감리경력]': r.auditCareerYears,
    '[감리참여건수]': formatAuditCount(r.auditCount),
  }
}

/** 클론한 행마다 새 <a16:rowId>를 부여한다 — 원본 견본 행의 ID를 그대로 복제하면 모든 행이
 *  같은 ID를 갖게 되어, 파워포인트가 어느 행이 편집 대상인지 못 가리고 다른 셀을 고쳐도
 *  첫 행으로 커서가 튀는 문제가 있었다(2026-09-04 실측 — 사용자 확인: "다른 셀 수정하려고
 *  하니까 첫행으로 날아가는데"). */
function withFreshRowId(rowXml: string): string {
  return rowXml.replace(
    /<a16:rowId xmlns:a16="[^"]*" val="\d+"\/>/,
    m => m.replace(/val="\d+"/, `val="${Math.floor(Math.random() * 2147483647)}"`)
  )
}

function extractText(xml: string): string {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
}

function findTable(slideXml: string): { tbl: string; tblIndex: number; rows: string[] } | null {
  const m = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)
  if (!m || m.index === undefined) return null
  const rows = m[0].match(/<a:tr[\s\S]*?<\/a:tr>/g) || []
  const headerIdx = rows.findIndex(r => HEADER_MARKERS.every(hm => extractText(r).includes(hm)))
  if (headerIdx === -1) return null
  return { tbl: m[0], tblIndex: m.index, rows }
}

/** 표 프레임의 높이 예산(<p:xfrm>의 cy)을 찾는다 — <a:tbl> 바로 앞에 있는 graphicFrame의 것. */
function findFrameBudgetCy(slideXml: string, tblIndex: number): number | null {
  const before = slideXml.slice(0, tblIndex)
  const matches = [...before.matchAll(/<p:xfrm><a:off x="\d+" y="\d+"\/><a:ext cx="\d+" cy="(\d+)"\/><\/p:xfrm>/g)]
  return matches.length ? Number(matches[matches.length - 1][1]) : null
}

function rowHeight(rowXml: string): number {
  return Number((rowXml.match(/<a:tr h="(\d+)">/) || [])[1] || 0)
}

/** 템플릿의 표(헤더 행 + 견본 데이터 행 1개)를 분석해서 한 페이지에 몇 행이 들어가는지
 *  계산한다. 표 프레임의 높이 예산을 못 찾으면(레이아웃이 다르면) 안전하게 1행으로 본다. */
function planRowsPerPage(slideXml: string): number {
  const found = findTable(slideXml)
  if (!found) throw new Error('템플릿에서 표를 찾지 못했습니다')
  const headerIdx = found.rows.findIndex(r => HEADER_MARKERS.every(hm => extractText(r).includes(hm)))
  const headerRow = found.rows[headerIdx]
  const dataRowTpl = found.rows[headerIdx + 1]
  if (!dataRowTpl) throw new Error('템플릿에서 견본 데이터 행을 찾지 못했습니다')

  const budgetCy = findFrameBudgetCy(slideXml, found.tblIndex)
  const dataRowH = rowHeight(dataRowTpl)
  if (!budgetCy || !dataRowH) return 1

  const available = budgetCy - rowHeight(headerRow)
  return Math.max(1, Math.floor(available / dataRowH))
}

export interface StaffingStatusZipResult {
  zip: JSZip
  pageCount: number
  personCount: number
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("8. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildStaffingStatusZip(
  templateBuf: Buffer,
  projectId: number,
  titlePrefix = ''
): Promise<StaffingStatusZipResult> {
  const [project, sourceXlsx] = await Promise.all([
    queryOne<{ project_name: string }>(`SELECT project_name FROM audit_projects WHERE id = $1`, [projectId]),
    fetchStaffingStatusXlsx(),
  ])
  if (!project) throw new Error('사업을 찾을 수 없습니다')
  if (!sourceXlsx) throw new Error('NAS에서 상근인력현황 원본 파일을 가져오지 못했습니다')

  const allRows = await loadStaffingRows(sourceXlsx)
  if (!allRows.length) throw new Error('상근인력현황 원본 파일에서 감리원/수석감리원 인력을 찾지 못했습니다')

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
  }

  const zip = await JSZip.loadAsync(templateBuf)

  const sharedPartNames = Object.keys(zip.files).filter(
    f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
  )
  for (const partName of sharedPartNames) {
    const partXml = await zip.file(partName)!.async('string')
    const patched = applyPlaceholderMap(partXml, commonMap)
    if (patched !== partXml) zip.file(partName, patched)
  }

  const templateSlideFile = Object.keys(zip.files).find(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  if (!templateSlideFile) throw new Error('템플릿에 슬라이드가 없습니다')
  const templateSlideXml = await zip.file(templateSlideFile)!.async('string')
  const rowsPerPage = planRowsPerPage(templateSlideXml)

  const pages: StaffingRow[][] = []
  for (let i = 0; i < allRows.length; i += rowsPerPage) {
    pages.push(allRows.slice(i, i + rowsPerPage))
  }

  await buildMultiSlideDeck(
    zip,
    (tplSlideXml, pageRows: StaffingRow[]) => {
      let xml = applyPlaceholderMap(tplSlideXml, commonMap)
      const found = findTable(xml)
      if (!found) throw new Error('템플릿에서 표를 찾지 못했습니다')
      const headerIdx = found.rows.findIndex(r => HEADER_MARKERS.every(hm => extractText(r).includes(hm)))
      const dataRowTpl = found.rows[headerIdx + 1]
      const oldDataRows = found.rows.slice(headerIdx + 1).join('')
      const newDataRows = pageRows.map(r => withFreshRowId(applyPlaceholderMap(dataRowTpl, rowToMap(r)))).join('')
      const newTbl = found.tbl.replace(oldDataRows, newDataRows)
      xml = xml.slice(0, found.tblIndex) + newTbl + xml.slice(found.tblIndex + found.tbl.length)
      return xml
    },
    pages
  )

  return { zip, pageCount: pages.length, personCount: allRows.length, projectName: project.project_name }
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

    const templateBuf = Buffer.from(await file.arrayBuffer())
    const { zip, pageCount, personCount, projectName } = await buildStaffingStatusZip(templateBuf, projectId)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('상근감리원인력현황_' + safeName)}.pptx"`)
    c.header('X-Page-Count', String(pageCount))
    c.header('X-Person-Count', String(personCount))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-staffing-status] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
