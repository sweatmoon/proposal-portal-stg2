/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음.
 * 기존 범용 PPT 생성(src/routes/ppt-generate.ts)은 이 파일을 쓰지 않고 자체 치환 로직을 씀 —
 * 완전히 별개 경로라 서로 영향이 없습니다.)
 *
 * pptx 슬라이드 XML 안의 텍스트 플레이스홀더를 치환하는 엔진.
 *
 * 원칙: 플레이스홀더에 해당하는 부분만 정확히 도려내서 교체하고, 그 외의 텍스트와
 * 서식(rPr)은 원본 런을 그대로 보존합니다 — 문단 전체를 하나의 런으로 뭉개버리면
 * 원본과 서식이 미묘하게 달라질 수 있어서, 이 방식은 쓰지 않습니다.
 *
 * ⚠️ 주의: "<a:t>" 를 찾는 정규식은 반드시 태그 이름 경계를 명확히 해야 합니다.
 * `/<a:t[^>]*>/` 처럼 쓰면 `<a:tailEnd .../>`, `<a:tabLst>` 같은 완전히 다른 태그까지
 * "a:t 태그"로 잘못 매칭됩니다(둘 다 "<a:t"로 시작하기 때문). 그래서 아래 모든 정규식은
 * `<a:t(?:\s[^>]*)?>` 형태로 — "<a:t" 바로 뒤가 공백 또는 ">" 여야만 진짜 <a:t> 태그로
 * 인정합니다.
 */

const A_T_TAG_WITH_TEXT = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/

export function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** rPr(서식) 블록을 추출. self-closing이면 그것을, 아니면 <a:rPr>...</a:rPr> 쌍을 그대로 추출.
 *  (중첩된 자식 태그의 self-closing "/>"에서 잘못 멈추지 않도록 두 케이스를 분리 처리) */
function extractRPr(runXml: string): string {
  const selfClose = runXml.match(/<a:rPr\b[^>]*\/>/)
  const paired = runXml.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/)
  return selfClose ? selfClose[0] : paired ? paired[0] : ''
}

function buildRun(rPr: string, text: string): string {
  if (text === '') return ''
  return `<a:r>${rPr}<a:t xml:space="preserve">${escapeXml(text)}</a:t></a:r>`
}

/** 문단(<a:p>) 하나의 텍스트 안에서, 여러 런에 걸쳐 있을 수 있는 모든 플레이스홀더를
 *  찾아 정확히 그 부분만 치환하고 나머지 텍스트/서식은 원본 런 그대로 보존한다.
 *  반환값은 문단 내부(runs 구간)만 교체한 새 XML 조각 + 첫/마지막 런의 원본 위치. */
function processParagraph(
  inner: string,
  keys: string[],
  map: Record<string, string>
): { xml: string; runsStart: number; runsEnd: number } | null {
  const runRegex = /<a:r\b[\s\S]*?<\/a:r>/g
  const runs: { text: string; xml: string; start: number; end: number; xmlStart: number; xmlEnd: number }[] = []
  let rm: RegExpExecArray | null
  let cursor = 0
  while ((rm = runRegex.exec(inner))) {
    const t = rm[0].match(A_T_TAG_WITH_TEXT)
    const text = t ? t[1] : ''
    runs.push({
      text,
      xml: rm[0],
      start: cursor,
      end: cursor + text.length,
      xmlStart: rm.index,
      xmlEnd: rm.index + rm[0].length,
    })
    cursor += text.length
  }
  if (!runs.length) return null

  const concat = runs.map(r => r.text).join('')
  if (!keys.some(k => concat.includes(k))) return null

  // 긴 키(예: "[이름]은")를 짧은 키("[이름]")보다 먼저 매칭하도록 길이 내림차순 정렬
  const sortedKeys = [...keys].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(sortedKeys.map(escapeRegExp).join('|'), 'g')
  const matches: { start: number; end: number; value: string }[] = []
  let mm: RegExpExecArray | null
  while ((mm = pattern.exec(concat))) {
    matches.push({ start: mm.index, end: mm.index + mm[0].length, value: map[mm[0]] ?? '' })
  }
  if (!matches.length) return null

  let out = ''
  for (const run of runs) {
    // 이 런과 조금이라도 겹치는 매치가 없으면 원본 그대로
    const overlapping = matches.filter(m => m.end > run.start && m.start < run.end)
    if (!overlapping.length) {
      out += run.xml
      continue
    }

    const rPr = extractRPr(run.xml)
    let localCursor = run.start
    for (const m of overlapping) {
      const segStart = Math.max(m.start, run.start)
      const segEnd = Math.min(m.end, run.end)
      // 매치 시작 전 남는 원본 텍스트(있으면) 보존
      if (segStart > localCursor) {
        out += buildRun(rPr, run.text.slice(localCursor - run.start, segStart - run.start))
      }
      // 이 매치의 값은 "매치가 시작되는 런"에서만 한 번 출력 (여러 런에 걸쳐 있어도 중복 방지)
      if (m.start >= run.start) {
        out += buildRun(rPr, m.value)
      }
      localCursor = segEnd
    }
    // 마지막 매치 뒤 남는 원본 텍스트(있으면) 보존
    if (localCursor < run.end) {
      out += buildRun(rPr, run.text.slice(localCursor - run.start, run.end - run.start))
    }
  }

  return { xml: out, runsStart: runs[0].xmlStart, runsEnd: runs[runs.length - 1].xmlEnd }
}

/** 여러 플레이스홀더를 문단(<a:p>) 단위로, 서식을 보존하며 치환한다. */
export function applyPlaceholderMap(xml: string, map: Record<string, string>): string {
  const keys = Object.keys(map)
  if (!keys.length) return xml

  const paraReg = /(<a:p\b[^>]*>)([\s\S]*?)(<\/a:p>)/g

  return xml.replace(paraReg, (full, open: string, inner: string, close: string) => {
    const processed = processParagraph(inner, keys, map)
    if (processed === null) return full

    // 원본 inner에서 런 구간 이전/이후(pPr, endParaRPr 등)는 그대로 보존
    const prefix = inner.slice(0, processed.runsStart)
    const suffix = inner.slice(processed.runsEnd)

    return open + prefix + processed.xml + suffix + close
  })
}
