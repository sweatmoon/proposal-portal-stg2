/**
 * [ppt-portal 추가 기능] "PPT 템플릿 관리 → 첨부 → 이미지 치환" 탭에서 "+" 버튼으로 이름과
 * NAS 경로만 입력해 새로 등록한 첨부서류를 위한 범용 조립 함수(2026-09-10 사용자 확인 —
 * "이 탭에서 + 누르고 이름과 경로만 입력하면 쓸 수 있도록"). 기존 6개 고정 항목(표준재무제표/
 * 사업자등록증/국세·지방세 납세증명서/법인등기부등본/4대보험)은 각자 파일에 특수 처리가
 * 있어서(예: 법인등기부등본의 말소사항 포함/미포함 필터) 그대로 각자의 build*Zip을 쓰고,
 * 이 함수는 그런 특수 처리가 필요 없는 "폴더에서 최신 pptx/pdf 하나 가져와 템플릿에
 * 끼워넣기"만 하는 새 항목 전용이다 — src/routes/ppt-attachment-bundle.ts가 정적 레지스트리에
 * 없는 첨부 항목 id를 만나면(= "+"로 새로 추가된 항목) 이 함수로 처리한다.
 *
 * "범용 템플릿(도장O)"(ATT_STAMP_YES) 밑에 추가된 항목이면 stampType을 넘겨 도장까지
 * 찍고(큰 자리+작은 자리 2개짜리 템플릿, pptx-stamped-doc.ts 재사용), "범용 템플릿(도장X)"
 * (ATT_STAMP_NO) 밑에 추가된 항목이면 stampType 없이 자리 1개짜리 템플릿에 이미지만
 * 끼워넣는다(표준재무제표와 같은 방식, ppt-financial-statement.ts 참고).
 */
import JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { applyPlaceholderMap } from './pptx-runtext.js'
import { buildMultiSlideDeck } from './pptx-deck.js'
import { findPlaceholderImageTarget, replaceSlideImages, extractAllImagesFromPptx } from './pptx-image-swap.js'
import { buildStampedDeckZip } from './pptx-stamped-doc.js'
import { pdfAllPagesToPng } from './pdf-render.js'
import { fetchLatestPptxOrPdfFromFolder, fetchLatestPdfFromFolder, fetchCompanyStampPng, type CompanyStampType } from './nas-client.js'

export interface GenericImageReplaceZipResult {
  zip: JSZip
  projectName: string
}

/**
 * filenamePredicate: 법인등기부등본의 "말소사항 포함/미포함"처럼, 한 폴더 안에 파일명으로
 * 구분되는 여러 종류(variant_options, 2026-09-10 사용자 확인 — "특수 필터/조건... 저걸로
 * 모든걸 해결 가능하게 만들어야해")가 있을 때 그 중 사용자가 고른 종류만 걸러낸다. 넘기면
 * (해당 폴더가 pdf만 있다는 전제로) fetchLatestPdfFromFolder를 predicate와 함께 쓰고,
 * 안 넘기면(옵션이 아예 없는 보통의 경우) 기존처럼 pptx/pdf 상관없이 최신 파일을 쓴다.
 */
export async function buildGenericImageReplaceZip(
  templateBuf: Buffer,
  projectId: number,
  label: string,
  nasPath: string,
  stampType: CompanyStampType | null,
  titlePrefix = '',
  filenamePredicate?: (name: string) => boolean
): Promise<GenericImageReplaceZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const [sourceFile, stampPng] = await Promise.all([
    filenamePredicate
      ? fetchLatestPdfFromFolder(nasPath, label, filenamePredicate).then(buf => (buf ? { buf, isPdf: true as const } : null))
      : fetchLatestPptxOrPdfFromFolder(nasPath, label),
    stampType ? fetchCompanyStampPng(stampType) : Promise.resolve(null),
  ])
  if (!sourceFile) throw new Error(`NAS에서 "${label}" 원본 파일을 가져오지 못했습니다 (경로: ${nasPath})`)

  const bigImages = sourceFile.isPdf
    ? await pdfAllPagesToPng(sourceFile.buf)
    : await extractAllImagesFromPptx(sourceFile.buf)
  if (!bigImages.length) throw new Error(`"${label}" 원본 파일에서 이미지를 찾지 못했습니다`)

  const commonMap: Record<string, string> = {
    '[제목]': `${titlePrefix}${label}`,
    '[감리사업명]': project.project_name,
  }

  let zip: JSZip
  if (stampType) {
    // 도장O 슬롯 — 큰 자리(스캔본)+작은 자리(도장) 2개짜리 템플릿.
    zip = await buildStampedDeckZip(templateBuf, commonMap, bigImages, stampPng, 'generic')
  } else {
    // 도장X 슬롯 — 자리 1개짜리 템플릿(표준재무제표와 동일 패턴).
    zip = await JSZip.loadAsync(templateBuf)
    const sharedPartNames = Object.keys(zip.files).filter(
      f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
    )
    for (const partName of sharedPartNames) {
      const partXml = await zip.file(partName)!.async('string')
      const patched = applyPlaceholderMap(partXml, commonMap)
      if (patched !== partXml) zip.file(partName, patched)
    }
    const placeholderImageTarget = await findPlaceholderImageTarget(zip)
    await buildMultiSlideDeck(zip, templateSlideXml => applyPlaceholderMap(templateSlideXml, commonMap), bigImages)
    if (placeholderImageTarget) {
      await replaceSlideImages(zip, bigImages, placeholderImageTarget, 'genericpage')
    }
  }

  return { zip, projectName: project.project_name }
}
