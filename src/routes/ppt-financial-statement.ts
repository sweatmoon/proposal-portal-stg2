/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "표준재무제표" PPT 생성
 * (새로 추가된 파일 — 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식 방법은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 이 항목은 다른 항목(일정표/실적경력/동의서)과 달리 사업별 인력·키워드 데이터와 전혀
 * 무관합니다 — 회사 표준재무제표는 어느 사업이든 항상 같은 내용이기 때문입니다
 * (2026-09-02 사용자 확인). 그래서:
 *   1) NAS(Synology)의 "18.표준재무제표" 폴더에서 최신 pptx 원본을 통째로 받아온다
 *      (src/lib/nas-client.ts의 fetchStandardFinancialStatementPptx — 인력 이름 같은
 *      조회 키가 필요 없다).
 *   2) 그 pptx는 재무제표 스캔본을 슬라이드 1장당 1페이지(=1이미지)씩 담고 있다
 *      (2026-09-02 확인 — 9슬라이드, 각각 A4 스캔 이미지 1장). 슬라이드 순서대로
 *      이미지 바이트만 뽑아낸다.
 *   3) 사용자가 올린 "범용" 1슬라이드 템플릿(표지·목차 등과 같은 자리에 placeholder
 *      이미지 하나만 있는 템플릿)을 페이지 수만큼 복제하고, 슬라이드마다 그 페이지의
 *      실제 이미지로 바꿔치기한다(공용 유틸 — src/lib/pptx-image-swap.ts, 동의서의
 *      개인도장 교체와 완전히 같은 방식을 재사용).
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장
 *    없음). NAS에서 받아온 표준재무제표 원본도 마찬가지로 이 요청 처리 중에만 메모리에
 *    있다가 폐기됩니다.
 *
 * POST /api/ppt-financial-statement/:projectId
 *   multipart/form-data: template (.pptx, 1슬라이드, placeholder 이미지 포함)
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'
import { findPlaceholderImageTarget, replaceSlideImages } from '../lib/pptx-image-swap.js'
import { fetchStandardFinancialStatementPptx } from '../lib/nas-client.js'

const app = new Hono()

const PAGE_TITLE = '표준재무제표'

export interface FinancialStatementZipResult {
  zip: JSZip
  pageCount: number
  projectName: string
}

/** NAS에서 받아온 표준재무제표 pptx를 슬라이드 순서대로 열어, 각 슬라이드의 이미지
 *  바이트를 그 순서 그대로 뽑아낸다(슬라이드 1장 = 재무제표 스캔본 1페이지 = 이미지 1장). */
async function extractPageImages(sourcePptx: Buffer): Promise<Buffer[]> {
  const zip = await JSZip.loadAsync(sourcePptx)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))

  const images: Buffer[] = []
  for (const sf of slideFiles) {
    const relsFile = sf.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relsXml = await zip.file(relsFile)?.async('string')
    if (!relsXml) continue
    const m = relsXml.match(/<Relationship[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/)
    if (!m) continue
    // Target은 슬라이드 파트 기준 상대경로(예: "../media/image1.png") — ppt/ 밑 경로로 바꿔 읽는다.
    const mediaPath = 'ppt/' + m[1].replace(/^(\.\.\/)+/, '')
    const mediaFile = zip.file(mediaPath)
    if (!mediaFile) continue
    images.push(await mediaFile.async('nodebuffer'))
  }
  return images
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("4. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildFinancialStatementZip(
  templateBuf: Buffer,
  projectId: number,
  titlePrefix = ''
): Promise<FinancialStatementZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const sourcePptx = await fetchStandardFinancialStatementPptx()
  if (!sourcePptx) throw new Error('NAS에서 표준재무제표 원본 파일을 가져오지 못했습니다')

  const pageImages = await extractPageImages(sourcePptx)
  if (!pageImages.length) throw new Error('표준재무제표 원본 파일에서 이미지를 찾지 못했습니다')

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${PAGE_TITLE}`,
    '[감리사업명]': project.project_name,
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

  // buildMultiSlideDeck이 슬라이드를 지우기 전에 placeholder 이미지 관계를 미리 기록해둔다.
  const placeholderImageTarget = await findPlaceholderImageTarget(zip)

  // 페이지별로 다른 텍스트가 없으므로 chunk 값 자체는 안 쓰고, pageImages 개수만큼
  // 슬라이드를 복제하는 용도로만 chunks 배열을 넘긴다.
  await buildMultiSlideDeck(zip, templateSlideXml => applyPlaceholderMap(templateSlideXml, commonMap), pageImages)

  if (placeholderImageTarget) {
    await replaceSlideImages(zip, pageImages, placeholderImageTarget, 'finpage')
  }

  return { zip, pageCount: pageImages.length, projectName: project.project_name }
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
    const { zip, pageCount, projectName } = await buildFinancialStatementZip(templateBuf, projectId)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('표준재무제표_' + safeName)}.pptx"`)
    c.header('X-Page-Count', String(pageCount))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-financial-statement] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
