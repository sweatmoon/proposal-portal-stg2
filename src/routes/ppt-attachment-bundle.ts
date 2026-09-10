/**
 * ============================================================================
 *  [ppt-portal 추가 기능] "첨부PPT 생성" 세트 — 조립 엔드포인트 (이 세트의 진입점)
 * ============================================================================
 *
 * "첨부PPT 생성"이란: 표지 + 선택한 첨부 항목들을 사용자가 고른 순서대로 한 파일로 합쳐서
 * 생성한다 (2026-09-01 사용자 확인). 웹 화면의 모달에서 체크/드래그로 항목과 순서를 고르고,
 * 각 항목의 템플릿 파일을 올린 뒤 "생성"을 누르면 이 엔드포인트 하나로 전부 처리된다.
 *
 * 이 세트를 이루는 파일 전체 (전부 새로 추가된 파일 — 기존 파일을 수정한 곳은 없음):
 *   화면(UI)
 *     src/views/attachment-bundle-widget.ts   화면 HTML + 클라이언트 JS 전체
 *   조립/생성 라우트
 *     src/routes/ppt-attachment-bundle.ts      (이 파일) 표지+선택 항목을 순서대로 합치는 진입점
 *     src/routes/ppt-cover.ts                  0. 정성제안서 첨부 표지
 *     src/routes/ppt-schedule.ts               1. 감리원 일정 현황표
 *     src/routes/ppt-career.ts                 2. 투입 감리원별 실적 및 경력
 *     src/routes/ppt-consent.ts                3. 비상근 감리원 참여 동의서
 *     src/routes/ppt-financial-statement.ts    4. 표준재무제표 (NAS의 회사 표준재무제표 원본을
 *                                               페이지별 이미지로 뽑아 범용 템플릿에 붙여넣음)
 *     src/routes/ppt-business-registration.ts  5. 사업자등록증 ("범용 템플릿(도장O)" — 슬라이드
 *     src/routes/ppt-tax-certificate.ts        6. 국세 납세증명서    1장에 큰 자리=NAS 스캔본/
 *     src/routes/ppt-local-tax-certificate.ts  7. 지방세 납세증명서  PDF 첫 페이지, 작은 자리=
 *     src/routes/ppt-corporate-registry.ts     8. 법인등기부등본     사용자가 고른 도장. 이
 *                                               4개 항목이 템플릿 파일 하나(범용 템플릿
 *                                               (도장O))를 공유한다 — 2026-09-03 사용자 확인)
 *   공용 OOXML 조립 유틸 (위 라우트들이 나눠서 사용)
 *     src/lib/pptx-runtext.ts                  [placeholder] 텍스트 치환 (런 분산 대응)
 *     src/lib/pptx-table-rows.ts               일정표류 표 동적 확장(rowSpan/vMerge, 페이지 분할)
 *     src/lib/pptx-career-rows.ts              실적/경력 표 채우기 + 클러스터 병합 + 색상 규칙
 *     src/lib/pptx-deck.ts                     템플릿 슬라이드(1~N장)를 데이터 개수만큼 복제
 *     src/lib/pptx-cover-toc.ts                표지의 번호 매긴 목차를 선택 항목으로 재작성
 *     src/lib/pptx-merge.ts                    완성된 여러 pptx를 한 파일로 이어붙이기
 *     src/lib/pptx-image-swap.ts               템플릿의 placeholder 이미지를 실제 이미지로
 *                                               교체(원본 비율 유지) + pptx에서 이미지 추출
 *     src/lib/pptx-stamped-doc.ts              "범용 템플릿(도장O)" 조립 공용 함수(5~8번 공유)
 *     src/lib/pdf-render.ts                    PDF 첫 페이지를 PNG로 렌더링(지방세/법인등기부등본)
 *     src/lib/nas-client.ts                    Synology NAS(QuickConnect)에서 파일 조회
 *
 * 다른 사이트(예: proposal-portal-main)로 이식하는 방법:
 *   1) 위 파일 전부를 같은 상대 경로로 복사
 *   2) package.json에 "jszip" 의존성 추가 (proposal-portal-main은 현재 jszip을 서버
 *      의존성으로 안 쓰고 있음 — 2026-09-02 확인)
 *   3) index.tsx에 import 5줄 + app.route(...) 5줄 추가 (이 리포의 src/index.tsx
 *      "[ppt-portal 추가 기능]" 배너 부분을 그대로 참고)
 *   4) 사업 목록/상세 화면 아무 곳에 renderAttachmentBundleWidget()의 반환값(html,
 *      script)을 끼워넣고, 버튼 하나 추가: onclick="openBundleModal(사업id, this)"
 *   DB 쪽은 손댈 게 없다 — proposal-portal-main의 query/queryOne 헬퍼 시그니처가
 *   이 리포와 동일해서 그대로 호출된다 (2026-09-02 확인).
 *
 * 항목 종류(ATTACHMENT_TYPES)는 지금은 3개(일정표/실적경력/동의서)뿐이지만, 나중에 다른
 * 첨부가 추가될 수 있으므로 이 레지스트리에 한 줄만 추가하면 되도록 설계했다 — id, 표지
 * 목차에 쓸 라벨, 실제 생성 함수를 한 군데(ATTACHMENT_TYPES)에 묶어둔다.
 *
 * 표지(0번)는 체크 대상이 아니라 항상 자동으로 맨 앞에 붙는다. 표지 안의 번호 매긴 목차는
 * 이번에 실제로 선택된 항목들의 라벨로, 선택된 순서 그대로 다시 번호를 매겨 채워진다.
 *
 * 합치는 방식(mergeDecksSharingMaster)은 모든 첨부 템플릿이 같은 마스터/레이아웃/테마를
 * 쓴다는 전제에서 슬라이드 본문만 이어붙이는 단순한 방식이다 — 자세한 건
 * src/lib/pptx-merge.ts 참고.
 *
 * ⚠️ 템플릿 파일들은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다
 *    (DB/디스크 저장 없음 — 2026-09-01 사용자 확인: PPT 템플릿 DB 적재는 절대 금지, 지금은
 *    매번 업로드하는 현재 방식 유지).
 *
 * POST /api/ppt-attachment-bundle/:projectId
 *   multipart/form-data:
 *     - cover: File (.pptx) — "0. 정성제안서 첨부 표지" 템플릿, 항상 필요
 *     - order: JSON 배열 문자열, 예: '["schedule","consent"]' — 체크된 항목 id를 원하는
 *       순서대로 나열 (최소 1개 필요)
 *     - order에 들어간 각 id와 같은 이름의 파일 필드 — 그 항목의 템플릿 (예: 'schedule' 필드)
 *     - additionalPhaseIds: JSON 배열 문자열 — order에 'schedule'이 있을 때만 사용
 */
import { Hono } from 'hono'
import type JSZip from 'jszip'
import { query } from '../db/client.js'
import type { AttachmentBuildKind } from '../lib/attachment-build-kind.js'
import { buildScheduleZip } from './ppt-schedule.js'
import { buildCareerZip, type FreeCareerOptions } from './ppt-career.js'
import { buildConsentZip } from './ppt-consent.js'
import { buildFinancialStatementZip } from './ppt-financial-statement.js'
import { buildBusinessRegistrationZip } from './ppt-business-registration.js'
import { buildTaxCertificateZip } from './ppt-tax-certificate.js'
import { buildLocalTaxCertificateZip } from './ppt-local-tax-certificate.js'
import { buildCorporateRegistryZip } from './ppt-corporate-registry.js'
import { buildInsuranceEnrollmentZip } from './ppt-insurance-enrollment.js'
import { buildEmploymentCertificateZip } from './ppt-employment-certificate.js'
import { buildCareerCertificateZip } from './ppt-career-certificate.js'
import { buildStaffingStatusZip } from './ppt-staffing-status.js'
import type { CompanyStampType } from '../lib/nas-client.js'
import { buildCoverZip } from './ppt-cover.js'
import { mergeDecksSharingMaster } from '../lib/pptx-merge.js'

const app = new Hono()

/** "범용 템플릿(도장O)" 계열 항목(사업자등록증/국세·지방세 납세증명서/법인등기부등본)이
 *  전부 같은 stampType 검증을 공유해서 뺐다(2026-09-03 — 이제 4곳에서 씀). */
function validateStampType(form: FormData): CompanyStampType {
  const stampType = form.get('stampType')
  if (stampType !== '원본대조필' && stampType !== '사실과상위없음') {
    throw new Error('찍을 도장 종류(원본대조필/사실과상위없음)를 선택해주세요')
  }
  return stampType
}

/** 첨부 항목 레지스트리 — 나중에 새 첨부가 생기면 여기에 한 줄만 추가하면 된다.
 *  build()의 titlePrefix는 이 항목이 선택된 순서에서 몇 번째인지("1. " 등)이며, 각 항목의
 *  실제 슬라이드 제목([제목] 자리)에 그대로 반영된다 — 표지 목차 번호와 맞춰서.
 *  buildKind는 이 항목이 실제로 "어떻게 만들어지는지" 3가지 중 어디에 속하는지 나타낸다
 *  (자세한 설명은 attachment-build-kind.ts 참고, 2026-09-10 사용자 확인 — "지금까지의
 *  첨부 서류들을 이 3가지 버전으로 분류해"). 그중 PERSON_PAGES인 항목만 build()의
 *  personnelNameFilter로 "이 사람만" 생성할 수 있다 — "정렬 기준: 인력별"에서 "인력만큼"
 *  반복 항목을 사람 단위로 묶을 때 쓴다. 이 사람이 그 서류에 해당 없으면(예: 동의서는
 *  비상근만 대상) build가 null을 반환하고, 그러면 그 사람 아래에는 그냥 안 넣고 건너뛴다.
 *  PERSON_PAGES가 아닌 항목(회사서류/표 형태 등 — 애초에 사람 단위 개념이 없는 문서)은
 *  이 인자를 무시하고 항상 사업 전체 기준 동일한 내용을 만든다 — "인력만큼"으로 설정돼도
 *  그 결과를 사람마다 그대로 재사용해서 묶는다(자세한 건 buildSectionsByPersonnel 참고). */
const ATTACHMENT_TYPES: Record<
  string,
  {
    label: string
    buildKind: AttachmentBuildKind
    build: (buf: Buffer, projectId: number, form: FormData, titlePrefix: string, personnelNameFilter?: string[]) => Promise<JSZip | null>
  }
> = {
  schedule: {
    label: '감리원 일정 현황표',
    buildKind: 'SHARED_TABLE',
    build: async (buf, projectId, form, titlePrefix) => {
      let additionalPhaseIds: number[] = []
      const raw = form.get('additionalPhaseIds')
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) additionalPhaseIds = parsed.map(Number).filter(n => !Number.isNaN(n))
      }
      const { zip } = await buildScheduleZip(buf, projectId, additionalPhaseIds, titlePrefix)
      return zip
    },
  },
  career: {
    label: '투입 감리원별 실적 및 경력',
    buildKind: 'PERSON_PAGES',
    build: async (buf, projectId, form, titlePrefix, personnelNameFilter) => {
      const onePage = form.get('careerOnePage') === 'true'
      let freeOpts: FreeCareerOptions | undefined
      if (projectId === 0) {
        const kwRaw = form.get('freeKeywords')
        const mapRaw = form.get('freeMappings')
        const namesRaw = form.get('personnelNames')
        freeOpts = {
          keywords: kwRaw ? JSON.parse(kwRaw as string) : [],
          mappings: mapRaw ? JSON.parse(mapRaw as string) : [],
          personnelNames: namesRaw ? JSON.parse(namesRaw as string) : [],
        }
      }
      const result = await buildCareerZip(buf, projectId, titlePrefix, onePage, freeOpts, personnelNameFilter)
      return result ? result.zip : null
    },
  },
  consent: {
    label: '비상근 감리원 참여 동의서',
    buildKind: 'PERSON_PAGES',
    build: async (buf, projectId, _form, titlePrefix, personnelNameFilter) => {
      const result = await buildConsentZip(buf, projectId, titlePrefix, personnelNameFilter)
      return result ? result.zip : null
    },
  },
  financial: {
    label: '표준재무제표',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, _form, titlePrefix) => (await buildFinancialStatementZip(buf, projectId, titlePrefix)).zip,
  },
  bizreg: {
    label: '사업자등록증',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, form, titlePrefix) => {
      const stampType = validateStampType(form)
      const { zip } = await buildBusinessRegistrationZip(buf, projectId, stampType, titlePrefix)
      return zip
    },
  },
  taxcert: {
    label: '국세 납세증명서',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, form, titlePrefix) => {
      const stampType = validateStampType(form)
      const { zip } = await buildTaxCertificateZip(buf, projectId, stampType, titlePrefix)
      return zip
    },
  },
  localtaxcert: {
    label: '지방세 납세증명서',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, form, titlePrefix) => {
      const stampType = validateStampType(form)
      const { zip } = await buildLocalTaxCertificateZip(buf, projectId, stampType, titlePrefix)
      return zip
    },
  },
  corpregistry: {
    label: '법인등기부등본',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, form, titlePrefix) => {
      const stampType = validateStampType(form)
      const includeCancelledRaw = form.get('corpRegistryIncludeCancelled')
      if (includeCancelledRaw !== 'true' && includeCancelledRaw !== 'false') {
        throw new Error('법인등기부등본 말소사항 포함 여부를 선택해주세요')
      }
      const { zip } = await buildCorporateRegistryZip(buf, projectId, includeCancelledRaw === 'true', stampType, titlePrefix)
      return zip
    },
  },
  insurance: {
    label: '4대보험 가입확인서',
    buildKind: 'IMAGE_REPLACE',
    build: async (buf, projectId, form, titlePrefix) => {
      const stampType = validateStampType(form)
      const { zip } = await buildInsuranceEnrollmentZip(buf, projectId, stampType, titlePrefix)
      return zip
    },
  },
  employmentCert: {
    label: '재직증명서',
    buildKind: 'PERSON_PAGES',
    build: async (buf, projectId, _form, titlePrefix, personnelNameFilter) => {
      const result = await buildEmploymentCertificateZip(buf, projectId, titlePrefix, personnelNameFilter)
      return result ? result.zip : null
    },
  },
  careerCert: {
    label: '경력증명서',
    buildKind: 'PERSON_PAGES',
    build: async (buf, projectId, _form, titlePrefix, personnelNameFilter) => {
      const result = await buildCareerCertificateZip(buf, projectId, titlePrefix, personnelNameFilter)
      return result ? result.zip : null
    },
  },
  staffingStatus: {
    label: '상근감리원인력현황',
    buildKind: 'SHARED_TABLE',
    build: async (buf, projectId, _form, titlePrefix) => (await buildStaffingStatusZip(buf, projectId, titlePrefix)).zip,
  },
}

interface GenerationLogEntry {
  id: string
  label: string
  ok: boolean
  error?: string
}

interface BuildSectionsResult {
  sectionZips: JSZip[]
  /** 실제로 생성에 성공한 항목들의 라벨 — 표지 목차 번호를 이 순서로 다시 매긴다. */
  succeededLabels: string[]
  log: GenerationLogEntry[]
}

/** order에 담긴 항목들을 순서대로 하나씩 생성한다. 항목 하나가 실패해도(NAS 연결 실패,
 *  템플릿 누락 등) 전체를 막지 않고 그 항목만 건너뛰고 계속 진행한다 — 결과 로그로 어떤
 *  항목이 왜 빠졌는지 보여주기 위함(2026-09-09 사용자 확인 — "제대로 생성됐는지 어떤
 *  부분이 왜 생성이 안됐는지 그런거 보여주기"). 제목 앞 번호(`${n}. `)는 실제로 성공한
 *  항목들 기준으로 다시 매긴다(건너뛴 항목 때문에 번호가 비지 않도록) — titlePrefixOffset을
 *  주면 그 수만큼 밀려서 매겨진다("정렬 기준: 인력별"에서 인력별로 묶인 항목들 뒤에 이어
 *  붙는 "하나만" 항목들의 번호가 1부터 다시 시작하지 않도록 buildSectionsByPersonnel이 씀). */
async function buildSectionsWithLog(order: string[], form: FormData, projectId: number, titlePrefixOffset = 0): Promise<BuildSectionsResult> {
  const sectionZips: JSZip[] = []
  const succeededLabels: string[] = []
  const log: GenerationLogEntry[] = []
  for (const id of order) {
    const label = ATTACHMENT_TYPES[id].label
    const file = form.get(id) as File | null
    if (!file || file.size === 0) {
      log.push({ id, label, ok: false, error: '템플릿(.pptx) 파일이 없습니다' })
      continue
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const zip = await ATTACHMENT_TYPES[id].build(buf, projectId, form, `${titlePrefixOffset + succeededLabels.length + 1}. `)
      if (!zip) {
        log.push({ id, label, ok: false, error: '해당하는 인력이 없습니다' })
        continue
      }
      sectionZips.push(zip)
      succeededLabels.push(label)
      log.push({ id, label, ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[ppt-attachment-bundle] "${label}" 생성 실패:`, e)
      log.push({ id, label, ok: false, error: msg })
    }
  }
  return { sectionZips, succeededLabels, log }
}

/**
 * "정렬 기준: 인력별"(2026-09-10 사용자 확인 — "인력만큼이라고 지정된 애들만 그거 다
 * 끝나면 하나짜리 서류들 나열") 모드 전용 조립. repeatMode가 'all'인 항목들만 사람
 * 단위로 묶고("이 사업에 투입된 인력" 전원을 기준 순서로), 그 뒤에 repeatMode가 'one'인
 * 항목들을 지금까지처럼 항목당 한 번씩 나열한다.
 *
 * 항목마다 "사람 단위 개념이 있는지"가 다르다(attachment-build-kind.ts 참고):
 *   - buildKind === 'PERSON_PAGES' 항목(경력/동의서/재직증명서/경력증명서)은 사람마다
 *     실제로 다시 생성한다(build를 그 사람 이름으로 필터링해서 호출) — 이 사람이 그
 *     서류 대상이 아니면(예: 동의서는 비상근만) build가 null을 반환하고, 그러면 조용히
 *     건너뛴다(2026-09-10 사용자 확인 — "해당되는 서류만 넘기고 나머지는 건너뛴다").
 *   - 그 외(IMAGE_REPLACE/SHARED_TABLE — 회사서류/표 형태 등, 애초에 사람과 무관한 문서)는
 *     한 번만 생성해서, 그 결과를 모든 사람 아래에 그대로 재사용한다(같은 내용을 사람
 *     수만큼 다시 만드는 대신 — mergeDecksSharingMaster는 같은 zip을 여러 번 합쳐도
 *     안전하다, pptx-merge.ts 참고).
 */
async function buildSectionsByPersonnel(
  order: string[],
  form: FormData,
  projectId: number,
  repeatMode: Record<string, string>
): Promise<BuildSectionsResult> {
  const groupIds = order.filter(id => repeatMode[id] === 'all')
  const singleIds = order.filter(id => repeatMode[id] !== 'all')
  const sectionZips: JSZip[] = []
  const succeededLabels: string[] = []
  const log: GenerationLogEntry[] = []

  if (groupIds.length) {
    const roster = await query<{ person_name: string }>(
      `SELECT person_name FROM proposal_members WHERE project_id = $1 ORDER BY id ASC`,
      [projectId]
    )
    const rosterNames = roster.map(r => r.person_name)

    if (!rosterNames.length) {
      for (const id of groupIds) log.push({ id, label: ATTACHMENT_TYPES[id].label, ok: false, error: '이 사업에 투입된 인력이 없습니다' })
    } else {
      // 항목별로 "사람 이름 → zip"(PERSON_PAGES) 또는 zip 하나(그 외, 전원 공용)를 먼저
      // 만들어둔다 — PERSON_PAGES가 아닌 항목을 사람 수만큼 반복 생성하는 낭비를 피한다.
      const perIdSource = new Map<string, Map<string, JSZip> | JSZip | null>()
      for (const id of groupIds) {
        const def = ATTACHMENT_TYPES[id]
        const file = form.get(id) as File | null
        if (!file || file.size === 0) {
          perIdSource.set(id, null)
          log.push({ id, label: def.label, ok: false, error: '템플릿(.pptx) 파일이 없습니다' })
          continue
        }
        const buf = Buffer.from(await file.arrayBuffer())
        if (def.buildKind !== 'PERSON_PAGES') {
          try {
            const zip = await def.build(buf, projectId, form, '')
            perIdSource.set(id, zip)
            log.push({ id, label: def.label, ok: !!zip, error: zip ? undefined : '생성할 수 없습니다' })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`[ppt-attachment-bundle] "${def.label}" 생성 실패:`, e)
            perIdSource.set(id, null)
            log.push({ id, label: def.label, ok: false, error: msg })
          }
          continue
        }
        const byPerson = new Map<string, JSZip>()
        let lastError: string | undefined
        for (const personName of rosterNames) {
          try {
            const zip = await def.build(buf, projectId, form, '', [personName])
            if (zip) byPerson.set(personName, zip)
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e)
            console.error(`[ppt-attachment-bundle] "${def.label}" (${personName}) 생성 실패:`, e)
          }
        }
        perIdSource.set(id, byPerson)
        log.push({
          id,
          label: def.label,
          ok: byPerson.size > 0,
          error: byPerson.size > 0 ? undefined : (lastError || '해당하는 인력이 없습니다'),
        })
      }

      // 사람 순서(rosterNames) 기준으로, 각 사람 아래에 선택된 순서(groupIds) 그대로 붙인다.
      for (const personName of rosterNames) {
        for (const id of groupIds) {
          const source = perIdSource.get(id)
          const zip = source instanceof Map ? source.get(personName) : source
          if (zip) {
            sectionZips.push(zip)
            if (!succeededLabels.includes(ATTACHMENT_TYPES[id].label)) succeededLabels.push(ATTACHMENT_TYPES[id].label)
          }
        }
      }
    }
  }

  // "하나만" 항목들은 지금까지처럼(서류별 모드와 동일) 항목당 한 번씩, 인력별 묶음 뒤에 이어 나열한다.
  const singleResult = await buildSectionsWithLog(singleIds, form, projectId, succeededLabels.length)
  sectionZips.push(...singleResult.sectionZips)
  succeededLabels.push(...singleResult.succeededLabels)
  log.push(...singleResult.log)

  return { sectionZips, succeededLabels, log }
}

app.post('/:projectId', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'))
    if (isNaN(projectId) || projectId < 0) return c.json({ ok: false, error: 'projectId가 올바르지 않습니다' }, 400)

    const contentType = c.req.header('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ ok: false, error: 'multipart/form-data 로 보내주세요' }, 400)
    }
    const form = await c.req.formData()

    const coverFile = form.get('cover') as File | null
    if (!coverFile || coverFile.size === 0) {
      return c.json({ ok: false, error: '표지 템플릿(.pptx) 파일이 필요합니다' }, 400)
    }

    const orderRaw = form.get('order')
    if (typeof orderRaw !== 'string' || !orderRaw.trim()) {
      return c.json({ ok: false, error: '생성할 항목 순서(order)가 필요합니다' }, 400)
    }
    let order: string[]
    try {
      const parsed = JSON.parse(orderRaw)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error()
      order = parsed.map(String)
    } catch {
      return c.json({ ok: false, error: 'order는 비어있지 않은 JSON 배열이어야 합니다' }, 400)
    }
    for (const id of order) {
      if (!ATTACHMENT_TYPES[id]) return c.json({ ok: false, error: `알 수 없는 첨부 항목: ${id}` }, 400)
    }

    // ── 정렬 기준: 서류별(기본, 지금까지 동작)/인력별 ─────────────────────
    // "인력별"이면 repeatMode가 'all'인 항목들을 사람 단위로 묶는다 — 자세한 건
    // buildSectionsByPersonnel 참고(2026-09-10 사용자 확인).
    const sortBasis = form.get('sortBasis') === 'personnel' ? 'personnel' : 'document'
    let repeatMode: Record<string, string> = {}
    const repeatModeRaw = form.get('repeatMode')
    if (typeof repeatModeRaw === 'string' && repeatModeRaw.trim()) {
      try {
        const parsed = JSON.parse(repeatModeRaw)
        if (parsed && typeof parsed === 'object') repeatMode = parsed
      } catch {
        // 무시 — 파싱 실패 시 전부 '하나만' 취급(서류별과 동일하게 동작)
      }
    }

    // ── 선택된 항목들을 순서대로 생성 (실패한 항목은 건너뛰고 계속 진행 — 자세한 건
    // buildSectionsWithLog/buildSectionsByPersonnel 참고) ──────────────────
    const { sectionZips, succeededLabels, log } =
      sortBasis === 'personnel'
        ? await buildSectionsByPersonnel(order, form, projectId, repeatMode)
        : await buildSectionsWithLog(order, form, projectId)

    if (sectionZips.length === 0) {
      return c.json({ ok: false, error: '생성된 첨부가 없습니다 — 아래 로그를 확인해주세요', log }, 500)
    }

    // ── 표지: 실제로 성공한 항목만으로 목차를 만든다 ──────
    const coverBuf = Buffer.from(await coverFile.arrayBuffer())
    const { zip: coverZip, projectName } = await buildCoverZip(coverBuf, projectId, succeededLabels)

    const merged = await mergeDecksSharingMaster([coverZip, ...sectionZips])
    const outBuffer = await merged.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    const safeName = (projectName || '자유생성').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('A_첨부_' + safeName)}.pptx"`)
    c.header('X-Generation-Log', encodeURIComponent(JSON.stringify(log)))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-attachment-bundle] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
