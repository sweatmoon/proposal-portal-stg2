/**
 * [ppt-portal 추가 기능] "PPT 템플릿 관리 → 첨부 → 플레이스홀더 치환" 탭에서 관리자가
 * 값 소스(텍스트: DB/엑셀/고정값, 이미지: NAS 경로+파일 선택 방식)와 변환 체인을 페이지에서
 * 직접 설정한 항목을 위한 범용 조립 함수(2026-09-11 사용자 확인 — "값 소스마다 db/엑셀/ppt
 * 선택 가능하게", "코드 로직을 페이지에서 입력" 요청에 대해 eval 없이 안전한 변환 함수
 * 체인으로 답한 설계). 이미지 치환의 generic-image-replace-doc.ts와 같은 역할이지만,
 * 이쪽은 "인력 수만큼 슬라이드를 복제해 텍스트 플레이스홀더를 채우는" PLACEHOLDER_REPLACE
 * 항목용이다.
 *
 * 이미지 값 소스는 "도장(이름)"/"경로 이미지"처럼 종류를 미리 나눠두지 않고, 하나의
 * source_type='image'로 통일했다(2026-09-11 사용자 확인 — "이미지로 지정을 하면
 * 도장(이름)/경로 이미지로 주는게 아니라 기본적으로 경로를 입력하게 하고, 파일명
 * ([특정단어])... 이름/최신날짜 등으로 선택"). config.matchBy가 실제 동작을 가른다:
 *   'name'   NAS 폴더 경로 + 파일명 패턴(예: "도장([이름]).png") — 사람마다 [이름]을
 *            실제 이름으로 바꿔 그 파일 하나를 직접 받아온다(폴더 목록 조회 없이 바로
 *            시도 — 기존 fetchPersonalStampPngs와 같은 방식을 일반화한 것).
 *   'latest' NAS 폴더 경로만 — 폴더 안에서 파일이름 기준 가장 최신 파일 하나를 받아와
 *            모든 슬라이드에 똑같이 쓴다(인력별로 다르지 않음 — 이미지 치환의 "이 폴더의
 *            최신 파일"과 같은 방식).
 * 플레이스홀더 키는 텍스트 값 소스에만 의미가 있어서(실제 [필드명] 문자열을 찾아
 * 치환하는 대상), 이미지 값 소스는 관리자가 입력하지 않고 고정 내부 키(IMAGE_SOURCE_KEY)
 * 하나를 자동으로 쓴다 — "이미지 치환이라서 플레이스홀더 키가 [도장]이 아니잖아"라는
 * 지적대로, 이미지 자리는 텍스트 검색·치환이 아니라 pptx 안의 이미지 관계(Target) 하나를
 * 통째로 바꿔치기하는 것이기 때문이다.
 *
 * 값 소스는 ppt_placeholder_sources 테이블(menu_id, placeholder_key, source_type,
 * source_config, transforms)에 저장되며, 기존 재직증명서/경력증명서/비상근 감리원 참여
 * 동의서(각각 employee-certificate-doc.ts, ppt-consent.ts)와 완전히 같은 "사람마다 한
 * 장씩 복제 + 필드별 값 채우기" 패턴이라 그 두 파일이 쓰는 pptx-runtext.ts/pptx-deck.ts를
 * 그대로 재사용한다. 단, "투입 감리원별 실적 및 경력"(ppt-career.ts)처럼 동적 표 생성이
 * 필요한 항목은 이 값 소스 모델로 표현할 수 없어 범위 밖이다 — 그런 항목은 계속 전용
 * 코드로 남는다.
 */
import JSZip from 'jszip'
import { query, queryOne } from '../db/client.js'
import { applyPlaceholderMap } from './pptx-runtext.js'
import { buildMultiSlideDeck } from './pptx-deck.js'
import { findPlaceholderImageTarget, replaceSlideImages } from './pptx-image-swap.js'
import { fetchFileFromNasPath, fetchLatestFileFromFolder } from './nas-client.js'
import { loadSheetRows } from './xlsx-parse.js'
import { findDbField } from './placeholder-db-fields.js'
import { applyTransformChain, type TransformSpec } from './placeholder-transforms.js'

export type PlaceholderSourceType = 'db' | 'excel' | 'fixed' | 'image'

/** 이미지 값 소스는 텍스트 검색용 [필드명]이 아니라 pptx 이미지 관계 하나를 통째로 바꿔치기
 *  하는 것이라, 관리자가 타이핑하지 않고 이 고정 키를 내부적으로 쓴다(템플릿당 1개 제한과
 *  맞물려 항상 이 값 하나뿐이다). */
export const IMAGE_SOURCE_KEY = '__image__'

interface PlaceholderSourceRow {
  id: number
  placeholder_key: string
  source_type: PlaceholderSourceType
  source_config: string | null
  transforms: string | null
}

interface ProjectMember {
  person_name: string
}

interface PersonChunk {
  name: string
  map: Record<string, string>
}

export interface GenericPlaceholderReplaceZipResult {
  zip: JSZip
  personCount: number
  skipped: string[]
  projectName: string
}

/** titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("N. " 등)를 제목 앞에
 *  붙인다(단독 다운로드일 때는 생략). personnelNameFilter: "정렬 기준: 인력별" 모드에서
 *  이 문서를 사람마다 한 장씩 따로 만들 때 쓴다 — 넘긴 이름 중 대상자가 하나도 없으면
 *  에러 대신 null을 반환해 "이 사람은 대상이 아님 — 건너뜀"으로 처리할 수 있게 한다.
 *  memberFilter: 비상근 감리원 참여 동의서처럼 "이 문서 자체가 상근/비상근 중 한쪽만
 *  대상"인 경우(2026-09-04 — proposal_members.is_fulltime 기준) 쓴다. 값 소스와 달리
 *  "누구를 대상으로 할지"는 플레이스홀더 단위가 아니라 문서 전체의 성격이라 관리자
 *  화면에서 설정하는 값 소스 목록에 넣지 않고, 이 문서를 등록한 코드가 직접 넘긴다
 *  (2026-09-11 사용자 확인 — "기존의 로직을 기반으로 페이지에도 표시되게... 반영되게
 *  해야지"에 따라 ppt-attachment-bundle.ts의 consent 항목이 'parttime'을 넘긴다). */
export async function buildGenericPlaceholderReplaceZip(
  templateBuf: Buffer,
  projectId: number,
  menuId: number,
  pageTitle: string,
  titlePrefix = '',
  personnelNameFilter?: string[],
  memberFilter?: 'fulltime' | 'parttime'
): Promise<GenericPlaceholderReplaceZipResult | null> {
  const memberWhere = memberFilter === 'parttime' ? ' AND is_fulltime = 0' : memberFilter === 'fulltime' ? ' AND is_fulltime = 1' : ''
  const [project, allMembers, sourceRows] = await Promise.all([
    queryOne<{ project_name: string }>(`SELECT project_name FROM audit_projects WHERE id = $1`, [projectId]),
    query<ProjectMember>(`SELECT person_name FROM proposal_members WHERE project_id = $1${memberWhere} ORDER BY id ASC`, [projectId]),
    query<PlaceholderSourceRow>(
      `SELECT id, placeholder_key, source_type, source_config, transforms
       FROM ppt_placeholder_sources WHERE menu_id = $1 ORDER BY sort_order ASC, id ASC`,
      [menuId]
    ),
  ])
  if (!project) throw new Error('사업을 찾을 수 없습니다')
  if (!allMembers.length) {
    throw new Error(
      memberFilter === 'parttime' ? '이 사업에 투입된 비상근 인력이 없습니다'
        : memberFilter === 'fulltime' ? '이 사업에 투입된 상근 인력이 없습니다'
          : '이 사업에 투입된 인력이 없습니다'
    )
  }
  if (!sourceRows.length) {
    throw new Error('이 항목에 플레이스홀더 값 소스가 설정되어 있지 않습니다 — "PPT 템플릿 관리"에서 먼저 설정해주세요')
  }

  let members = allMembers
  if (personnelNameFilter) {
    const filterSet = new Set(personnelNameFilter)
    members = members.filter(m => filterSet.has(m.person_name))
    if (!members.length) return null
  }
  const names = members.map(m => m.person_name)

  interface ParsedSource {
    row: PlaceholderSourceRow
    config: Record<string, unknown>
    transforms: TransformSpec[]
  }
  const parsed: ParsedSource[] = sourceRows.map(r => ({
    row: r,
    config: r.source_config ? JSON.parse(r.source_config) : {},
    transforms: r.transforms ? JSON.parse(r.transforms) : [],
  }))

  // ── excel 소스 미리 로드 — (nasPath, sheet) 조합별로 한 번만 받아서 "이름 → 행" 맵으로
  //    캐싱한다(플레이스홀더가 여러 개라도 같은 시트를 여러 번 받지 않도록). ──────────
  const excelCache = new Map<string, Map<string, Map<string, string>>>()
  for (const p of parsed) {
    if (p.row.source_type !== 'excel') continue
    const { nasPath, sheet, nameColumn } = p.config as { nasPath: string; sheet: string; nameColumn: string }
    const cacheKey = `${nasPath}::${sheet}`
    if (excelCache.has(cacheKey)) continue
    const buf = await fetchFileFromNasPath(nasPath)
    const byName = new Map<string, Map<string, string>>()
    if (buf) {
      const rows = await loadSheetRows(buf, sheet)
      for (const row of rows) {
        const name = row.get(nameColumn)
        if (name && !byName.has(name)) byName.set(name, row)
      }
    }
    excelCache.set(cacheKey, byName)
  }

  // ── db 소스 미리 로드 — 화이트리스트 필드별로 한 번씩만(project 스코프는 값 하나,
  //    person 스코프는 이름 목록으로 한 번에). ──────────────────────────────────────
  const dbProjectCache = new Map<string, string>()
  const dbPersonCache = new Map<string, Map<string, string>>()
  for (const p of parsed) {
    if (p.row.source_type !== 'db') continue
    const fieldKey = (p.config as { fieldKey: string }).fieldKey
    const field = findDbField(fieldKey)
    if (!field) continue
    if (field.scope === 'project') {
      if (!dbProjectCache.has(fieldKey)) dbProjectCache.set(fieldKey, await field.load(projectId))
    } else if (!dbPersonCache.has(fieldKey)) {
      dbPersonCache.set(fieldKey, await field.load(projectId, names))
    }
  }

  // 이미지 값 소스(2026-09-11 사용자 확인 — "텍스트/이미지로 라디오 선택... 파일명
  // ([특정단어])... 이름/최신날짜로 선택") — findPlaceholderImageTarget이 템플릿에서
  // 이미지 자리표시자를 첫 번째 하나만 찾으므로, 템플릿당 이미지 값 소스는 1개까지만
  // 지원한다(PUT /:id/placeholder-sources에서 이미 2개 이상은 막지만, 저장된 데이터가
  // 어떤 경로로든 어긋났을 때를 대비해 생성 시점에도 한 번 더 확인한다).
  const imageSources = parsed.filter(p => p.row.source_type === 'image')
  if (imageSources.length > 1) {
    throw new Error('이미지 값 소스는 템플릿당 1개만 지원합니다 — "PPT 템플릿 관리"에서 정리해주세요')
  }
  const imageSource = imageSources[0]

  // ── 사람별 플레이스홀더 맵 구성 — excel 소스에서 매칭되는 행을 못 찾은 사람은 이
  //    문서의 대상이 아니라고 보고 건너뛴다(재직증명서 등 기존 항목과 같은 원칙). ────
  const chunks: PersonChunk[] = []
  const skipped: string[] = []

  for (const m of members) {
    let excelMiss = false
    const personMap: Record<string, string> = {}

    for (const p of parsed) {
      if (p.row.source_type === 'image') continue // 텍스트 값이 아니라 이미지 슬롯 — 루프 밖에서 별도 처리
      let raw = ''
      if (p.row.source_type === 'fixed') {
        raw = String((p.config as { value?: string }).value ?? '')
      } else if (p.row.source_type === 'db') {
        const fieldKey = (p.config as { fieldKey: string }).fieldKey
        const field = findDbField(fieldKey)
        raw = field?.scope === 'project'
          ? dbProjectCache.get(fieldKey) ?? ''
          : dbPersonCache.get(fieldKey)?.get(m.person_name) ?? ''
      } else if (p.row.source_type === 'excel') {
        const { nasPath, sheet, valueColumn } = p.config as { nasPath: string; sheet: string; valueColumn: string }
        const personRow = excelCache.get(`${nasPath}::${sheet}`)?.get(m.person_name)
        if (!personRow) {
          excelMiss = true
          continue
        }
        raw = personRow.get(valueColumn) ?? ''
      }
      personMap[p.row.placeholder_key] = applyTransformChain(raw, p.transforms, { personName: m.person_name })
    }

    if (excelMiss) {
      skipped.push(m.person_name)
      continue
    }

    personMap['[제목]'] = `${titlePrefix}${pageTitle}`
    chunks.push({ name: m.person_name, map: personMap })
  }

  if (!chunks.length) {
    if (personnelNameFilter) return null
    throw new Error(`값 소스에서 매칭되는 인력이 한 명도 없습니다${skipped.length ? ` (${skipped.join(', ')})` : ''}`)
  }

  const commonMap: Record<string, string> = { '[제목]': `${titlePrefix}${pageTitle}` }

  const zip = await JSZip.loadAsync(templateBuf)

  const sharedPartNames = Object.keys(zip.files).filter(
    f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
  )
  for (const partName of sharedPartNames) {
    const partXml = await zip.file(partName)!.async('string')
    const patched = applyPlaceholderMap(partXml, commonMap)
    if (patched !== partXml) zip.file(partName, patched)
  }

  const placeholderImageTarget = imageSource ? await findPlaceholderImageTarget(zip) : null

  await buildMultiSlideDeck(
    zip,
    (templateSlideXml, chunk: PersonChunk) => applyPlaceholderMap(templateSlideXml, chunk.map),
    chunks
  )

  if (placeholderImageTarget && imageSource) {
    const { nasPath, matchBy, filenamePattern } = imageSource.config as {
      nasPath: string
      matchBy: 'name' | 'latest'
      filenamePattern?: string
    }
    let images: (Buffer | null)[]
    if (matchBy === 'name') {
      // 사람마다 파일명 패턴의 [이름]을 실제 이름으로 바꿔 그 파일 하나를 직접 받아온다
      // (폴더 목록 조회 없이 바로 시도 — 기존 개인 도장 조회와 같은 방식).
      images = await Promise.all(
        chunks.map(async c => {
          const fileName = (filenamePattern ?? '').replace(/\[이름\]/g, c.name)
          if (!fileName) return null
          return fetchFileFromNasPath(`${nasPath}/${fileName}`)
        })
      )
    } else {
      // 최신날짜 — 폴더 안 가장 최신 파일 하나를 모든 슬라이드에 똑같이 쓴다(인력별 아님).
      const fixedImage = await fetchLatestFileFromFolder(nasPath, pageTitle)
      images = chunks.map(() => fixedImage)
    }
    await replaceSlideImages(zip, images, placeholderImageTarget, 'placeholderimg')
  }

  return { zip, personCount: chunks.length, skipped, projectName: project.project_name }
}
