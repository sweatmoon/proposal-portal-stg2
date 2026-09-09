/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] 템플릿 하단의 감리실적표
 * (21행 헤더: NO/연월/사업명/주관기관/공공민간/담당분야/역할/참여단계 + 22행부터 미리
 * 만들어져 있는 최대 344줄의 빈 행 + 그 아래 "위와 같이 확인합니다" 마감 문구 병합
 * 블록)를 personnel_audit_history로 채운다.
 *
 * 인원마다 감리이력 개수가 다르고(2026-09-08 실측 — 최대 621건인 사람도 있어 템플릿
 * 기본 용량 344줄을 훌쩍 넘긴다) 개수에 맞춰 데이터 행을 다시 만든 뒤, 마감 문구 블록을
 * 실제 채운 마지막 행 바로 다음 행으로 옮긴다(2026-09-08 사용자 확인 — 344줄보다 적으면
 * 남는 빈 행은 삭제하고, 많으면 다 채운 뒤 그 다음에 마감 문구를 붙인다).
 *
 * 마감 문구 블록은 "열 A~H 전체를 덮는, 헤더보다 아래에 있는 병합 셀"로 찾는다(하드코딩된
 * 행 번호에 의존하지 않음 — 템플릿에 이런 병합이 이것 하나뿐임을 실측 확인, 2026-09-08).
 * 데이터 행의 열별 스타일(s=)도 템플릿의 첫 데이터 행(22행)에서 그대로 읽어와 재사용하므로,
 * 서식은 원본과 동일하게 유지된다.
 */
import { escapeXml } from './xlsx-runtext.js'

export interface AuditHistoryRow {
  auditYearmonth: string
  projectName: string
  clientOrg: string
  sector: string
  domain: string
  role: string
  phase: string
}

const DATA_START_ROW = 22
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

/** 마감 문구("...위와 같이 확인합니다...\n\n2026년  04월  09일\n\n...") 안의 날짜를 이
 *  엑셀을 실제로 만든(=API를 호출한) 날짜로 바꾼다(2026-09-08 사용자 확인 — "작업할
 *  당시의 날짜로"). 이 문구는 sharedStrings.xml의 공용 문자열 하나뿐이라(인원마다 다른
 *  값이 아니라 항상 "오늘"이라는 같은 값이므로) 시트별로 따로 치환할 필요 없이 워크북
 *  전체에서 한 번만 바꾸면 모든 시트에 반영된다. 템플릿 원본 형식(년/월/일 사이 공백 2칸,
 *  월/일 0채움)을 그대로 유지한다. */
export function patchFooterCertificationDate(sharedStringsXml: string): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const todayKorean = `${yyyy}년  ${mm}월  ${dd}일`
  return sharedStringsXml.replace(/\d{4}년\s{1,2}\d{1,2}월\s{1,2}\d{1,2}일/, todayKorean)
}

function numCell(ref: string, style: string, value: number): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`
}

function textCell(ref: string, style: string, value: string): string {
  if (!value) return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`
  return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

/** <row r="N" ...>...</row> 하나를 찾는다. */
function getRow(sheetXml: string, rowNum: number): string | null {
  const m = sheetXml.match(new RegExp(`<row r="${rowNum}"[^>]*>[\\s\\S]*?<\\/row>`))
  return m ? m[0] : null
}

/** row XML 안에서 특정 열의 스타일(s=) 값을 읽는다 — 자체닫힘(<c .../>) / 일반(<c ...>..</c>)
 *  형태 모두에서 안전하게(같은 정규식 하나로 both 케이스의 여는 태그만 봄). */
function getCellStyle(rowXml: string, colRef: string): string {
  const m = rowXml.match(new RegExp(`<c r="${colRef}"([^>]*?)(?:\\/>|>)`))
  if (!m) return ''
  const s = m[1].match(/\bs="(\d+)"/)
  return s ? s[1] : ''
}

/**
 * sheetXml의 감리실적표를 historyRows로 채운다. 템플릿 구조를 못 찾으면(마감 문구 병합이
 * 없는 등, 예상과 다른 템플릿이면) 안전하게 원본 그대로 반환한다.
 */
export function fillAuditHistoryTable(sheetXml: string, historyRows: AuditHistoryRow[]): string {
  // "A?:H?" 형태 병합은 제목 행(A3:H3)에도 있으므로, 데이터 시작 행(22) 아래에 있는 것만
  // 마감 문구 블록으로 본다(2026-09-08 실측 버그 — 첫 번째 걸 잘못 집었었음).
  const mergeMatch = [...sheetXml.matchAll(/<mergeCell ref="A(\d+):H(\d+)"\/>/g)].find(m => Number(m[1]) >= DATA_START_ROW)
  if (!mergeMatch) return sheetXml
  const oldFooterStart = Number(mergeMatch[1])
  const oldFooterEnd = Number(mergeMatch[2])
  const footerRowCount = oldFooterEnd - oldFooterStart + 1

  const templateDataRow = getRow(sheetXml, DATA_START_ROW)
  if (!templateDataRow) return sheetXml
  const dataStyles = Object.fromEntries(COLUMNS.map(c => [c, getCellStyle(templateDataRow, `${c}${DATA_START_ROW}`)])) as Record<
    (typeof COLUMNS)[number],
    string
  >

  const footerTemplateRows: string[] = []
  for (let i = 0; i < footerRowCount; i++) {
    const r = getRow(sheetXml, oldFooterStart + i)
    if (!r) return sheetXml
    footerTemplateRows.push(r)
  }
  const footerStyles = footerTemplateRows.map((rowXml, i) => COLUMNS.map(c => getCellStyle(rowXml, `${c}${oldFooterStart + i}`)))
  // 마감 문구가 실제로 들어있는 첫 셀(A) — 값(공유 문자열 참조)은 그대로 재사용하고 r=만 갱신.
  const footerFirstCellXml = footerTemplateRows[0].match(new RegExp(`<c r="A${oldFooterStart}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0] ?? null

  const newDataRowsXml = historyRows.map((h, i) => {
    const rowNum = DATA_START_ROW + i
    const cells =
      numCell(`A${rowNum}`, dataStyles.A, i + 1) +
      textCell(`B${rowNum}`, dataStyles.B, h.auditYearmonth) +
      textCell(`C${rowNum}`, dataStyles.C, h.projectName) +
      textCell(`D${rowNum}`, dataStyles.D, h.clientOrg) +
      textCell(`E${rowNum}`, dataStyles.E, h.sector) +
      textCell(`F${rowNum}`, dataStyles.F, h.domain) +
      textCell(`G${rowNum}`, dataStyles.G, h.role) +
      textCell(`H${rowNum}`, dataStyles.H, h.phase)
    return `<row r="${rowNum}" spans="1:8" ht="40.9" customHeight="1" x14ac:dyDescent="0.3">${cells}</row>`
  })

  const newFooterStart = DATA_START_ROW + historyRows.length
  const newFooterRowsXml = footerStyles.map((rowStyleList, i) => {
    const rowNum = newFooterStart + i
    const cells = COLUMNS.map((c, ci) => {
      if (i === 0 && c === 'A' && footerFirstCellXml) {
        return footerFirstCellXml.replace(/r="A\d+"/, `r="A${rowNum}"`)
      }
      const style = rowStyleList[ci]
      return `<c r="${c}${rowNum}"${style ? ` s="${style}"` : ''}/>`
    }).join('')
    return `<row r="${rowNum}" spans="1:8" x14ac:dyDescent="0.3">${cells}</row>`
  })

  const oldBlockRe = new RegExp(`<row r="${DATA_START_ROW}"[\\s\\S]*<row r="${oldFooterEnd}"[^>]*>[\\s\\S]*?<\\/row>`)
  const oldBlockMatch = sheetXml.match(oldBlockRe)
  if (!oldBlockMatch) return sheetXml

  let result = sheetXml.replace(oldBlockMatch[0], [...newDataRowsXml, ...newFooterRowsXml].join(''))

  const newFooterEnd = newFooterStart + footerRowCount - 1
  result = result.replace(
    `<mergeCell ref="A${oldFooterStart}:H${oldFooterEnd}"/>`,
    `<mergeCell ref="A${newFooterStart}:H${newFooterEnd}"/>`
  )

  result = result.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/, (_m, start, endCol) => `<dimension ref="${start}:${endCol}${newFooterEnd}"/>`)

  return result
}
