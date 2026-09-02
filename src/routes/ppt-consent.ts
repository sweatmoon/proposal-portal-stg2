/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "3. 비상근 감리원 참여 동의서" PPT 생성
 * (이 파일은 새로 추가된 파일이며, 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식
 * 방법은 src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 첨부 템플릿(1슬라이드, [필드명] 플레이스홀더)을 해당 사업에 투입된
 * "비상근" 인력 수만큼 복제해서, 각 슬라이드를 그 사람의 데이터로 채웁니다.
 *
 * 필드 매핑 (2026-08-28 사용자 확인 완료):
 *   [제목]           고정 문자열 "비상근 감리원 참여 동의서"
 *   [소속]           고정 문자열 "악티보"
 *   [직위]           고정 문자열 "비상근"
 *   [이름]           proposal_members.person_name
 *   [분야]           proposal_members.domain
 *   [생년월일]        personnel.birthdate (원본 YYMMDD) → "YYYY.MM.DD"
 *   [감리사업명]      audit_projects.project_name
 *   [주관기관]        audit_projects.client_org
 *   [입찰마감일하루전] audit_projects.bid_deadline(YYYY-MM-DD) - 1일 → "YYYY년 M월 D일" (0 생략)
 *
 * "비상근" 판정: proposal_members.is_fulltime = 0
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장 없음).
 *
 * POST /api/ppt-consent/:projectId
 *   multipart/form-data: template (.pptx, 1슬라이드)
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { query, queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'

const app = new Hono()

const FIXED_TITLE = '비상근 감리원 참여 동의서'
const FIXED_AFFIL = '악티보'
// 템플릿에서 [소속][직위]가 공백 없이 붙어있으므로, "악티보 비상근"으로 읽히도록
// [직위] 값 앞에 공백을 넣습니다.
const FIXED_POSITION = ' 비상근'

interface NonFulltimePerson {
  person_name: string
  domain: string | null
  birthdate: string | null // personnel.birthdate, "YYMMDD"
}

/** personnel.birthdate ("YYMMDD") → "YYYY.MM.DD". 2자리 연도의 세기는
 *  현재 연도의 뒤 두 자리보다 크면 1900년대, 작거나 같으면 2000년대로 추정합니다. */
function formatBirthdate(yymmdd: string | null): string {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return ''
  const yy = Number(yymmdd.slice(0, 2))
  const mm = yymmdd.slice(2, 4)
  const dd = yymmdd.slice(4, 6)
  const currentYY = new Date().getFullYear() % 100
  const century = yy > currentYY ? 1900 : 2000
  return `${century + yy}.${mm}.${dd}`
}

/** 이름 마지막 글자의 받침 유무에 따라 "은"/"는" 조사를 고른다.
 *  한글 음절(가~힣) 유니코드 공식: (코드 - 0xAC00) % 28 === 0 이면 받침 없음.
 *  받침 있음 → "은", 받침 없음 → "는" (표준 한국어 문법). */
function pickEunNeun(name: string): '은' | '는' {
  if (!name) return '은'
  const lastChar = name[name.length - 1]
  const code = lastChar.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return '은' // 한글 음절이 아니면 기본값
  const hasBatchim = code % 28 !== 0
  return hasBatchim ? '은' : '는'
}

/** audit_projects.bid_deadline ("YYYY-MM-DD") - 1일 → "YYYY년 M월 D일" (0 생략)
 *  서버 타임존과 무관하게 정확히 계산되도록 UTC 기준 날짜 산술만 사용합니다
 *  (로컬 타임존이 UTC인 서버에서 "+09:00" 오프셋을 붙여 파싱하면 날짜가
 *  하루 밀리는 문제가 있어, 문자열을 직접 파싱해 UTC로 계산합니다). */
function formatDeadlineMinusOneDay(bidDeadline: string | null): string {
  if (!bidDeadline) return ''
  const m = bidDeadline.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() - 1)
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
}

export interface ConsentZipResult {
  zip: JSZip
  peopleCount: number
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("3. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildConsentZip(templateBuf: Buffer, projectId: number, titlePrefix = ''): Promise<ConsentZipResult> {
    const project = await queryOne<Record<string, unknown>>(
      `SELECT project_name, client_org, bid_deadline FROM audit_projects WHERE id = $1`,
      [projectId]
    )
    if (!project) throw new Error('사업을 찾을 수 없습니다')

    const people = await query<NonFulltimePerson>(
      `SELECT pm.person_name, pm.domain, per.birthdate
       FROM proposal_members pm
       LEFT JOIN personnel per ON per.id = pm.personnel_id
       WHERE pm.project_id = $1 AND pm.is_fulltime = 0
       ORDER BY pm.person_name`,
      [projectId]
    )
    if (!people.length) {
      throw new Error('이 사업에 투입된 비상근 인력이 없습니다')
    }

    // ── 사업 공통 필드 (모든 슬라이드 공통) ─────────────────────
    const commonMap: Record<string, string> = {
      '[제목]': `${titlePrefix}${FIXED_TITLE}`,
      '[소속]': FIXED_AFFIL,
      '[직위]': FIXED_POSITION,
      '[감리사업명]': String(project.project_name ?? ''),
      '[주관기관]': String(project.client_org ?? ''),
      '[입찰마감일하루전]': formatDeadlineMinusOneDay(project.bid_deadline as string | null),
    }

    // ── 템플릿 로드 (메모리에서만, 저장 없음) ───────────────────
    const zip = await JSZip.loadAsync(templateBuf)

    // ── 슬라이드 레이아웃/마스터에도 같은 플레이스홀더가 있을 수 있음
    //    (예: 이 템플릿은 slideLayout에 [감리사업명] 푸터가 박혀 있음).
    //    레이아웃/마스터는 모든 슬라이드가 공유하므로, 인원별 값이 아니라
    //    사업 공통 값(commonMap)만 한 번씩 치환합니다. ─────────────
    const sharedPartNames = Object.keys(zip.files).filter(
      f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
    )
    for (const partName of sharedPartNames) {
      const partXml = await zip.file(partName)!.async('string')
      const patched = applyPlaceholderMap(partXml, commonMap)
      if (patched !== partXml) zip.file(partName, patched)
    }

    await buildMultiSlideDeck(
      zip,
      (templateSlideXml, person: NonFulltimePerson) => {
        // "[이름]은" 형태로 붙어있는 조사를 이름 받침에 맞게 "은"/"는"으로 바꿔치기.
        // 반드시 아래 순서대로 넣어야 합니다 — '[이름]'을 먼저 넣으면 '[이름]은' 매칭이
        // 이미 부분적으로 치환된 뒤라 못 잡습니다 (치환은 맵에 넣은 순서대로 진행됨).
        const personMap: Record<string, string> = {
          '[이름]은': `${person.person_name}${pickEunNeun(person.person_name)}`,
          ...commonMap,
          '[이름]': person.person_name,
          '[분야]': person.domain ?? '',
          '[생년월일]': formatBirthdate(person.birthdate),
        }
        return applyPlaceholderMap(templateSlideXml, personMap)
      },
      people
    )

    return { zip, peopleCount: people.length, projectName: String(project.project_name ?? 'proposal') }
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
    const { zip, peopleCount, projectName } = await buildConsentZip(templateBuf, projectId)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('3_비상근감리원참여동의서_' + safeName)}.pptx"`)
    c.header('X-Slide-Count', String(peopleCount))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-consent] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
