/**
 * [ppt-portal 추가 기능 — 시험 적용] Synology NAS(QuickConnect)에서 PPT 생성에 필요한
 * 파일(인력 개인도장 이미지, 회사 표준재무제표 pptx, 사업자등록증 pptx, 회사 도장 이미지)을
 * 가져오는 클라이언트. 2026-09-02 사용자 확인 — NAS를 "유사 DB" 개념으로 써서, PPT 생성
 * 시점에 필요한 파일을 그때그때 조회해 쓰는 실험적 연동입니다.
 *
 * 인증 정보(NAS_BASE_URL/NAS_USERNAME/NAS_PASSWORD)는 .env로만 관리하고 절대 코드에
 * 하드코딩하지 않습니다 (.env는 .gitignore에 이미 등록되어 커밋되지 않음).
 *
 * 동작 방식: Synology File Station API(webapi/entry.cgi)를 그대로 호출합니다.
 *   1) SYNO.API.Auth로 로그인 → 세션 id(sid) 발급 (호출자가 넘긴 인원 전체에 대해 딱 1번)
 *   2) SYNO.FileStation.Download로 인원별 파일 원본 바이트를 동시에(Promise.all) 받음 —
 *      같은 sid를 재사용하므로 인원수만큼 로그인하지 않는다 (2026-09-02 사용자 확인 —
 *      "사람마다 따로 로그인/다운/로그아웃 할 필요 없게 최적화").
 *   3) SYNO.API.Auth로 로그아웃 (세션 정리) — 인원 전체 처리 후 딱 1번
 */

const NAS_BASE_URL = process.env.NAS_BASE_URL
const NAS_USERNAME = process.env.NAS_USERNAME
const NAS_PASSWORD = process.env.NAS_PASSWORD

// 인력별 개인도장 이미지가 있는 폴더. 사람은 "상근"(회사 소속 정규 인력)과 "비상근"(외부
// 인력)으로 나뉘어 각각 다른 하위 폴더에 저장되어 있고, 이 사업에서의 참여 형태(상근/비상근)와
// 무관하게 그 "사람"이 어느 쪽으로 분류돼 있는지에 따라 파일이 있는 폴더가 정해집니다.
// 이 기능을 쓰는 문서(비상근 감리원 참여 동의서)는 비상근 인력이 압도적으로 많으므로,
// "비상근" 폴더를 먼저 찾고 없으면 "상근" 폴더로 넘어간다(2026-09-02 사용자 확인 — 순서 변경).
const STAMP_BASE_PATH = '/activo/04.제안팀/99.악티보포털참조용/04.도장/02.인력도장/개인도장_상근_마진작업'
const STAMP_SUBFOLDERS = ['비상근', '상근'] as const

async function login(): Promise<string> {
  const body = new URLSearchParams({
    api: 'SYNO.API.Auth',
    version: '6',
    method: 'login',
    account: NAS_USERNAME ?? '',
    passwd: NAS_PASSWORD ?? '',
    session: 'FileStation',
    format: 'sid',
  })
  const res = await fetch(`${NAS_BASE_URL}/webapi/entry.cgi`, { method: 'POST', body })
  const json = (await res.json()) as { success: boolean; data?: { sid: string } }
  if (!json.success || !json.data) throw new Error('NAS 로그인 실패')
  return json.data.sid
}

async function logout(sid: string): Promise<void> {
  const url = new URL(`${NAS_BASE_URL}/webapi/entry.cgi`)
  url.searchParams.set('api', 'SYNO.API.Auth')
  url.searchParams.set('version', '6')
  url.searchParams.set('method', 'logout')
  url.searchParams.set('session', 'FileStation')
  url.searchParams.set('_sid', sid)
  await fetch(url).catch(() => {}) // 로그아웃 실패는 무시 — 세션은 어차피 타임아웃되면 정리됨
}

async function downloadFile(sid: string, path: string): Promise<Buffer | null> {
  const url = new URL(`${NAS_BASE_URL}/webapi/entry.cgi`)
  url.searchParams.set('api', 'SYNO.FileStation.Download')
  url.searchParams.set('version', '2')
  url.searchParams.set('method', 'download')
  url.searchParams.set('path', path)
  url.searchParams.set('mode', 'open')
  url.searchParams.set('_sid', sid)
  const res = await fetch(url)
  // 파일이 없으면 Synology가 200 + JSON 에러 바디를 주는 경우가 있어, content-type으로 판별합니다.
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || contentType.includes('application/json')) return null
  return Buffer.from(await res.arrayBuffer())
}

async function listFolder(sid: string, folderPath: string): Promise<{ name: string; isdir: boolean }[]> {
  const url = new URL(`${NAS_BASE_URL}/webapi/entry.cgi`)
  url.searchParams.set('api', 'SYNO.FileStation.List')
  url.searchParams.set('version', '2')
  url.searchParams.set('method', 'list')
  url.searchParams.set('folder_path', folderPath)
  url.searchParams.set('_sid', sid)
  const res = await fetch(url)
  const json = (await res.json()) as { success: boolean; data?: { files: { name: string; isdir: boolean }[] } }
  // 실패를 조용히 빈 배열로 넘기면 "파일이 진짜 없음"과 "일시적 조회 실패"를 구분할 수 없어서
  // withNasRetry가 재시도할 수 있도록 예외로 던진다.
  if (!json.success) throw new Error('NAS 폴더 조회 실패: ' + folderPath)
  return json.data ? json.data.files : []
}

/**
 * QuickConnect 경유라 가끔 일시적으로 로그인/조회/다운로드가 실패할 때가 있어서
 * (2026-09-03 실측 — 방금 성공했던 조회가 바로 다음 요청에서 실패), 세션 하나를 통째로
 * (로그인 → fn 실행 → 로그아웃) 한 번 더 재시도한다. 그래도 실패하면 null — 호출 쪽에서
 * "이 항목만 건너뛴다"로 처리하므로 NAS 문제가 PPT 생성 전체를 막지는 않는다.
 */
async function withNasRetry<T>(label: string, fn: (sid: string) => Promise<T>): Promise<T | null> {
  const attempts = 2
  for (let i = 0; i < attempts; i++) {
    try {
      const sid = await login()
      try {
        return await fn(sid)
      } finally {
        await logout(sid)
      }
    } catch (e) {
      if (i === attempts - 1) {
        console.warn(`[nas-client] ${label} 실패(${attempts}회 시도):`, (e as Error).message)
        return null
      }
      await new Promise(r => setTimeout(r, 500))
    }
  }
  return null
}

/** 폴더 안에서 .pptx 확장자인 파일 하나를 찾아 통째로 받아온다 — 표준재무제표/사업자등록증/
 *  국세 납세증명서처럼 "회사 서류 원본이 pptx 한 장짜리로 폴더에 들어있고, 파일명에 갱신
 *  날짜가 박혀 있어 계속 바뀌므로 파일명을 하드코딩하지 않는" 항목들이 공유하는 패턴
 *  (2026-09-03 — 3번째 중복이라 공용 함수로 추출). label은 실패 로그에 쓸 이름. */
async function fetchPptxFromFolder(folder: string, label: string): Promise<Buffer | null> {
  if (!NAS_BASE_URL || !NAS_USERNAME || !NAS_PASSWORD) {
    console.warn(`[nas-client] NAS_BASE_URL/NAS_USERNAME/NAS_PASSWORD 환경변수가 없어 ${label} 조회를 건너뜁니다.`)
    return null
  }
  return withNasRetry(`${label} 조회`, async sid => {
    const files = await listFolder(sid, folder)
    const pptxFile = files.find(f => !f.isdir && /\.pptx$/i.test(f.name))
    if (!pptxFile) throw new Error('폴더에서 .pptx 파일을 찾지 못함: ' + folder)
    const buf = await downloadFile(sid, `${folder}/${pptxFile.name}`)
    if (!buf) throw new Error('다운로드 실패: ' + pptxFile.name)
    return buf
  })
}

/** 폴더 안에서 predicate를 만족하는 .pdf 파일 중, 파일이름 기준으로 가장 최신(문자열
 *  오름차순 정렬했을 때 마지막) 것 하나를 찾아 통째로 받아온다 — 지방세 납세증명서/
 *  법인등기부등본처럼 "날짜가 파일명 뒤에 붙어서 계속 새 파일이 추가되는" 폴더에서
 *  "가장 최신 파일"을 고를 때 쓰는 공용 패턴(2026-09-03 사용자 확인 — "파일이름상으로"
 *  가장 최신). */
async function fetchLatestPdfFromFolder(
  folder: string,
  label: string,
  predicate: (name: string) => boolean = () => true
): Promise<Buffer | null> {
  if (!NAS_BASE_URL || !NAS_USERNAME || !NAS_PASSWORD) {
    console.warn(`[nas-client] NAS_BASE_URL/NAS_USERNAME/NAS_PASSWORD 환경변수가 없어 ${label} 조회를 건너뜁니다.`)
    return null
  }
  return withNasRetry(`${label} 조회`, async sid => {
    const files = await listFolder(sid, folder)
    const latest = files
      .filter(f => !f.isdir && /\.pdf$/i.test(f.name) && predicate(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .pop()
    if (!latest) throw new Error('조건에 맞는 .pdf 파일을 찾지 못함: ' + folder)
    const buf = await downloadFile(sid, `${folder}/${latest.name}`)
    if (!buf) throw new Error('다운로드 실패: ' + latest.name)
    return buf
  })
}

// 회사 표준재무제표 pptx가 있는 폴더. 파일명에 갱신 날짜가 박혀 있어("표준재무제표(3년)_
// 260720.pptx") 계속 바뀌므로 파일명을 하드코딩하지 않고, 이 폴더에서 .pptx 확장자인
// 파일을 찾아 그때그때 사용한다(2026-09-02 확인 — 폴더 안에 연도별 .pdf도 같이 있지만
// 이미지가 들어있는 3개년 통합본은 .pptx 하나뿐).
const FINANCIAL_STATEMENT_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/01.회사/18.표준재무제표'

/**
 * NAS에서 회사 표준재무제표 pptx 원본을 통째로 받아옵니다. 이 문서는 사업과 무관하게
 * 항상 똑같은 회사 재무제표라, 인력 이름 같은 조회 키가 필요 없습니다.
 * 못 찾거나 NAS 연동이 실패하면 null (호출 쪽에서 이 첨부 항목만 건너뛰도록 처리).
 */
export async function fetchStandardFinancialStatementPptx(): Promise<Buffer | null> {
  return fetchPptxFromFolder(FINANCIAL_STATEMENT_FOLDER, '표준재무제표')
}

// 사업자등록증 pptx가 있는 폴더 — 표준재무제표와 같은 이유로 파일명을 고정하지 않고
// 이 폴더에서 .pptx 확장자 파일을 찾는다(폴더 안에 날짜별 .pdf도 같이 있음, 2026-09-03 확인).
const BUSINESS_REGISTRATION_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/01.회사/01.사업자등록증'

/** NAS에서 사업자등록증 pptx 원본을 통째로 받아옵니다. 표준재무제표처럼 사업과 무관하게
 *  항상 같은 회사 서류라 조회 키가 필요 없습니다. 못 찾으면 null. */
export async function fetchBusinessRegistrationPptx(): Promise<Buffer | null> {
  return fetchPptxFromFolder(BUSINESS_REGISTRATION_FOLDER, '사업자등록증')
}

// 국세 납세증명서 pptx가 있는 폴더 — 유효기한별 .pdf도 같이 있지만, 이미지가 들어있는
// pptx 원본은 하나뿐이라 그걸 쓴다(2026-09-03 사용자 확인 — "ppt 파일" 사용).
const TAX_CERTIFICATE_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/01.회사/11.국세 납세증명서'

/** NAS에서 국세 납세증명서 pptx 원본을 통째로 받아옵니다. 못 찾으면 null. */
export async function fetchTaxCertificatePptx(): Promise<Buffer | null> {
  return fetchPptxFromFolder(TAX_CERTIFICATE_FOLDER, '국세 납세증명서')
}

// 지방세 납세증명서 .pdf가 있는 폴더 — pptx 없이 유효기한별 .pdf만 계속 추가되므로,
// 파일이름 기준 가장 최신 것을 그때그때 골라 쓴다(2026-09-03 사용자 확인).
const LOCAL_TAX_CERTIFICATE_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/01.회사/12.지방세 납세증명서'

/** NAS에서 지방세 납세증명서 중 파일이름 기준 가장 최신 .pdf를 받아옵니다. 못 찾으면 null. */
export async function fetchLocalTaxCertificatePdf(): Promise<Buffer | null> {
  return fetchLatestPdfFromFolder(LOCAL_TAX_CERTIFICATE_FOLDER, '지방세 납세증명서')
}

// 법인등기부등본 .pdf가 있는 폴더 — "말소사항포함"이 파일명에 들어간 것과 안 들어간 것
// 두 종류가 같이 있어, 사용자가 첨부PPT 생성 시 고른 종류에 맞춰 그중 파일이름 기준 가장
// 최신 것을 쓴다(2026-09-03 사용자 확인).
const CORPORATE_REGISTRY_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/01.회사/07.법인등기부등본'

/** NAS에서 법인등기부등본 .pdf를 받아옵니다. includeCancelled가 true면 파일명에
 *  "말소사항포함"이 들어간 것 중, false면 안 들어간 것 중 파일이름 기준 가장 최신 것을
 *  씁니다. 못 찾으면 null. */
export async function fetchCorporateRegistryPdf(includeCancelled: boolean): Promise<Buffer | null> {
  const predicate = includeCancelled
    ? (name: string) => name.includes('말소사항포함')
    : (name: string) => !name.includes('말소사항포함')
  return fetchLatestPdfFromFolder(CORPORATE_REGISTRY_FOLDER, '법인등기부등본', predicate)
}

// "원본대조필"/"사실과상위없음" 도장 이미지가 있는 폴더 — 같은 도장이 배경 제거 버전으로
// 여러 장(_1~_5) 들어있는데, 어느 걸 골라도 상관없어서(2026-09-03 사용자 확인: "아무거나")
// 이름순으로 첫 번째 것만 쓴다.
const COMPANY_STAMP_FOLDER = '/activo/04.제안팀/99.악티보포털참조용/04.도장/01.회사도장/원본대조필, 사실과상위없음도장'

export type CompanyStampType = '원본대조필' | '사실과상위없음'

/** NAS에서 "원본대조필" 또는 "사실과상위없음" 도장 이미지 중 하나를 받아옵니다.
 *  못 찾으면 null. */
export async function fetchCompanyStampPng(stampType: CompanyStampType): Promise<Buffer | null> {
  if (!NAS_BASE_URL || !NAS_USERNAME || !NAS_PASSWORD) {
    console.warn('[nas-client] NAS_BASE_URL/NAS_USERNAME/NAS_PASSWORD 환경변수가 없어 도장 조회를 건너뜁니다.')
    return null
  }
  return withNasRetry(`도장(${stampType}) 조회`, async sid => {
    const files = await listFolder(sid, COMPANY_STAMP_FOLDER)
    const prefix = `${stampType}_`
    const matched = files
      .filter(f => !f.isdir && f.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name))[0]
    if (!matched) throw new Error('도장 파일을 찾지 못함: ' + prefix)
    const buf = await downloadFile(sid, `${COMPANY_STAMP_FOLDER}/${matched.name}`)
    if (!buf) throw new Error('다운로드 실패: ' + matched.name)
    return buf
  })
}

/**
 * 인력 이름 목록으로 개인도장 PNG를 NAS에서 한 번에 찾아 반환합니다 (이름 → 파일 바이트,
 * 못 찾은 사람은 null). 로그인/로그아웃은 전체 목록에 대해 한 번만 하고, 사람별 다운로드는
 * 같은 세션(sid)으로 동시에 처리합니다.
 *
 * NAS 연동 자체가 실패해도(로그인 실패 등) 예외를 던지지 않고 전원 null로 채워 반환합니다 —
 * 호출 쪽에서 "못 찾으면 원래 템플릿 placeholder 그대로 둔다"로 처리하므로, NAS 문제가
 * PPT 생성 자체를 막으면 안 되기 때문입니다.
 */
export async function fetchPersonalStampPngs(personNames: string[]): Promise<Map<string, Buffer | null>> {
  const result = new Map<string, Buffer | null>(personNames.map(name => [name, null]))
  if (!NAS_BASE_URL || !NAS_USERNAME || !NAS_PASSWORD) {
    console.warn('[nas-client] NAS_BASE_URL/NAS_USERNAME/NAS_PASSWORD 환경변수가 없어 도장 조회를 건너뜁니다.')
    return result
  }

  let sid: string
  try {
    sid = await login()
  } catch (e) {
    console.warn('[nas-client] NAS 로그인 실패:', (e as Error).message)
    return result
  }

  try {
    await Promise.all(
      personNames.map(async name => {
        for (const sub of STAMP_SUBFOLDERS) {
          const path = `${STAMP_BASE_PATH}/${sub}/도장(${name}).png`
          const buf = await downloadFile(sid, path)
          if (buf) {
            result.set(name, buf)
            return
          }
        }
      })
    )
  } finally {
    await logout(sid)
  }

  return result
}
