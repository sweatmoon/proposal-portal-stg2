/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] "범용 템플릿(도장O)" 형태 —
 * 슬라이드 1장짜리 템플릿에 이미지 자리 2개(큰 자리=회사 서류 스캔본/PDF 페이지, 작은
 * 자리=회사 도장)가 있는 첨부 항목들이 전부 똑같은 조립 절차를 거치므로 공용 함수로 뺐다
 * (2026-09-03 — 사업자등록증에 이어 국세/지방세 납세증명서·법인등기부등본까지 같은 템플릿
 * 형태를 쓰게 되면서 4번째 중복이라 추출).
 *
 * 원본 자료(국세/지방세 납세증명서, 법인등기부등본 등)가 2페이지 이상이면 그 페이지 수만큼
 * 슬라이드를 복제해서 페이지 전부를 넣는다(2026-09-04 사용자 확인 — "참고하는 파일이
 * 2페이지 이상이면 모두 넣어야 함"). [제목]/[감리사업명]은 모든 페이지에 동일하게 채우고,
 * 큰 자리 이미지만 페이지 순서대로 다르게 채우며, 작은 자리(도장)는 공식 문서 관행대로
 * 모든 페이지에 똑같이 반복해서 찍는다.
 *
 * 사용하는 곳: src/routes/ppt-business-registration.ts, ppt-tax-certificate.ts,
 * ppt-local-tax-certificate.ts, ppt-corporate-registry.ts
 */
import JSZip from 'jszip'
import { applyPlaceholderMap } from './pptx-runtext.js'
import { findPicPlaceholdersBySize, replaceOnePlaceholder } from './pptx-image-swap.js'
import { buildMultiSlideDeck } from './pptx-deck.js'

export async function buildStampedDeckZip(
  templateBuf: Buffer,
  commonMap: Record<string, string>,
  bigImages: Buffer[],
  smallImage: Buffer | null,
  mediaPrefix: string
): Promise<JSZip> {
  if (bigImages.length === 0) throw new Error('표시할 이미지를 찾지 못했습니다')

  const zip = await JSZip.loadAsync(templateBuf)

  const sharedPartNames = Object.keys(zip.files).filter(
    f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
  )
  for (const partName of sharedPartNames) {
    const partXml = await zip.file(partName)!.async('string')
    const patched = applyPlaceholderMap(partXml, commonMap)
    if (patched !== partXml) zip.file(partName, patched)
  }

  // 템플릿 슬라이드(1장)를 원본 페이지 수만큼 복제한다 — 페이지가 1장이면 기존과 동일하게
  // 슬라이드 1장짜리 결과가 나온다. chunk 값(bigImages 각 원소)은 여기서는 안 쓰고,
  // 아래에서 슬라이드 번호로 다시 매핑해 채운다(financial-statement/consent와 같은 패턴).
  await buildMultiSlideDeck(zip, templateSlideXml => applyPlaceholderMap(templateSlideXml, commonMap), bigImages)

  for (let i = 0; i < bigImages.length; i++) {
    const slideNum = i + 1
    const slideFile = `ppt/slides/slide${slideNum}.xml`
    const placeholders = await findPicPlaceholdersBySize(zip, slideFile)
    if (placeholders.length < 2) {
      throw new Error('템플릿에서 이미지 자리를 2개(큰 자리+작은 자리) 찾지 못했습니다')
    }
    const [bigTarget, smallTarget] = [placeholders[0].target, placeholders[placeholders.length - 1].target]

    // 큰 자리(스캔본/PDF 페이지)는 템플릿이 정한 자리를 그대로 채운다 — 실제 비율에 맞춰
    // 자리를 다시 계산하면(preserveAspectRatio) 이미지가 자리보다 좁을 때 자리가 오른쪽으로
    // 밀려 보이므로 끈다. 작은 자리(도장)는 원래 비율 유지가 필요해서 켠다.
    await replaceOnePlaceholder(zip, slideFile, bigTarget, bigImages[i], `${mediaPrefix}_big_${slideNum}.png`, false)
    if (smallImage) {
      await replaceOnePlaceholder(zip, slideFile, smallTarget, smallImage, `${mediaPrefix}_stamp_${slideNum}.png`, true)
    }
  }

  return zip
}
