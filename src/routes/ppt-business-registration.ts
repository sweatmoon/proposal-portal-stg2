/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "사업자등록증" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식 방법은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 표준재무제표와 달리 이 항목은 "전용" 템플릿을 씁니다(2026-09-03 사용자 확인 — "범용"이
 * 아니라 이 항목만을 위해 만든 템플릿). 템플릿은 슬라이드 1장에 이미지 자리가 2개
 * 있습니다 — 큰 자리(사업자등록증 스캔본)와 작은 자리(원본대조필/사실과상위없음 도장).
 * 두 자리는 겉보기 placeholder 그림(빨간 바탕에 "예시")이 서로 똑같아서 내용으로는
 * 구분이 안 되고, 슬라이드에서 차지하는 크기로만 구분합니다(더 큰 쪽 = 스캔본 자리) —
 * src/lib/pptx-image-swap.ts의 findPicPlaceholdersBySize 참고.
 *
 * 데이터 출처:
 *   - 큰 이미지: NAS "01.사업자등록증" 폴더의 최신 pptx 원본에서 이미지를 뽑아 씀
 *     (사업/인력 데이터와 무관 — 회사 서류라 항상 동일).
 *   - 작은 이미지(도장): NAS "원본대조필, 사실과상위없음도장" 폴더에서, 사용자가 이 항목을
 *     체크할 때 고른 종류("원본대조필" 또는 "사실과상위없음")에 맞는 파일을 받아 씀
 *     (2026-09-03 사용자 확인 — 체크하면 둘 중 하나를 고르게 한 뒤 생성).
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장
 *    없음). NAS에서 받아온 원본들도 마찬가지로 이 요청 처리 중에만 메모리에 있다가 폐기됩니다.
 *
 * POST /api/ppt-business-registration/:projectId
 *   multipart/form-data:
 *     - template: File (.pptx, 1슬라이드, 이미지 자리 2개)
 *     - stampType: "원본대조필" | "사실과상위없음"
 */
import { Hono } from 'hono'
import type JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { extractAllImagesFromPptx } from '../lib/pptx-image-swap.js'
import { buildStampedDeckZip } from '../lib/pptx-stamped-doc.js'
import { fetchBusinessRegistrationPptx, fetchCompanyStampPng, type CompanyStampType } from '../lib/nas-client.js'

const app = new Hono()

const PAGE_TITLE = '사업자등록증'
const STAMP_TYPES: CompanyStampType[] = ['원본대조필', '사실과상위없음']

export interface BusinessRegistrationZipResult {
  zip: JSZip
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("5. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildBusinessRegistrationZip(
  templateBuf: Buffer,
  projectId: number,
  stampType: CompanyStampType,
  titlePrefix = ''
): Promise<BusinessRegistrationZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const [bizregSourcePptx, stampPng] = await Promise.all([
    fetchBusinessRegistrationPptx(),
    fetchCompanyStampPng(stampType),
  ])
  if (!bizregSourcePptx) throw new Error('NAS에서 사업자등록증 원본 파일을 가져오지 못했습니다')

  const bigImages = await extractAllImagesFromPptx(bizregSourcePptx)
  if (!bigImages.length) throw new Error('사업자등록증 원본 파일에서 이미지를 찾지 못했습니다')

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[감리사업명]': project.project_name,
  }

  const zip = await buildStampedDeckZip(templateBuf, commonMap, bigImages, stampPng, 'bizreg')

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
    const { zip, projectName } = await buildBusinessRegistrationZip(templateBuf, projectId, stampTypeRaw as CompanyStampType)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('사업자등록증_' + safeName)}.pptx"`)
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-business-registration] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
