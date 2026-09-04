/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "4대보험 가입확인서" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 지방세 납세증명서와 완전히 같은 형태 — 같은 "범용 템플릿(도장O)"를 쓰고, NAS 원본도
 * pptx가 아니라 파일이름 기준 가장 최신 .pdf를 쓴다(2026-09-04 사용자 확인).
 * src/lib/pdf-render.ts로 전체 페이지를 PNG로 렌더링한 뒤 buildStampedDeckZip에 넘긴다.
 *
 * POST /api/ppt-insurance-enrollment/:projectId
 *   multipart/form-data:
 *     - template: File (.pptx, 범용 템플릿(도장O))
 *     - stampType: "원본대조필" | "사실과상위없음"
 */
import { Hono } from 'hono'
import type JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { pdfAllPagesToPng } from '../lib/pdf-render.js'
import { buildStampedDeckZip } from '../lib/pptx-stamped-doc.js'
import { fetchInsuranceEnrollmentPdf, fetchCompanyStampPng, type CompanyStampType } from '../lib/nas-client.js'

const app = new Hono()

const PAGE_TITLE = '4대보험 가입확인서'
const STAMP_TYPES: CompanyStampType[] = ['원본대조필', '사실과상위없음']

export interface InsuranceEnrollmentZipResult {
  zip: JSZip
  projectName: string
}

export async function buildInsuranceEnrollmentZip(
  templateBuf: Buffer,
  projectId: number,
  stampType: CompanyStampType,
  titlePrefix = ''
): Promise<InsuranceEnrollmentZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const [sourcePdf, stampPng] = await Promise.all([
    fetchInsuranceEnrollmentPdf(),
    fetchCompanyStampPng(stampType),
  ])
  if (!sourcePdf) throw new Error('NAS에서 4대보험 가입확인서 원본 파일을 가져오지 못했습니다')

  const bigImages = await pdfAllPagesToPng(sourcePdf)

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[감리사업명]': project.project_name,
  }

  const zip = await buildStampedDeckZip(templateBuf, commonMap, bigImages, stampPng, 'insurance')

  return { zip, projectName: project.project_name }
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
    const stampTypeRaw = form.get('stampType')
    if (typeof stampTypeRaw !== 'string' || !STAMP_TYPES.includes(stampTypeRaw as CompanyStampType)) {
      return c.json({ ok: false, error: 'stampType은 "원본대조필" 또는 "사실과상위없음"이어야 합니다' }, 400)
    }

    const templateBuf = Buffer.from(await file.arrayBuffer())
    const { zip, projectName } = await buildInsuranceEnrollmentZip(templateBuf, projectId, stampTypeRaw as CompanyStampType)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('4대보험가입확인서_' + safeName)}.pptx"`)
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-insurance-enrollment] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
