/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * "1. 감리원 일정 현황표" 류의 표 — 이름 1개당 여러 일정 행이 rowSpan/vMerge로 묶여
 * 반복되는 표를, 실제 인원·일정 개수만큼 동적으로 늘려서(또는 줄여서) 채우는 엔진.
 * 한 페이지에 다 안 들어가면 여러 슬라이드로 나누고, 나눠진 페이지 수에 맞춰 각 페이지의
 * 행 높이를 다시 계산해서 그 페이지 분량에 맞도록 채웁니다.
 *
 * 표 구조 가정 (템플릿 쪽 규약):
 *   - 헤더 행: "감리원명" "감리 구분" "단계 구분" "일정" 4개 열 텍스트가 모두 들어있는 <a:tr>
 *   - 그 다음, 사람 1명당 1개 이상의 <a:tr> 그룹:
 *       첫 행 : 1번째 셀 = rowSpan="N" + "[이름]" placeholder / 2~4번째 셀 = "[감리구분]" "[단계]" "[시작일] ~ [종료일]"
 *       이어지는 행(들) : 1번째 셀 = vMerge="1" (내용 없음) / 2~4번째 셀은 각 행마다 독립적인 placeholder
 *
 * 템플릿 파일(사용자가 업로드한 실제 pptx) 안에서 "첫 행"과 "이어지는 행" 각각 1개씩을
 * 그대로 오려내 그 서식(폰트·색·테두리 등)을 100% 보존한 채 복제합니다 — 스타일 값은
 * 이 파일 어디에도 하드코딩하지 않고 전부 템플릿에서 그대로 가져옵니다.
 *
 * 페이지 나누기 규칙:
 *   1) 한 페이지 안에서, 행 높이를 COMFORTABLE_MIN_ROW_H까지만 줄여서 다 들어가면 1페이지로 끝냅니다.
 *   2) 그래도 안 들어가면, 사람(그룹) 단위로 순서(가나다순)를 유지한 채 여러 페이지로 나눕니다
 *      (한 사람의 일정이 페이지 중간에 끊기지 않도록 그룹째로만 나눔). 이때 그냥 앞에서부터
 *      목표 행수까지 채우는 방식이 아니라, "가장 많이 찬 페이지의 행 수를 최소화"하는
 *      균등 분할(packGroupsBalanced)을 사용합니다 — 안 그러면 마지막 페이지에 인원이
 *      한두 명만 남는 경우가 생겨서(2026-09-01 사용자 확인), 페이지들이 최대한 고르게
 *      나뉘도록 합니다.
 *   3) 페이지 수가 정해지면, 각 페이지는 "그 페이지에 배정된 행 수" 기준으로 다시 높이를
 *      계산해서 그 페이지의 안전 높이 예산을 채웁니다 — 단, 원본 템플릿 행 높이보다
 *      더 늘리지는 않습니다(마지막 페이지가 휑하게 늘어나 보이는 것을 방지).
 */
import { applyPlaceholderMap } from './pptx-runtext.js'

export interface ScheduleEntry {
  /** 감리구분: 추가 / 정기 / 검수지원 */
  label: string
  /** 단계 구분: 설계 / 구현 / 종료 / 검수지원 등 */
  phase: string
  /** 일정: "2026.09.28 ~ 2026.10.02" 또는 "사업종료시점" 같은 완성 문자열 */
  schedule: string
}

export interface ScheduleGroup {
  name: string
  entries: ScheduleEntry[]
}

export interface SchedulePage {
  groups: ScheduleGroup[]
  dataRowH: number
}

const HEADER_MARKERS = ['감리원명', '감리 구분', '단계 구분', '일정']
const COMFORTABLE_MIN_ROW_H = 320000 // 이보다 더 줄여야 한다면 줄이는 대신 페이지를 늘림
const MAX_PAGES = 12 // 무한루프 방지용 상한

// 맨 위 3행(감리대상 사업명 / 주관 기관 / 헤더) 각각의 높이는 1cm를 넘으면 안 되고,
// 3행 모두 높이가 서로 같아야 한다 (2026-09-01 사용자 확인 — 합계가 아니라 "각 행" 기준).
const MAX_SINGLE_PRE_ROW_H = 360000 // 1cm = 360,000 EMU
const PRE_ROW_LINE_FACTOR = 1.3 // 폰트 크기(pt) 대비 한 줄이 필요로 하는 최소 행 높이 배수(경험값)

/** "[이름]" 같은 플레이스홀더는 파워포인트가 "[" / "이름" / "]"을 서로 다른 <a:r> 런으로
 *  쪼개 저장하는 경우가 흔해서, XML 원문에 문자열 그대로는 안 나타난다. 그래서 마커를
 *  찾을 때는 반드시 <a:t> 안의 텍스트만 이어붙인 뒤 검사해야 한다. */
function extractText(xml: string): string {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
}

function buildEntryMap(entry: ScheduleEntry, name?: string): Record<string, string> {
  const map: Record<string, string> = {
    '[감리구분]': entry.label,
    '[단계]': entry.phase,
    '[시작일] ~ [종료일]': entry.schedule,
  }
  if (name !== undefined) map['[이름]'] = name
  return map
}

function setRowHeight(rowXml: string, h: number): string {
  return rowXml.replace(/<a:tr h="\d+">/, `<a:tr h="${h}">`)
}

function sumRowHeights(rowsXml: string[]): number {
  return rowsXml.reduce((sum, r) => {
    const m = r.match(/<a:tr h="(\d+)">/)
    return sum + (m ? Number(m[1]) : 0)
  }, 0)
}

/** 사업명/주관기관/헤더 3행은 (1) 각 행이 1cm를 넘으면 안 되고 (2) 서로 높이가 같아야 한다.
 *  이미 셋 다 1cm 이하이면서 서로 같으면 손대지 않는다. 그 외에는 셋 중 "1cm를 넘지 않는
 *  선에서 가장 큰 값"(원본이 이미 더 작으면 그 값, 아니면 1cm)으로 통일한다.
 *  글자 크기가 그 행 높이에 비해 너무 크면(즉, 파워포인트가 내용에 맞춰 행을 다시
 *  늘려버릴 정도면) 딱 들어갈 만큼만 같이 줄인다 — 이미 충분히 작으면 안 건드린다. */
function shrinkPreRows(rawPreRows: string[]): string[] {
  if (rawPreRows.length === 0) return rawPreRows
  const origHeights = rawPreRows.map(r => Number((r.match(/<a:tr h="(\d+)">/) || [])[1] || 0))
  const maxOrig = Math.max(...origHeights)
  const alreadyOk = maxOrig <= MAX_SINGLE_PRE_ROW_H && origHeights.every(h => h === origHeights[0])
  if (alreadyOk) return rawPreRows

  const targetH = Math.min(MAX_SINGLE_PRE_ROW_H, maxOrig)
  const maxFontPt = Math.floor(targetH / 12700 / PRE_ROW_LINE_FACTOR)

  return rawPreRows.map(r => {
    let out = setRowHeight(r, targetH)
    out = out.replace(/sz="(\d+)"/g, (m, szStr) => {
      const szPt = Number(szStr) / 100
      if (szPt <= maxFontPt) return m
      return `sz="${Math.max(100, Math.floor(maxFontPt * 100))}"`
    })
    return out
  })
}

/** <a:tbl> 시작 위치 바로 앞에 있는 <p:graphicFrame>의 <a:ext cx="_" cy="N"/> 중 cy 값을 찾는다
 *  (표를 담은 graphicFrame이 원래 잡아둔 "안전 높이 예산"). 못 찾으면 null. */
function findFrameBudgetCy(slideXml: string, tblStartIndex: number): number | null {
  const before = slideXml.slice(0, tblStartIndex)
  const matches = [...before.matchAll(/<p:xfrm><a:off x="\d+" y="\d+"\/><a:ext cx="\d+" cy="(\d+)"\/><\/p:xfrm>/g)]
  if (!matches.length) return null
  return Number(matches[matches.length - 1][1])
}

interface TemplateLayout {
  tbl: string
  tblStart: number
  /** 표에 원래 있던 그대로의 사업명/기관/헤더 행 (검색용 — tbl 안에서 이 부분을 찾을 때 씀) */
  rawPreRows: string[]
  /** 1cm 상한을 적용한 뒤의 사업명/기관/헤더 행 (출력용) */
  preRows: string[]
  firstDataRowTpl: string
  contRowTpl: string
  origDataRows: string[]
  origDataRowH: number
  preHeight: number
  budgetCy: number | null
}

/** 템플릿 슬라이드 XML에서 표 구조를 읽어낸다. 이 표 형식이 아니면 null. */
function analyzeTemplate(slideXml: string): TemplateLayout | null {
  const tblMatch = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)
  if (!tblMatch || tblMatch.index === undefined) return null
  const tbl = tblMatch[0]

  const rows = tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g)
  if (!rows) return null

  const headerIdx = rows.findIndex(r => {
    const t = extractText(r)
    return HEADER_MARKERS.every(m => t.includes(m))
  })
  if (headerIdx === -1) return null

  const firstDataRowTpl = rows[headerIdx + 1]
  const contRowTpl = rows[headerIdx + 2]
  if (!firstDataRowTpl || !extractText(firstDataRowTpl).includes('[이름]')) return null
  if (!contRowTpl || !contRowTpl.includes('vMerge="1"')) return null

  const rawPreRows = rows.slice(0, headerIdx + 1)
  const preRows = shrinkPreRows(rawPreRows)
  const origDataRows = rows.slice(headerIdx + 1)
  const origDataRowH = Number((contRowTpl.match(/<a:tr h="(\d+)">/) || [])[1] || 0)
  const preHeight = sumRowHeights(preRows)
  const budgetCy = findFrameBudgetCy(slideXml, tblMatch.index)

  return { tbl, tblStart: tblMatch.index, rawPreRows, preRows, firstDataRowTpl, contRowTpl, origDataRows, origDataRowH, preHeight, budgetCy }
}

/** 순서(가나다순)를 유지한 채, 그룹(사람) 단위로만 최대 k페이지로 나누되, 가장 많이
 *  찬 페이지의 행 수를 최소화하는 "균등 분할"을 찾는다(전형적인 "배열을 k개 구간으로
 *  나눠 최대 구간합을 최소화" 문제 — 이분탐색으로 풀이). 그냥 앞에서부터 목표치까지
 *  채우는 방식은 마지막 페이지에 인원이 한두 명만 덩그러니 남는 문제가 있어서
 *  (2026-09-01 사용자 확인), 이 방식으로 바꿨다. */
function packGroupsBalanced(groups: ScheduleGroup[], k: number): ScheduleGroup[][] {
  const sizes = groups.map(g => g.entries.length)
  const total = sizes.reduce((a, b) => a + b, 0)
  if (total === 0) return []

  const pagesNeeded = (maxAllowed: number): number => {
    let pages = 1
    let cur = 0
    for (const s of sizes) {
      if (cur > 0 && cur + s > maxAllowed) {
        pages++
        cur = s
      } else {
        cur += s
      }
    }
    return pages
  }

  let lo = Math.max(...sizes)
  let hi = total
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (pagesNeeded(mid) <= k) hi = mid
    else lo = mid + 1
  }
  const maxAllowed = lo

  const pages: ScheduleGroup[][] = []
  let current: ScheduleGroup[] = []
  let cur = 0
  for (const g of groups) {
    const n = g.entries.length
    if (cur > 0 && cur + n > maxAllowed) {
      pages.push(current)
      current = []
      cur = 0
    }
    current.push(g)
    cur += n
  }
  if (current.length) pages.push(current)
  return pages
}

/**
 * 실제 인원 목록을 몇 페이지로 나눌지, 각 페이지의 데이터 행 높이는 얼마로 할지 계획한다.
 * 템플릿이 이 표 형식이 아니면 null.
 */
export function planScheduleSlides(slideXml: string, groups: ScheduleGroup[]): SchedulePage[] | null {
  const layout = analyzeTemplate(slideXml)
  if (!layout) return null
  const { preHeight, origDataRowH, budgetCy } = layout

  const totalRows = groups.reduce((s, g) => s + g.entries.length, 0)
  if (totalRows === 0) return []
  if (!budgetCy) return [{ groups, dataRowH: origDataRowH }]

  const available = budgetCy - preHeight

  let pages: ScheduleGroup[][] = [groups]
  for (let numPages = 1; numPages <= MAX_PAGES; numPages++) {
    const candidate = packGroupsBalanced(groups, numPages)
    const worstRows = Math.max(...candidate.map(p => p.reduce((s, g) => s + g.entries.length, 0)))
    const rowH = Math.floor(available / worstRows)
    pages = candidate
    if (rowH >= COMFORTABLE_MIN_ROW_H || numPages === MAX_PAGES) break
  }

  const isPaginated = pages.length > 1
  return pages.map(pageGroups => {
    const rowsOnPage = pageGroups.reduce((s, g) => s + g.entries.length, 0)
    const fitted = Math.floor(available / rowsOnPage)
    // 1페이지에 다 들어가는(=페이지를 안 나누는) 경우는 기존 동작 그대로: 원본 템플릿
    // 행보다 커지지 않게(여유가 있으면 그냥 원본 크기 + 남는 여백 유지).
    // 실제로 여러 페이지로 나뉜 경우는 사용자가 요청한 대로 "그 페이지 분량에 맞춰
    // 정확히 채운다" — 마지막 페이지가 인원이 적으면 행이 원본보다 커질 수도 있다.
    const dataRowH = isPaginated
      ? Math.max(COMFORTABLE_MIN_ROW_H, fitted)
      : Math.min(origDataRowH, Math.max(COMFORTABLE_MIN_ROW_H, fitted))
    return { groups: pageGroups, dataRowH }
  })
}

/**
 * 표 안의 "사람 그룹" 행들을 실제 그룹 목록으로 치환한다.
 * 이 슬라이드가 이 표 형식이 아니면(헤더/템플릿 행을 못 찾으면) null을 반환 —
 * 호출 쪽에서는 null이면 이 슬라이드를 건드리지 않고 넘어가면 된다.
 *
 * @param forcedDataRowH  planScheduleSlides()가 계산해 준 이 페이지 전용 행 높이.
 *                        생략하면(단독 호출용) 원본 템플릿 행 높이를 그대로 쓴다.
 */
export function expandScheduleTable(slideXml: string, groups: ScheduleGroup[], forcedDataRowH?: number): string | null {
  const layout = analyzeTemplate(slideXml)
  if (!layout) return null
  const { tbl, tblStart, rawPreRows, preRows, firstDataRowTpl, contRowTpl, origDataRows, origDataRowH, preHeight, budgetCy } = layout

  const rowSpanRe = /(<a:tc\s+rowSpan=")(\d+)(")/
  const dataRowH = forcedDataRowH ?? origDataRowH

  // ── 그룹별 행 생성 ──────────────────────────────────────────────
  let newDataRowsXml = ''
  for (const g of groups) {
    const n = g.entries.length
    if (n === 0) continue
    let first = firstDataRowTpl.replace(rowSpanRe, (_m, a, _n, c) => `${a}${n}${c}`)
    if (dataRowH !== origDataRowH) first = setRowHeight(first, dataRowH)
    first = applyPlaceholderMap(first, buildEntryMap(g.entries[0], g.name))
    newDataRowsXml += first

    for (let i = 1; i < n; i++) {
      let cont = contRowTpl
      if (dataRowH !== origDataRowH) cont = setRowHeight(cont, dataRowH)
      cont = applyPlaceholderMap(cont, buildEntryMap(g.entries[i]))
      newDataRowsXml += cont
    }
  }

  const newTbl = tbl.replace(rawPreRows.join('') + origDataRows.join(''), preRows.join('') + newDataRowsXml)
  const newSlideXml = slideXml.slice(0, tblStart) + newTbl + slideXml.slice(tblStart + tbl.length)

  // ── graphicFrame의 <p:xfrm> cy를 실제 합계로 갱신 (표시상 참고용, 필수는 아님) ──
  if (budgetCy) {
    const dataRowMatches = newDataRowsXml.match(/<a:tr h="(\d+)">/g)
    const newTotal = preHeight + (dataRowMatches ? dataRowMatches.reduce((s, m) => s + Number(m.match(/\d+/)![0]), 0) : 0)
    const before = newSlideXml.slice(0, newSlideXml.indexOf(newTbl))
    const lastXfrm = [...before.matchAll(/<p:xfrm><a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/><\/p:xfrm>/g)].pop()
    if (lastXfrm) {
      const oldXfrm = lastXfrm[0]
      const newXfrm = oldXfrm.replace(/cy="\d+"\/><\/p:xfrm>$/, `cy="${newTotal}"/></p:xfrm>`)
      return newSlideXml.replace(oldXfrm, newXfrm)
    }
  }
  return newSlideXml
}
