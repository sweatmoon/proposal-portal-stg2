/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] 템플릿의 플레이스홀더
 * 자리("[이름]" 등)는 "아직 안 채워졌다"는 표시로 빨간 글씨(FFFF0000)로 스타일링돼있다
 * (2026-09-08 실측). 실제 값을 자동으로 채운 셀은 검은 글씨로 보이게 하고(2026-09-08
 * 사용자 확인), 매칭에 실패해 대괄호가 그대로 남는 셀은 "아직 수동으로 채워야 함" 표시로
 * 빨간 글씨를 그대로 유지해야 하므로, 원본 스타일은 건드리지 않고 "폰트 색상만 검은색으로
 * 바꾼 사본" 스타일을 styles.xml에 추가로 끼워넣는 방식을 쓴다.
 *
 * styles.xml은 워크북 전체가 공유하는 파트지만 이 패치는 항목을 추가만 하고(fonts/cellXfs
 * count만 늘어남) 기존 스타일 인덱스는 전혀 바꾸지 않으므로, 다른 시트나 다른 셀에 영향이
 * 없다 — 딱 한 번만 적용하면 된다(인원마다 다시 만들 필요 없음).
 */

export interface BlackFontStylePatch {
  /** 원본 스타일 인덱스 → 폰트 색상만 검은색으로 바꾼 새 스타일 인덱스 */
  styleMap: Map<number, number>
  /** 새 font/cellXfs 항목이 추가된 styles.xml (바뀐 게 없으면 원본과 동일) */
  patchedStylesXml: string
}

/** stylesXml에서 styleIndices(중복 가능)에 해당하는 스타일들의 "폰트 색상만 검은색으로
 *  바꾼" 사본을 새로 추가하고, 원본 → 신규 인덱스 매핑을 반환한다. */
export function buildBlackFontStylePatch(stylesXml: string, styleIndices: number[]): BlackFontStylePatch {
  const uniqueIndices = [...new Set(styleIndices)]
  const styleMap = new Map<number, number>()

  const cellXfsMatch = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/)
  const fontsMatch = stylesXml.match(/<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/)
  if (!cellXfsMatch || !fontsMatch || !uniqueIndices.length) {
    return { styleMap, patchedStylesXml: stylesXml }
  }

  const xfs = [...cellXfsMatch[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])
  const fonts = [...fontsMatch[3].matchAll(/<font>[\s\S]*?<\/font>/g)].map(m => m[0])

  const baseFontCount = Number(fontsMatch[1])
  const baseXfCount = Number(cellXfsMatch[1])
  const newFonts: string[] = []
  const newXfs: string[] = []

  for (const styleIdx of uniqueIndices) {
    const xf = xfs[styleIdx]
    const fontIdMatch = xf?.match(/fontId="(\d+)"/)
    if (!xf || !fontIdMatch) continue
    const fontXml = fonts[Number(fontIdMatch[1])]
    if (!fontXml) continue

    const blackFontXml = /<color rgb="[0-9A-Fa-f]{8}"\s*\/>/.test(fontXml)
      ? fontXml.replace(/<color rgb="[0-9A-Fa-f]{8}"\s*\/>/, '<color rgb="FF000000"/>')
      : fontXml.replace('</font>', '<color rgb="FF000000"/></font>')

    const newFontId = baseFontCount + newFonts.length
    newFonts.push(blackFontXml)

    const newXf = xf.replace(/fontId="\d+"/, `fontId="${newFontId}"`)
    const newXfIdx = baseXfCount + newXfs.length
    newXfs.push(newXf)

    styleMap.set(styleIdx, newXfIdx)
  }

  if (!newFonts.length) return { styleMap, patchedStylesXml: stylesXml }

  let patched = stylesXml.replace(
    /<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/,
    (_m, count: string, attrs: string, body: string) =>
      `<fonts count="${Number(count) + newFonts.length}"${attrs}>${body}${newFonts.join('')}</fonts>`
  )
  patched = patched.replace(
    /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,
    (_m, count: string, body: string) => `<cellXfs count="${Number(count) + newXfs.length}">${body}${newXfs.join('')}</cellXfs>`
  )

  return { styleMap, patchedStylesXml: patched }
}
