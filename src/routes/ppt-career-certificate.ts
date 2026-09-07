/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "경력증명서" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 재직증명서와 필드 구성이 거의 같아 실제 조립 로직을 공유한다 —
 * src/lib/employee-certificate-doc.ts 참고. 담당업무(원본 엑셀의 "주요업무")도
 * 재직증명서와 마찬가지로 템플릿에 고정 텍스트로 이미 박혀있어 별도 처리하지 않는다.
 *
 * POST /api/ppt-career-certificate/:projectId
 *   multipart/form-data: template (.pptx, 1슬라이드)
 */
import { Hono } from 'hono'
import type JSZip from 'jszip'
import { buildEmployeeCertificateZip } from '../lib/employee-certificate-doc.js'

const app = new Hono()

const PAGE_TITLE = '경력증명서'

export interface CareerCertificateZipResult {
  zip: JSZip
  personCount: number
  skipped: string[]
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("7. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildCareerCertificateZip(
  templateBuf: Buffer,
  projectId: number,
  titlePrefix = ''
): Promise<CareerCertificateZipResult> {
  return buildEmployeeCertificateZip(templateBuf, projectId, PAGE_TITLE, titlePrefix)
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
    const { zip, personCount, skipped, projectName } = await buildCareerCertificateZip(templateBuf, projectId)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('경력증명서_' + safeName)}.pptx"`)
    c.header('X-Slide-Count', String(personCount))
    c.header('X-Skipped', encodeURIComponent(skipped.join(',')))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-career-certificate] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
