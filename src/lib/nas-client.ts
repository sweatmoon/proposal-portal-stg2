/**
 * [ppt-portal 추가 기능 — 시험 적용] Synology NAS(QuickConnect)에서 인력 개인도장 이미지를
 * 가져오는 클라이언트. 2026-09-02 사용자 확인 — NAS를 "유사 DB" 개념으로 써서, PPT 생성
 * 시점에 필요한 파일(우선 개인도장)을 그때그때 조회해 쓰는 실험적 연동입니다.
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
