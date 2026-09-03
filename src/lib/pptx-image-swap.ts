/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * 템플릿 안에 들어있는 "placeholder 이미지"(예: "도장"이라고 적힌 더미 그림)를,
 * buildMultiSlideDeck으로 슬라이드를 복제한 뒤 슬라이드마다 다른 실제 이미지로 바꿔치기하는
 * 공용 로직. 관계(rels)의 Target 문자열을 바꾸는 것과 별개로, 원본 placeholder 그림과
 * 실제 이미지의 가로세로 비율이 다르면 늘어나 찌그러져 보이므로, 슬라이드 XML의 그림
 * 위치/크기(<a:off>/<a:ext>)도 실제 이미지의 원본 비율에 맞게 다시 계산해서 같이 바꾼다
 * (2026-09-03 사용자 확인 — "도장이 찌그러지는데 원본 비율 그대로... 오른쪽 좌표만
 * 고정하고"). 규칙: 높이(cy)는 템플릿이 정한 자리 그대로 유지하고, 폭(cx)만 이미지의
 * 실제 비율에 맞게 다시 계산하며, 오른쪽 끝 x좌표(원래 x + 원래 cx)는 고정한 채 폭이
 * 늘거나 줄어드는 만큼 왼쪽(x)만 움직인다 — 이미지가 원래 자리보다 좁아지면 오른쪽은
 * 그대로, 왼쪽만 안으로 들어오는 식.
 *
 * 이 파일은 아래 세 곳에서 재사용한다:
 *   - src/routes/ppt-consent.ts: 사람별 개인도장 (사람 순서 = 슬라이드 순서)
 *   - src/routes/ppt-financial-statement.ts: 표준재무제표 페이지별 스캔 이미지 (페이지 순서 = 슬라이드 순서)
 *   - src/routes/ppt-business-registration.ts: 슬라이드 1장 안의 큰 자리(스캔본)/작은 자리(도장)
 *
 * 사용 순서:
 *   1) buildMultiSlideDeck 호출 "전에" findPlaceholderImageTarget(zip)으로 원본 템플릿의
 *      placeholder 이미지 관계 Target을 기록해둔다 (복제 후에는 원본 슬라이드가 사라지므로
 *      반드시 미리 읽어야 한다 — buildMultiSlideDeck도 같은 이유로 내부에서 이렇게 한다).
 *   2) buildMultiSlideDeck으로 슬라이드를 필요한 개수만큼 복제한다.
 *   3) replaceSlideImages(zip, images, placeholderTarget, prefix)로 슬라이드 순서대로
 *      이미지를 갈아끼운다. images[i]가 null이면 그 슬라이드는 건드리지 않고 원본
 *      placeholder 그림을 그대로 둔다(이미지를 못 구해도 생성 자체는 막지 않기 위함).
 *
 * 슬라이드 복제 없이 "슬라이드 1장에 이미지 자리가 2개"인 경우(예: 사업자등록증 — 큰
 * 자리=스캔본, 작은 자리=도장. 두 자리는 겉보기 placeholder 그림이 똑같아서 내용으로는
 * 구분이 안 되고, 슬라이드에서 차지하는 크기로만 구분됨)는 findPicPlaceholdersBySize +
 * replaceOnePlaceholder를 쓴다 — src/routes/ppt-business-registration.ts 참고.
 */
import type JSZip from 'jszip'

/** PNG 파일의 실제 가로/세로 픽셀 크기를 헤더에서 바로 읽는다(라이브러리 없이 —
 *  PNG 시그니처 8바이트 다음 IHDR 청크의 처음 8바이트가 항상 width/height, 빅엔디안).
 *  PNG가 아니거나 헤더가 예상과 다르면 null(호출 쪽에서 비율 보정 없이 원래 자리 그대로 둔다). */
function getPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** relsXml에서 target을 가리키는 관계의 Id(rId)를 찾는다. */
function findRelIdByTarget(relsXml: string, target: string): string | null {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = relsXml.match(new RegExp(`<Relationship[^>]*Id="(rId\\d+)"[^>]*Target="${escaped}"`))
  return m ? m[1] : null
}

/**
 * slideXml 안에서 rId를 참조하는 <p:pic>을 찾아, 그 위치/크기(<a:off>/<a:ext>)를 이미지의
 * 실제 비율에 맞게 다시 계산해서 바꾼 slideXml을 반환한다. 못 찾거나 이미지가 PNG가
 * 아니면 원래 slideXml을 그대로 반환한다(찌그러지더라도 생성 자체는 막지 않기 위함).
 */
function resizePicToAspectRatio(slideXml: string, rId: string, imgBuf: Buffer): string {
  const dims = getPngDimensions(imgBuf)
  if (!dims || dims.width <= 0 || dims.height <= 0) return slideXml

  for (const picMatch of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const pic = picMatch[0]
    if (!pic.includes(`r:embed="${rId}"`)) continue

    const offMatch = pic.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/)
    const extMatch = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)
    if (!offMatch || !extMatch) return slideXml

    const origX = Number(offMatch[1])
    const origY = Number(offMatch[2])
    const origCx = Number(extMatch[1])
    const origCy = Number(extMatch[2])

    // 높이는 템플릿이 정한 자리 그대로 두고, 폭만 이미지의 실제 비율(width/height)에 맞게
    // 다시 계산한다. 오른쪽 끝(원래 x + 원래 cx)은 고정하고 왼쪽(x)만 움직인다.
    const newCx = Math.round(origCy * (dims.width / dims.height))
    const newX = origX + origCx - newCx

    const newPic = pic
      .replace(/<a:off x="-?\d+" y="-?\d+"\s*\/>/, `<a:off x="${newX}" y="${origY}"/>`)
      .replace(/<a:ext cx="\d+" cy="\d+"\s*\/>/, `<a:ext cx="${newCx}" cy="${origCy}"/>`)
    return slideXml.replace(pic, newPic)
  }
  return slideXml
}

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
 * placeholder 이미지 관계의 Target을 images[i]로 바꿔치기하고, 그 그림 자리를 images[i]의
 * 실제 비율에 맞게 다시 계산한다(오른쪽 좌표 고정, 높이 고정 — 파일 상단 설명 참고).
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
    const slideFileName = `ppt/slides/slide${slideNum}.xml`
    const relsFileName = `ppt/slides/_rels/slide${slideNum}.xml.rels`
    const relsFile = zip.file(relsFileName)
    const slideFile = zip.file(slideFileName)
    if (!relsFile || !slideFile) continue
    const relsXml = await relsFile.async('string')
    if (!relsXml.includes(`Target="${placeholderTarget}"`)) continue

    const rId = findRelIdByTarget(relsXml, placeholderTarget)

    const mediaPath = `ppt/media/${mediaPrefix}_${slideNum}.png`
    zip.file(mediaPath, imgBuf)

    // placeholderTarget은 슬라이드 파트 기준 상대경로(예: "../media/image3.png") —
    // 새 이미지도 같은 media 폴더에 두므로 마지막 파일명만 바꿔치기하면 된다.
    const newTarget = placeholderTarget.replace(/[^/]+$/, `${mediaPrefix}_${slideNum}.png`)
    zip.file(relsFileName, relsXml.replace(`Target="${placeholderTarget}"`, `Target="${newTarget}"`))

    if (rId) {
      const slideXml = await slideFile.async('string')
      zip.file(slideFileName, resizePicToAspectRatio(slideXml, rId, imgBuf))
    }
  }
}

/**
 * 슬라이드 1장 안에 이미지 자리가 여러 개 있고, 그 자리들을 "슬라이드에서 차지하는
 * 크기"(가로×세로, EMU 단위)로만 구분해야 할 때 쓴다 — 예시 그림이 다 똑같아서 내용으로는
 * 구분이 안 되는 경우(사업자등록증: 큰 자리=스캔본, 작은 자리=도장).
 * 반환값은 면적 내림차순 정렬 — [0]이 가장 큰 자리, 마지막이 가장 작은 자리.
 * buildMultiSlideDeck을 안 쓰는(슬라이드 복제가 없는) 템플릿에 대해서만 쓴다.
 */
export async function findPicPlaceholdersBySize(
  zip: JSZip,
  slideFile: string
): Promise<{ target: string; area: number }[]> {
  const xml = await zip.file(slideFile)?.async('string')
  const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
  const relsXml = await zip.file(relsFile)?.async('string')
  if (!xml || !relsXml) return []

  const relTargetById = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/g)) {
    relTargetById.set(m[1], m[2])
  }

  const results: { target: string; area: number }[] = []
  for (const picMatch of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const pic = picMatch[0]
    const embedMatch = pic.match(/r:embed="(rId\d+)"/)
    const extMatch = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
    if (!embedMatch || !extMatch) continue
    const target = relTargetById.get(embedMatch[1])
    if (!target) continue
    results.push({ target, area: Number(extMatch[1]) * Number(extMatch[2]) })
  }
  results.sort((a, b) => b.area - a.area)
  return results
}

/** findPicPlaceholdersBySize로 찾은 자리 하나(target)를 실제 이미지로 바꿔치기하고, 그
 *  이미지의 실제 비율에 맞게 자리를 다시 계산한다(오른쪽 좌표 고정, 높이 고정). 슬라이드
 *  복제가 없는 단일 슬라이드 전용 — replaceSlideImages와 달리 슬라이드 번호가 없으므로
 *  media 파일명을 mediaName으로 그대로 지정한다. */
export async function replaceOnePlaceholder(
  zip: JSZip,
  slideFile: string,
  target: string,
  imgBuf: Buffer,
  mediaName: string
): Promise<void> {
  const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
  const relsXml = await zip.file(relsFile)?.async('string')
  if (!relsXml || !relsXml.includes(`Target="${target}"`)) return

  const rId = findRelIdByTarget(relsXml, target)

  zip.file(`ppt/media/${mediaName}`, imgBuf)
  const newTarget = target.replace(/[^/]+$/, mediaName)
  zip.file(relsFile, relsXml.replace(`Target="${target}"`, `Target="${newTarget}"`))

  if (rId) {
    const slideXml = await zip.file(slideFile)!.async('string')
    zip.file(slideFile, resizePicToAspectRatio(slideXml, rId, imgBuf))
  }
}
