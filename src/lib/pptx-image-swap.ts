/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * 템플릿 안에 들어있는 "placeholder 이미지"(예: "도장"이라고 적힌 더미 그림)를,
 * buildMultiSlideDeck으로 슬라이드를 복제한 뒤 슬라이드마다 다른 실제 이미지로 바꿔치기하는
 * 공용 로직. 관계(rels)의 Target 문자열만 바꾸는 방식이라 슬라이드 XML이나 관계 id는 그대로
 * 둔다 — 원본 template 자체를 규격화하지 않고도(위치·크기는 템플릿이 정한 그대로) 내용만
 * 갈아끼울 수 있어서, 아래 두 곳에서 그대로 재사용한다:
 *   - src/routes/ppt-consent.ts: 사람별 개인도장 (사람 순서 = 슬라이드 순서)
 *   - src/routes/ppt-financial-statement.ts: 표준재무제표 페이지별 스캔 이미지 (페이지 순서 = 슬라이드 순서)
 *
 * 사용 순서:
 *   1) buildMultiSlideDeck 호출 "전에" findPlaceholderImageTarget(zip)으로 원본 템플릿의
 *      placeholder 이미지 관계 Target을 기록해둔다 (복제 후에는 원본 슬라이드가 사라지므로
 *      반드시 미리 읽어야 한다 — buildMultiSlideDeck도 같은 이유로 내부에서 이렇게 한다).
 *   2) buildMultiSlideDeck으로 슬라이드를 필요한 개수만큼 복제한다.
 *   3) replaceSlideImages(zip, images, placeholderTarget, prefix)로 슬라이드 순서대로
 *      이미지를 갈아끼운다. images[i]가 null이면 그 슬라이드는 건드리지 않고 원본
 *      placeholder 그림을 그대로 둔다(이미지를 못 구해도 생성 자체는 막지 않기 위함).
 */
import type JSZip from 'jszip'

/**
 * zip의 첫 슬라이드에서 이미지 관계의 Target(예: "../media/image3.png")을 찾는다.
 * 복제 전(buildMultiSlideDeck 호출 전) 원본 템플릿에 대해서만 호출해야 한다 — 복제된
 * 슬라이드들은 전부 같은 Target을 상대경로로 그대로 물려받기 때문이다.
 */
export async function findPlaceholderImageTarget(zip: JSZip): Promise<string | null> {
  const templateSlideFile = Object.keys(zip.files).find(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  if (!templateSlideFile) return null
  const relsFile = templateSlideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
  const relsXml = await zip.file(relsFile)?.async('string')
  if (!relsXml) return null
  const m = relsXml.match(/<Relationship[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/)
  return m ? m[1] : null
}

/**
 * buildMultiSlideDeck로 복제된 슬라이드들(1번부터 순서대로, images 배열과 같은 순서)에서
 * placeholder 이미지 관계의 Target을 images[i]로 바꿔치기한다.
 */
export async function replaceSlideImages(
  zip: JSZip,
  images: (Buffer | null)[],
  placeholderTarget: string,
  mediaPrefix: string
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    const imgBuf = images[i]
    if (!imgBuf) continue

    const slideNum = i + 1
    const relsFileName = `ppt/slides/_rels/slide${slideNum}.xml.rels`
    const relsFile = zip.file(relsFileName)
    if (!relsFile) continue
    const relsXml = await relsFile.async('string')
    if (!relsXml.includes(`Target="${placeholderTarget}"`)) continue

    const mediaPath = `ppt/media/${mediaPrefix}_${slideNum}.png`
    zip.file(mediaPath, imgBuf)

    // placeholderTarget은 슬라이드 파트 기준 상대경로(예: "../media/image3.png") —
    // 새 이미지도 같은 media 폴더에 두므로 마지막 파일명만 바꿔치기하면 된다.
    const newTarget = placeholderTarget.replace(/[^/]+$/, `${mediaPrefix}_${slideNum}.png`)
    zip.file(relsFileName, relsXml.replace(`Target="${placeholderTarget}"`, `Target="${newTarget}"`))
  }
}
