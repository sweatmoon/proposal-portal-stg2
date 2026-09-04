/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "국세 납세증명서" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 사업자등록증과 완전히 같은 형태의 "범용 템플릿(도장O)"를 씁니다 — 슬라이드 1장에
 * 큰 자리(국세 납세증명서 스캔본)/작은 자리(원본대조필/사실과상위없음 도장). 실제 조립은
 * src/lib/pptx-stamped-doc.ts의 buildStampedSingleSlideZip을 그대로 재사용합니다
 * (2026-09-03 사용자 확인 — "전부 범용(도장O) 쓸 거임").
 *
 * 데이터 출처:
 *   - 큰 이미지: NAS "11.국세 납세증명서" 폴더의 pptx 원본에서 이미지를 뽑아 씀
 *     (사업/인력 데이터와 무관 — 회사 서류라 항상 동일).
 *   - 작은 이미지(도장): 사업자등록증과 같은 회사 도장 폴더에서, 사용자가 고른 종류로 받아 씀.
 *
 * POST /api/ppt-tax-certificate/:projectId
 *   multipart/form-data:
 *     - template: File (.pptx, 범용 템플릿(도장O))
 *     - stampType: "원본대조필" | "사실과상위없음"
 */
import { Hono } from 'hono'
import type JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { extractAllImagesFromPptx } from '../lib/pptx-image-swap.js'
import { buildStampedDeckZip } from '../lib/pptx-stamped-doc.js'
import { fetchTaxCertificatePptx, fetchCompanyStampPng, type CompanyStampType } from '../lib/nas-client.js'

const app = new Hono()

const PAGE_TITLE = '국세 납세증명서'
const STAMP_TYPES: CompanyStampType[] = ['원본대조필', '사실과상위없음']

export interface TaxCertificateZipResult {
  zip: JSZip
  projectName: string
}

export async function buildTaxCertificateZip(
  templateBuf: Buffer,
  projectId: number,
  stampType: CompanyStampType,
  titlePrefix = ''
): Promise<TaxCertificateZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const [sourcePptx, stampPng] = await Promise.all([
    fetchTaxCertificatePptx(),
    fetchCompanyStampPng(stampType),
  ])
  if (!sourcePptx) throw new Error('NAS에서 국세 납세증명서 원본 파일을 가져오지 못했습니다')

  const bigImages = await extractAllImagesFromPptx(sourcePptx)
  if (!bigImages.length) throw new Error('국세 납세증명서 원본 파일에서 이미지를 찾지 못했습니다')

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[감리사업명]': project.project_name,
  }

  const zip = await buildStampedDeckZip(templateBuf, commonMap, bigImages, stampPng, 'taxcert')

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
    const { zip, projectName } = await buildTaxCertificateZip(templateBuf, projectId, stampTypeRaw as CompanyStampType)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('국세납세증명서_' + safeName)}.pptx"`)
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-tax-certificate] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
