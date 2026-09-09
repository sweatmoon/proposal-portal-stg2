/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] 템플릿 시트 오른쪽에 박혀
 * 있는 그림 자리 2개를 실제 자격증 이미지로 바꿔치기하는 유틸. src/lib/pptx-image-swap.ts의
 * 엑셀판 — 원리는 같지만(관계 Target 바꿔치기 + 실제 비율에 맞게 자리 재계산) 엑셀의 그림은
 * DrawingML의 스프레드시트용 앵커(<xdr:twoCellAnchor>)에 들어있어 파서를 따로 뺐다.
 *
 * 템플릿에 그림이 정확히 2개 있고(2026-09-08 실측 — 문서 순서대로 첫 번째가 "사과" 스톡
 * 사진: [감리원등급] 옆의 감리원증/수석감리원증 자리, 두 번째가 pxhere 스톡 사진: [자격명]
 * 옆의 자격증(기술사/감리사/정보처리기사) 자리), 문서 순서(=그림이 배치된 순서)로 첫
 * 번째/두 번째를 구분한다 — 파일명이나 관계 Id는 템플릿이 바뀌면 달라질 수 있어 믿지 않는다.
 */
import type JSZip from 'jszip'

/** PNG 파일의 실제 가로/세로 픽셀 크기를 헤더에서 바로 읽는다. pptx-image-swap.ts와 동일. */
function getPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function findRelIdByTarget(relsXml: string, target: string): string | null {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = relsXml.match(new RegExp(`<Relationship[^>]*Id="(rId\\d+)"[^>]*Target="${escaped}"`))
  return m ? m[1] : null
}

export interface XlsxPicRef {
  /** <xdr:twoCellAnchor>...</xdr:twoCellAnchor> 블록 전체(치환 위치를 다시 찾는 데 씀) */
  anchorXml: string
  rId: string
  target: string
}

/** drawingXml 안의 그림 자리(<xdr:pic>)들을 문서 순서 그대로 전부 찾아 반환한다.
 *  [0]이 "사과"(감리원등급 자리), [1]이 pxhere(자격명 자리) — 파일 상단 설명 참고. */
export function findXlsxPicRefs(drawingXml: string, relsXml: string): XlsxPicRef[] {
  const refs: XlsxPicRef[] = []
  for (const anchorMatch of drawingXml.matchAll(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/g)) {
    const anchorXml = anchorMatch[0]
    if (!anchorXml.includes('<xdr:pic>')) continue
    const embedMatch = anchorXml.match(/r:embed="(rId\d+)"/)
    if (!embedMatch) continue
    const rId = embedMatch[1]
    const targetMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="([^"]+)"`))
    if (!targetMatch) continue
    refs.push({ anchorXml, rId, target: targetMatch[1] })
  }
  return refs
}

/** anchorXml 안의 그림 위치/크기(<a:off>/<a:ext>)를 이미지의 실제 비율에 맞게 다시 계산.
 *  높이(cy)는 템플릿 자리 그대로 두고 폭(cx)만 비율에 맞게, 오른쪽 끝은 고정 —
 *  pptx-stamped-doc.ts와 같은 규칙. PNG가 아니면 원본 그대로 둔다. */
function resizeAnchorToAspectRatio(drawingXml: string, anchorXml: string, imgBuf: Buffer): string {
  const dims = getPngDimensions(imgBuf)
  if (!dims || dims.width <= 0 || dims.height <= 0) return drawingXml

  const offMatch = anchorXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/)
  const extMatch = anchorXml.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)
  if (!offMatch || !extMatch) return drawingXml

  const origX = Number(offMatch[1])
  const origY = Number(offMatch[2])
  const origCx = Number(extMatch[1])
  const origCy = Number(extMatch[2])

  const newCx = Math.round(origCy * (dims.width / dims.height))
  const newX = origX + origCx - newCx

  const newAnchorXml = anchorXml
    .replace(/<a:off x="-?\d+" y="-?\d+"\s*\/>/, `<a:off x="${newX}" y="${origY}"/>`)
    .replace(/<a:ext cx="\d+" cy="\d+"\s*\/>/, `<a:ext cx="${newCx}" cy="${origCy}"/>`)

  return drawingXml.replace(anchorXml, newAnchorXml)
}

/**
 * ref가 가리키는 그림을 imgBuf로 바꿔치기한다: media에 새 png를 추가하고 관계 Target을
 * 갈아끼운 뒤, 그림 자리를 imgBuf의 실제 비율에 맞게 다시 계산한다. zip/drawingXml/relsXml은
 * 호출 쪽에서 그대로 이어받아 다음 호출에 넘길 수 있도록 반환한다(같은 drawing 안에서
 * 그림을 2개 연달아 바꿔치기해야 하므로).
 */
export function replaceXlsxCertImage(
  zip: JSZip,
  drawingXml: string,
  relsXml: string,
  ref: XlsxPicRef,
  imgBuf: Buffer,
  mediaFileName: string
): { drawingXml: string; relsXml: string } {
  const mediaPath = `xl/media/${mediaFileName}`
  zip.file(mediaPath, imgBuf)

  const newTarget = ref.target.replace(/[^/]+$/, mediaFileName)
  const newRelsXml = relsXml.replace(`Target="${ref.target}"`, `Target="${newTarget}"`)

  const newDrawingXml = resizeAnchorToAspectRatio(drawingXml, ref.anchorXml, imgBuf)

  return { drawingXml: newDrawingXml, relsXml: newRelsXml }
}
