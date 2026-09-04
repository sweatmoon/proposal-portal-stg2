/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "재직증명서" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 경력표/동의서와 같은 패턴 — 이 사업에 투입된 proposal_members 전원에 대해 슬라이드를
 * 한 장씩 복제해서 채운다. 사람 데이터 출처가 personnel DB가 아니라 NAS의
 * "00.재직증명서발행파일v4.xlsm"(회사 HR 담당자가 수동으로 관리하는 엑셀, 2026-09-04
 * 확인 — 이 참조용 폴더에 새로 올라와서 웹에서도 접근 가능해짐)라는 점만 다르다.
 * 엑셀 프로그램이나 그 안의 매크로는 실행하지 않고, src/lib/xlsx-employee-lookup.ts로
 * "직원정보" 시트의 값만 데이터로 읽어서 쓴다.
 *
 * 필드 매핑 (2026-09-04 사용자 확인):
 *   [제목]           고정 문자열 "재직증명서"
 *   [이름]           직원정보.이름 그대로 표시 — 동명이인 구분용 접미사(예: "김영범A")가
 *                    있어도 그대로 나온다("이름 표시는 그냥 따로 바꿀게 아무것도 하지
 *                    말고 그냥 김영범A로 표시해"). 나중에 접미사를 뗀 진짜 이름으로
 *                    바꾸고 싶어지면 xlsx-employee-lookup.ts의 formatDisplayName()만
 *                    고치면 된다.
 *   [입사일자]        직원정보.입사일(YYYY.MM.DD) + "." — 원본 엑셀 형식 그대로
 *   [생년월일]        직원정보.주민번호 앞 6자리 → "YYYY년 MM월 DD일"
 *   [직위]           직원정보.직위
 *   [근무부서]        직원정보.근무부서
 *   [입사일]         직원정보.입사일을 "YYYY년 MM월 DD일"로 (재직기간 문장에 사용)
 *   [제출마감하루전]   audit_projects.bid_deadline(YYYY-MM-DD) - 1일 → "YYYY년 MM월 DD일"
 *                    (2026-09-04 사용자 확인 — 입찰마감일 하루 전 날짜)
 *   "용도"는 템플릿에 "기관 제출용"으로 고정 텍스트가 이미 박혀있어 손대지 않는다
 *   (2026-09-04 사용자 확인 — "재직기간이나 용도 입력창 추가하지 마").
 *
 * 직원정보에 이름이 없거나(엑셀에 없는 사람) 퇴직 처리돼있으면(현재 재직 중이 아니므로
 * "재직"증명서를 낼 수 없음) 그 사람은 건너뛴다 — personnel DB 매칭 실패를 건너뛰는
 * ppt-career.ts와 같은 원칙.
 *
 * ⚠️ 템플릿 파일과 NAS에서 받아온 엑셀은 이 요청 처리 중에만 메모리에 있다가 폐기됩니다
 *    (DB/디스크 저장 없음).
 *
 * POST /api/ppt-employment-certificate/:projectId
 *   multipart/form-data: template (.pptx, 1슬라이드)
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { query, queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'
import { fetchEmploymentCertificateSourceXlsx } from '../lib/nas-client.js'
import {
  loadEmployeeDirectory,
  formatBirthdate,
  formatDateKorean,
  formatHireDateWithDot,
  dayBeforeDeadlineKorean,
  formatDisplayName,
} from '../lib/xlsx-employee-lookup.js'

const app = new Hono()

const PAGE_TITLE = '재직증명서'

interface ProjectMember {
  person_name: string
}

interface PersonChunk {
  name: string
  hireDateWithDot: string
  birthdate: string
  position: string
  department: string
  hireDateKorean: string
}

export interface EmploymentCertificateZipResult {
  zip: JSZip
  personCount: number
  skipped: string[]
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("6. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildEmploymentCertificateZip(
  templateBuf: Buffer,
  projectId: number,
  titlePrefix = ''
): Promise<EmploymentCertificateZipResult> {
  const [project, members, sourceXlsx] = await Promise.all([
    queryOne<{ project_name: string; bid_deadline: string | null }>(
      `SELECT project_name, bid_deadline FROM audit_projects WHERE id = $1`,
      [projectId]
    ),
    query<ProjectMember>(`SELECT person_name FROM proposal_members WHERE project_id = $1 ORDER BY id ASC`, [projectId]),
    fetchEmploymentCertificateSourceXlsx(),
  ])
  if (!project) throw new Error('사업을 찾을 수 없습니다')
  if (!members.length) throw new Error('이 사업에 투입된 인력이 없습니다')
  if (!sourceXlsx) throw new Error('NAS에서 재직증명서 발행파일을 가져오지 못했습니다')
  if (!project.bid_deadline) throw new Error('이 사업의 입찰마감일이 등록돼 있지 않습니다 (재직기간 계산에 필요합니다)')

  const deadlineMinusOne = dayBeforeDeadlineKorean(project.bid_deadline)
  const directory = await loadEmployeeDirectory(sourceXlsx)

  const chunks: PersonChunk[] = []
  const skipped: string[] = []

  for (const m of members) {
    const record = directory.get(m.person_name)
    if (!record || record.resigned) {
      skipped.push(m.person_name)
      continue
    }
    chunks.push({
      name: formatDisplayName(record.name),
      hireDateWithDot: formatHireDateWithDot(record.hireDateRaw),
      birthdate: formatBirthdate(record.residentNumberPrefix),
      position: record.position,
      department: record.department,
      hireDateKorean: formatDateKorean(record.hireDateRaw),
    })
  }

  if (!chunks.length) {
    throw new Error('재직증명서 발행파일에서 매칭되는(재직 중인) 인력이 한 명도 없습니다 (' + skipped.join(', ') + ')')
  }

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[제출마감하루전]': deadlineMinusOne,
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

  await buildMultiSlideDeck(
    zip,
    (templateSlideXml, person: PersonChunk) => {
      const personMap: Record<string, string> = {
        ...commonMap,
        '[이름]': person.name,
        '[입사일자]': person.hireDateWithDot,
        '[생년월일]': person.birthdate,
        '[직위]': person.position,
        '[근무부서]': person.department,
        '[입사일]': person.hireDateKorean,
      }
      return applyPlaceholderMap(templateSlideXml, personMap)
    },
    chunks
  )

  return { zip, personCount: chunks.length, skipped, projectName: project.project_name }
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
    const { zip, personCount, skipped, projectName } = await buildEmploymentCertificateZip(templateBuf, projectId)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('재직증명서_' + safeName)}.pptx"`)
    c.header('X-Slide-Count', String(personCount))
    c.header('X-Skipped', encodeURIComponent(skipped.join(',')))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-employment-certificate] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
