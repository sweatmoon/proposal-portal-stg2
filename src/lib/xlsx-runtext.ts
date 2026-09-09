/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] 엑셀 시트 XML 안의 텍스트
 * 플레이스홀더("[이름]" 등)를 치환하는 엔진. src/lib/pptx-runtext.ts의 엑셀판이다.
 *
 * pptx와 달리 엑셀 셀 값은 대부분 sharedStrings.xml의 공용 문자열 테이블을 "인덱스로"
 * 참조한다(t="s" + <v>인덱스</v>). 이 시트를 인원마다 복제해서 쓰는데(감리원 경력
 * 확인서는 인원 1명당 시트 1장), sharedStrings.xml은 워크북 전체가 공유하는 파트라서 그
 * 안의 문자열 자체를 바꿔버리면 "같은 인덱스를 참조하는 다른 인원의 시트"까지 전부
 * 바뀌어버린다. 그래서 플레이스홀더가 들어있는 셀만, 그 시트 파트 안에서 shared string
 * 참조를 버리고 그 시트만의 "inline string"(t="inlineStr")으로 바꿔치기한다 — 공용
 * 문자열 테이블은 손대지 않으므로 시트끼리 서로 영향을 주지 않는다.
 */

export function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 셀 하나(<c ...>...</c>)의 현재 텍스트 값을 읽는다. shared string(t="s")과 inline
 *  string(t="inlineStr")만 지원 — 그 외(숫자, 수식 등)는 플레이스홀더가 있을 수 없으므로
 *  빈 문자열을 반환한다. */
function readCellText(attrs: string, inner: string, sharedStrings: string[]): string {
  const typeMatch = attrs.match(/\bt="(\w+)"/)
  const type = typeMatch ? typeMatch[1] : ''
  if (type === 's') {
    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
    if (!vMatch) return ''
    return sharedStrings[Number(vMatch[1])] ?? ''
  }
  if (type === 'inlineStr') {
    return [...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]).join('')
  }
  return ''
}

/**
 * 시트 XML 안에서, 플레이스홀더 키(map의 각 키, 예: "[이름]")를 셀 값 안에 포함하고 있는
 * 셀만 찾아 inline string 셀로 바꿔치기한다. 그 외 셀은 원본 그대로 보존한다.
 *
 * styleMap을 주면(원본 스타일 인덱스 → 새 스타일 인덱스), 실제로 값이 치환된 셀만 그
 * 매핑으로 스타일도 같이 바꿔치기한다(2026-09-08 사용자 확인 — 치환에 성공한 글자는
 * 검은색으로. src/lib/xlsx-style-patch.ts가 "폰트만 검은색으로 바꾼 스타일"을 만들어
 * 이 맵을 준다). 값이 안 채워져 원본 그대로 남는 셀(예: 매칭 실패로 아직 대괄호인 채)은
 * 스타일도 그대로 둬서 "아직 수동으로 채워야 함"이라는 빨간 글씨 표시가 유지된다.
 */
export function applyXlsxPlaceholderMap(
  sheetXml: string,
  sharedStrings: string[],
  map: Record<string, string>,
  styleMap?: Map<number, number>
): string {
  const keys = Object.keys(map)
  if (!keys.length) return sheetXml

  return sheetXml.replace(
    // 자체닫힘(<c .../>) 셀을 먼저 매칭해 흡수시켜야 한다 — 그러지 않으면 아래
    // "일반 셀" 브랜치의 [\s\S]*?가 그 다음에 오는 진짜 </c>까지 건너뛰어버려서
    // 엉뚱한 셀의 값을 이 셀 것으로 잘못 읽는다(2026-09-08 실측 — 조사 스크립트에서
    // 처음 발견).
    /<c r="[A-Z]+\d+"[^>]*\/>|<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g,
    (full, ref: string | undefined, attrs: string, inner: string) => {
      if (ref === undefined) return full // 자체닫힘 셀 — 값이 없으니 그대로 둔다.
      const text = readCellText(attrs, inner, sharedStrings)
      if (!text || !keys.some(k => text.includes(k))) return full

      let newText = text
      for (const k of keys) newText = newText.split(k).join(map[k])

      const styleMatch = attrs.match(/\bs="(\d+)"/)
      const origStyleIdx = styleMatch ? Number(styleMatch[1]) : null
      const newStyleIdx = origStyleIdx !== null ? (styleMap?.get(origStyleIdx) ?? origStyleIdx) : null
      const styleAttr = newStyleIdx !== null ? ` s="${newStyleIdx}"` : ''

      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(newText)}</t></is></c>`
    }
  )
}

/** 템플릿 시트 XML에서, keys 중 하나라도 값에 포함하고 있는 셀들의 스타일 인덱스(s=)를
 *  전부 모아 반환한다(중복 포함 가능). xlsx-style-patch.ts에 "이 스타일들의 검은 글씨
 *  버전을 만들어달라"고 요청할 때 쓴다 — 어떤 셀이 플레이스홀더를 담고 있는지는 실제
 *  치환 시점(applyXlsxPlaceholderMap)과 같은 기준(텍스트에 키 포함)으로 판단해야
 *  스타일 인덱스가 어긋나지 않는다. */
export function findPlaceholderStyleIndices(sheetXml: string, sharedStrings: string[], keys: string[]): number[] {
  const indices: number[] = []
  // applyXlsxPlaceholderMap과 같은 이유로 자체닫힘 셀을 먼저 매칭해 건너뛴다.
  for (const m of sheetXml.matchAll(/<c r="[A-Z]+\d+"[^>]*\/>|<c r="[A-Z]+\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
    if (m[1] === undefined) continue // 자체닫힘 셀
    const attrs = m[1]
    const inner = m[2]
    const text = readCellText(attrs, inner, sharedStrings)
    if (!text || !keys.some(k => text.includes(k))) continue
    const styleMatch = attrs.match(/\bs="(\d+)"/)
    if (styleMatch) indices.push(Number(styleMatch[1]))
  }
  return indices
}

/** 시트 XML에서 특정 열(예: "K")에 있는 셀의 값을 전부 지운다 — 셀 자체(위치/스타일)는
 *  남기고 값/타입만 제거해 빈 셀로 만든다(2026-09-08 사용자 확인 — 템플릿에 남아있던 K열
 *  잔여 데이터 삭제 요청). */
export function clearColumnData(sheetXml: string, column: string): string {
  const re = new RegExp(`<c r="${column}\\d+"[^>]*\\/>|<c r="${column}\\d+"[^>]*>[\\s\\S]*?<\\/c>`, 'g')
  return sheetXml.replace(re, full => {
    const refMatch = full.match(/r="([A-Z]+\d+)"/)!
    const styleMatch = full.match(/\bs="(\d+)"/)
    const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : ''
    return `<c r="${refMatch[1]}"${styleAttr}/>`
  })
}
