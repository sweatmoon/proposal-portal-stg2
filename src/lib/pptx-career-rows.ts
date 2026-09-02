/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * "2. 투입 감리원별 실적 및 경력" 템플릿 전용 표 채우기 엔진.
 *
 * "사업명" 셀은 템플릿 원래 형식 그대로 "[키워드] 사업명" — 매칭된 키워드를 대괄호로 감싸
 * 앞에 붙이고, 그 뒤에 실제 사업명 전체를 붙인다(사업명 안의 텍스트를 찾아 강조하는 게
 * 아니라, 대괄호 태그를 사업명 앞에 그대로 붙이는 표기법이다 — 2026-09-01 사용자 재확인).
 * 일반 키워드는 대괄호까지 빨간 글자색으로 강조하고, "주관기관/발주기관" 카테고리로
 * 매핑된 키워드는 글자색이 아니라 **그 행 전체의 배경색**을 템플릿의 연한 초록색
 * (DCF2E6, 원본에서도 쓰던 색 그대로)으로 칠한다 — "초록색 = 배경색"이 사용자 의도였음
 * (2026-09-01 재확인). 매칭이 없거나 일반 키워드 매칭인 행은 배경을 흰색(없음)으로 되돌린다
 * — 원본 템플릿은 모든 행에 이 초록 배경이 깔려 있었지만, 그건 "주관기관 매칭 행만
 * 표시"하려던 의도였던 것으로 보고 조건부로 바꿨다.
 *
 * 완전히 같은 사업(같은 프로젝트를 같은 조건으로 두 번 이상 기록한 중복 행)은 호출 쪽에서
 * 미리 제거하고 넘겨줘야 한다. 같은 사업명인데 다른 값이 있는 연속된 행들을
 * fillHistoryCluster()에 함께 넘기면:
 *   - "사업명" 열은 항상 세로로 합친다(클러스터의 정의 자체가 "같은 사업명").
 *   - 그 외 열(연도/주관기관/구분/담당분야/역할/참여율)은 클러스터 안의 모든 행에서 값이
 *     완전히 같을 때만 세로로 합치고, 하나라도 다르면 그 열은 행마다 따로 보여준다
 *     (2026-09-01 사용자 확인).
 *   - "번호" 열은 항상 행마다 따로(절대 합치지 않음).
 *
 * "번호" 열은 대괄호 플레이스홀더가 아니라 그냥 리터럴 숫자라서, 셀 안 숫자 텍스트를
 * 직접 바꿔치기한다.
 */
import { applyPlaceholderMap } from './pptx-runtext.js'

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export interface HistoryRowData {
  no: number
  year: string
  projectName: string
  /** 대괄호 안에 넣을 매칭된 키워드 텍스트 (없으면 대괄호 자체를 안 씀) */
  matchedText: string | null
  /** matchedText가 있을 때만 의미 있음 — "주관기관" 카테고리 매치면 초록, 그 외엔 빨강 */
  matchedColor: 'red' | 'green' | null
  clientOrg: string
  sector: string
  domain: string
  role: string
  participation: string
}

const RED_HEX = 'E60012'
/** 주관기관/발주기관 매칭 행의 배경색 — 원본 템플릿에서 이미 쓰던 연한 초록색 그대로 재사용. */
const GREEN_BG_HEX = 'DCF2E6'

/** <a:r>{rPr}<a:t>text</a:t></a:r> 형태에서, text가 정확히 target과 일치하는 런 하나를 찾아
 *  그 rPr 블록(런 여는 태그와 <a:t> 사이의 내용)만 뽑아낸다. */
function extractRunRPr(xml: string, targetText: string): string {
  const re = new RegExp(
    `<a:r>((?:(?!<\\/a:r>)[\\s\\S])*?)<a:t(?:\\s[^>]*)?>${targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/a:t><\\/a:r>`
  )
  const m = xml.match(re)
  if (!m) throw new Error(`run not found for text: ${targetText}`)
  return m[1]
}

/** "[" "키워드"(빨강) "] 사업명"(검정) 3개 런 전체를 통째로 찾는 정규식 */
const KEYWORD_CELL_RE =
  /<a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t(?:\s[^>]*)?>\[<\/a:t><\/a:r><a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t(?:\s[^>]*)?>키워드<\/a:t><\/a:r><a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t(?:\s[^>]*)?>\] 사업명<\/a:t><\/a:r>/

/** "[키워드] 사업명" 형식 그대로 재구성한다 — 사업명 문자열 안에서 찾아 강조하는 게 아니라,
 *  매칭된 키워드를 대괄호 태그로 앞에 붙이고 그 뒤에 사업명 전체를 그대로 붙인다.
 *  일반 키워드는 대괄호까지 빨간 글자색, 주관기관/발주기관 매칭은 글자색은 그대로 두고
 *  (배경색으로 표시하므로) 검정 그대로 둔다. */
function buildProjectNameRuns(entry: HistoryRowData, blackRPr: string, redRPr: string): string {
  if (!entry.matchedText) {
    return `<a:r>${blackRPr}<a:t>${esc(entry.projectName)}</a:t></a:r>`
  }
  const bracketRPr = entry.matchedColor === 'red' ? redRPr : blackRPr
  return (
    `<a:r>${bracketRPr}<a:t>[${esc(entry.matchedText)}]</a:t></a:r>` +
    `<a:r>${blackRPr}<a:t> ${esc(entry.projectName)}</a:t></a:r>`
  )
}

/** tcPr 맨 마지막의 셀 배경 solidFill(테두리용 solidFill과 달리 </a:tcPr> 바로 앞에 옴)을
 *  hex로 바꾸거나(hex가 null이면) 완전히 지운다(흰 배경). */
function setCellFill(cellXml: string, hex: string | null): string {
  const fillRe = /<a:solidFill><a:srgbClr val="[0-9A-Fa-f]{6}"\/><\/a:solidFill>(<\/a:tcPr>)/
  if (!fillRe.test(cellXml)) return cellXml
  const replacement = hex ? `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>$1` : `<a:noFill/>$1`
  return cellXml.replace(fillRe, replacement)
}

function splitCells(rowXml: string): string[] {
  return rowXml.match(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g) || []
}

/** "번호" 셀(colIndex 0)의 리터럴 숫자 텍스트를 바꿔치기한다. */
function fillNumberCell(cellXml: string, no: number): string {
  return cellXml.replace(/(<a:t(?:\s[^>]*)?>)\d+(<\/a:t>)/, `$1${no}$2`)
}

function fillProjectNameCell(cellXml: string, entry: HistoryRowData): string {
  const redRPr = extractRunRPr(cellXml, '키워드')
  const blackRPr = extractRunRPr(cellXml, '] 사업명')
  return cellXml.replace(KEYWORD_CELL_RE, buildProjectNameRuns(entry, blackRPr, redRPr))
}

const COLUMN_KEYS: Record<number, keyof HistoryRowData | null> = {
  1: 'year',
  3: 'clientOrg',
  4: 'sector',
  5: 'domain',
  6: 'role',
  7: 'participation',
}
const COLUMN_BRACKETS: Record<number, string> = {
  1: '[연도]',
  3: '[주관기관]',
  4: '[구분]',
  5: '[담당분야]',
  6: '[역할]',
  7: '[참여율]',
}

/** colIndex 열의, 병합 여부 판단에 쓸 원본 값 (0=번호, 2=사업명은 안 씀). */
function columnValue(colIndex: number, entry: HistoryRowData): string {
  const key = COLUMN_KEYS[colIndex]
  return key ? String(entry[key] ?? '') : ''
}

function fillCell(cellTpl: string, colIndex: number, entry: HistoryRowData): string {
  let filled: string
  if (colIndex === 0) filled = fillNumberCell(cellTpl, entry.no)
  else if (colIndex === 2) filled = fillProjectNameCell(cellTpl, entry)
  else {
    const bracket = COLUMN_BRACKETS[colIndex]
    filled = bracket ? applyPlaceholderMap(cellTpl, { [bracket]: columnValue(colIndex, entry) }) : cellTpl
  }
  return setCellFill(filled, entry.matchedColor === 'green' ? GREEN_BG_HEX : null)
}

/** 셀 템플릿을 rowSpan 버전(첫 행)으로 바꾼다. filledCellXml은 이미 값이 채워진 상태여야 함. */
function toRowSpanCell(filledCellXml: string, n: number): string {
  return filledCellXml.replace(/^<a:tc>/, `<a:tc rowSpan="${n}">`)
}

/** 셀 템플릿으로부터 vMerge(이어지는 행, 화면에 안 보임) 버전을 만든다 — 내용은 비우되,
 *  배경색은 병합된 첫 행과 같은 값으로 맞춰준다(화면엔 안 보이지만 일관성 유지). */
function toVMergeCell(cellTpl: string, fillHex: string | null): string {
  const withFill = setCellFill(cellTpl, fillHex)
  const tcPrMatch = withFill.match(/<a:tcPr[\s\S]*?<\/a:tcPr>|<a:tcPr[^/]*\/>/)
  const emptyBody = `<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="ko-KR"/></a:p></a:txBody>`
  return `<a:tc vMerge="1">${emptyBody}${tcPrMatch ? tcPrMatch[0] : ''}</a:tc>`
}

/**
 * 같은 사업(entries, 전부 같은 projectName)을 하나의 행 그룹으로 렌더링한다.
 * - 1건이면 평범한 단독 행.
 * - 여러 건이면 "사업명" 열은 항상 세로 병합, 나머지 열은 전부 같은 값일 때만 병합.
 */
export function fillHistoryCluster(singleRowTpl: string, entries: HistoryRowData[]): string {
  if (entries.length === 0) return ''
  const cellsTpl = splitCells(singleRowTpl)
  if (cellsTpl.length < 8) throw new Error('유사 감리 실적 행의 셀 수가 예상과 다릅니다')
  const trOpen = (singleRowTpl.match(/^<a:tr h="\d+">/) || [])[0] || '<a:tr>'
  const n = entries.length

  if (n === 1) {
    const cells = cellsTpl.map((cellTpl, ci) => fillCell(cellTpl, ci, entries[0]))
    return trOpen + cells.join('') + '</a:tr>'
  }

  const rowsOut: string[][] = entries.map(() => new Array(cellsTpl.length).fill(''))
  for (let ci = 0; ci < cellsTpl.length; ci++) {
    const uniform = ci === 2 ? true : ci === 0 ? false : entries.every(e => columnValue(ci, e) === columnValue(ci, entries[0]))
    if (uniform) {
      rowsOut[0][ci] = toRowSpanCell(fillCell(cellsTpl[ci], ci, entries[0]), n)
      const fillHex = entries[0].matchedColor === 'green' ? GREEN_BG_HEX : null
      for (let ri = 1; ri < n; ri++) rowsOut[ri][ci] = toVMergeCell(cellsTpl[ci], fillHex)
    } else {
      for (let ri = 0; ri < n; ri++) rowsOut[ri][ci] = fillCell(cellsTpl[ci], ci, entries[ri])
    }
  }

  return rowsOut.map(cells => trOpen + cells.join('') + '</a:tr>').join('')
}

/** 단순 대괄호 플레이스홀더만 있는 행(IT경력/자격증)을 채운다. */
export function fillSimpleRow(canonicalRow: string, map: Record<string, string>): string {
  return applyPlaceholderMap(canonicalRow, map)
}
