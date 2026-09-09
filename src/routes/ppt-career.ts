/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "2. 투입 감리원별 실적 및 경력" PPT 생성
 * (이 파일은 새로 추가된 파일이며, 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식
 * 방법은 src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 첨부 템플릿(인력 1명당 2슬라이드: 1/2=유사 감리 실적, 2/2=IT경력·자격증·실적 이어붙임)을
 * 해당 사업에 투입된 proposal_members 전원(감리원/전문가/테스터 구분 없이 전부, 2026-09-01
 * 사용자 확인 — 감리원만이 아니라 투입 인력 전체)으로, 인원 수만큼 슬라이드를 복제해서
 * 채웁니다. 인력 순서는 proposal_members.id 등록순(2026-09-01 확인 — 이름 가나다순 아님).
 * personnel DB에 이름이 없는 사람은 실적 데이터 자체가 없으므로 건너뜁니다.
 *
 * 필드 매핑:
 *   [제목]       고정 문자열 "투입 감리원별 실적 및 경력"
 *   [감리사업명]  audit_projects.project_name (레이아웃 브레드크럼)
 *   [이름]       proposal_members.person_name
 *   [담당분야]    이 사업에서의 담당 분야 = proposal_members.domain
 *
 *   ● 유사 감리 실적 (최대 35행 + 총건수 요약 1행):
 *     - 매칭 규칙은 실제 서비스(proposal-portal-main/src/routes/personnel-list.ts)의
 *       키워드 매칭 부분을 그대로 이식했다 (2026-09-01 원본 코드 확인) — 단, 그쪽에 있던
 *       "담당분야 겹치면 도메인값을 대괄호로 보여주는" 2차 폴백은 제외했다: 명시적으로
 *       등록된 키워드가 아닌 건 대괄호로 표시하면 안 된다는 사용자 확인(2026-09-01).
 *         1) "사업명+담당분야+주관기관"을 공백 제거 후 이어붙인 문자열에서, 이 사업의
 *            keywords(공백 제거 후, sort_order 오름차순)가 부분 문자열로 있는지 검사.
 *            매치되면 그 중 sort_order가 가장 낮은(=우선순위 1등) keyword를
 *            keyword_mappings로 변환한 "카테고리명"을 대괄호에 표시(예: AI/지능형→인공지능).
 *            매핑이 없으면 keyword 원문 그대로 표시.
 *         2) 키워드가 하나도 안 걸리면 대괄호 없이 사업명만 표시.
 *       정렬: keyword 매치(그 안에서 sort_order 오름차순) → 매치 없음, 각 그룹 안에서는 최신순.
 *     - 대괄호 색상(이 PPT 전용 추가 규칙): 카테고리명에 "기관"이 들어있으면(주관기관/발주기관
 *       등, 사업마다 이름이 다름) 배경색을 초록으로, 그 외 매치는 대괄호 글자를 빨간색으로
 *       (2026-09-01 확인).
 *     - 완전히 동일한 이력(연도/사업명/주관기관/구분/담당분야/역할/참여율이 전부 같음)은
 *       중복 제거. 같은 사업명이 연속으로 나오면(담당분야/역할 등만 다름) "사업명" 셀을
 *       세로로 병합해서 한 사업에서 갈라진 것처럼 표시 (2026-09-01 확인).
 *     - 앞 35건만 번호 1~35로 보여주고, 전체(중복 제거 후)가 35건을 넘으면 맨 아래에
 *       "총 개수" 행 — 번호=전체 개수, 내용=가장 오래된(최초) 이력.
 *     - 총 건수는 "중복 제거된 전체" personnel_audit_history 행 수 (매칭 여부 무관).
 *
 *   ● 대상사업과 관련된 감리 이외의 경력: personnel_it_career, id 저장순.
 *     컬럼이 프로파일 HTML "2. 감리 이외의 IT 경력" 표(기간(년)|경력|담당 업무|유사
 *     경력의 근거)와 1:1로 이름을 맞춰뒀다(2026-09-09 — career/duty/basis). 예전엔
 *     이 표 대신 완전히 다른 섹션인 "3. 프로젝트 및 기타 경력"이 잘못 저장되고
 *     있었다 — src/parsers/personnel-parser.ts 참고.
 *     이 표가 비어있는 사람(감리 이외의 IT 경력이 원래 없는 경우)은 personnel_project_career
 *     ("3. 프로젝트 및 기타 경력")로 대신 채운다(2026-09-09 사용자 확인) — 연도는 빼고
 *     경력=project_name, 담당 업무=domain, 유사 경력의 근거=role만 사용. 이땐 기간 정보가
 *     없어 기간(년) 열과 "총 OO년 OO개월" 요약은 비워둔다.
 *   ● 보유 자격 현황 (고정 4행): personnel_certifications, id 저장순 앞 4개.
 *     구분은 is_national 1→"국가공인" / 0→"민간".
 *
 *   실제 건수가 고정 상한(35/3/4)보다 적으면 남는 행은 그냥 지워서 표를 줄입니다.
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장 없음).
 *
 * POST /api/ppt-career/:projectId
 *   multipart/form-data: template: File (.pptx, 슬라이드 2장짜리)
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { query, queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { buildMultiSlideDeck } from '../lib/pptx-deck.js'
import { fillHistoryCluster, fillSimpleRow, type HistoryRowData } from '../lib/pptx-career-rows.js'

const app = new Hono()

const PAGE_TITLE = '투입 감리원별 실적 및 경력'
const HISTORY_VISIBLE_CAP = 35
const HISTORY_SLIDE1_CAP = 25
// "1페이지로 압축" 옵션(2026-09-05 사용자 확인 — "감리경력을 줄이고 나머지 감리외경력과
// 자격증을 한 페이지에 몰아넣은 1페이지로 뽑는 기능")에서 보여줄 유사 감리 실적 건수.
// 일단 15건으로 시작 — 필요하면 이 값만 바꾸면 됨.
const ONE_PAGE_HISTORY_CAP = 15
// 발주처/주관기관 카테고리 이름은 사업마다 사용자가 직접 입력하는 자유 텍스트라 값이
// 고정돼있지 않다 (사업1은 "주관기관", 사업2는 "발주기관"으로 확인됨 — 2026-09-01).
// 정확히 같은 문자열인지 대신, 한국어에서 발주처를 가리킬 때 공통적으로 쓰이는 "기관"이
// 카테고리 이름에 들어있는지로 판단한다.
const ORG_CATEGORY_PATTERN = /기관/

interface Member {
  person_name: string
  domain: string | null
}
interface HistoryRow {
  audit_yearmonth: string | null
  project_name: string
  client_org: string | null
  sector: string | null
  domain: string | null
  role: string | null
  participation_rate: number | null
}
interface ItCareerRow {
  period_start: string | null
  period_end: string | null
  career: string
  duty: string | null
  basis: string | null
}
interface ProjectCareerRow {
  project_name: string
  domain: string | null
  role: string | null
}
interface CertRow {
  cert_name: string
  issuer: string | null
  is_national: number | null
  related_field: string | null
}
interface KeywordRow {
  keyword: string
  sort_order: number
}
interface MatchResult {
  matchType: 'keyword' | 'none'
  /** 대괄호에 표시할 텍스트 — keyword면 매핑된 카테고리명, domain이면 이력 항목의 domain 값 */
  bracketText: string | null
  /** keyword 매치일 때만 의미 있음 — sort_order (낮을수록 우선) */
  sortOrder: number
}
interface PersonChunk {
  name: string
  domain: string
  historyTotal: number
  slide1Clusters: HistoryRowData[][]
  slide2Clusters: HistoryRowData[][]
  lastRow: HistoryRowData | null
  /** "1페이지로 압축" 모드 전용 — 유사 감리 실적 상위 ONE_PAGE_HISTORY_CAP건. 일반 모드에서는 빈 배열. */
  onePageClusters: HistoryRowData[][]
  /** "1페이지로 압축" 모드에서 실제 건수가 ONE_PAGE_HISTORY_CAP을 넘을 때만 채워지는
   *  "총 건수" 요약 행(가장 오래된 이력, 번호=전체 건수) — lastRow와 같은 개념이되 기준
   *  건수만 다르다. 안 넘으면 null(요약 행 자체를 안 넣음). */
  onePageLastRow: HistoryRowData | null
  itCareerDuration: string
  itCareerRows: { period: string; career: string; duty: string; basis: string }[]
  certTotal: number
  certRows: { name: string; issuer: string; type: string; field: string }[]
}

function extractText(x: string): string {
  return [...x.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
}

function findTable(slideXml: string, headerMarkers: string[]): { tbl: string; tblIndex: number; rows: string[]; headerIdx: number } | null {
  const tblMatches = [...slideXml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)]
  for (const m of tblMatches) {
    const tbl = m[0]
    const rows = tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []
    const headerIdx = rows.findIndex(r => headerMarkers.every(hm => extractText(r).includes(hm)))
    if (headerIdx !== -1 && m.index !== undefined) return { tbl, tblIndex: m.index, rows, headerIdx }
  }
  return null
}

/** header 바로 다음부터 끝에서 keepTrailingRows개를 남기고 나머지를 newDataRowsXml로 교체 */
function replaceDataRows(slideXml: string, headerMarkers: string[], newDataRowsXml: string, keepTrailingRows = 0): string {
  const found = findTable(slideXml, headerMarkers)
  if (!found) throw new Error('표를 찾지 못했습니다: ' + headerMarkers.join(','))
  const { tbl, tblIndex, rows, headerIdx } = found
  const dataEnd = rows.length - keepTrailingRows
  const oldDataRows = rows.slice(headerIdx + 1, dataEnd).join('')
  let newTbl: string
  if (oldDataRows === '') {
    const headerRow = rows[headerIdx]
    const pos = tbl.indexOf(headerRow) + headerRow.length
    newTbl = tbl.slice(0, pos) + newDataRowsXml + tbl.slice(pos)
  } else {
    newTbl = tbl.replace(oldDataRows, newDataRowsXml)
  }
  return slideXml.slice(0, tblIndex) + newTbl + slideXml.slice(tblIndex + tbl.length)
}

function getRow(slideXml: string, headerMarkers: string[], offsetFromHeader: number): string {
  const found = findTable(slideXml, headerMarkers)
  if (!found) throw new Error('표를 찾지 못했습니다: ' + headerMarkers.join(','))
  const row = found.rows[found.headerIdx + offsetFromHeader]
  if (!row) throw new Error('원본 행을 찾지 못했습니다: ' + headerMarkers.join(','))
  return row
}

const HISTORY_HEADER_MARKERS = ['번호', '연도', '사 업 명', '주관기관', '담당 분야', '역할', '참여율']
const IT_CAREER_HEADER_MARKERS = ['기간(년)', '경력', '담당 업무', '유사 경력의 근거']
const CERT_HEADER_MARKERS = ['자격증 명', '발급처', '구분 (국가 공인 여부)', '관련 분야']

/** personnel_audit_history.audit_yearmonth는 이미 "YYYY.MM" 형식으로 저장돼 있으므로
 *  그대로 보여준다(2026-09-02 사용자 확인 — 예전엔 연도만 잘라서 보여줬는데, 월까지
 *  "2026.08"처럼 그대로 보이게 수정). */
function fmtYearMonth(yearmonth: string | null): string {
  return yearmonth ?? ''
}
function fmtParticipation(rate: number | null): string {
  return rate === null || rate === undefined ? '' : `${rate}%`
}

/** "YYYY.MM" 문자열을 {y, m}으로 파싱. 형식이 아니면 null. */
function parseYearMonth(s: string | null): { y: number; m: number } | null {
  if (!s) return null
  const m = s.match(/^(\d{4})\.(\d{1,2})$/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) }
}

/** period_start~period_end 한 건의 개월 수 (양끝 달 포함). 파싱 실패 시 0. */
function monthsBetween(start: string | null, end: string | null): number {
  const s = parseYearMonth(start)
  const e = parseYearMonth(end)
  if (!s || !e) return 0
  return Math.max(0, (e.y - s.y) * 12 + (e.m - s.m) + 1)
}

/** 총 개월 수를 "YY년 MM개월" 형식으로 (2026-09-01 사용자 확인 — 건수가 아니라 기간). */
function fmtYearsMonths(totalMonths: number): string {
  const y = Math.floor(totalMonths / 12)
  const mo = totalMonths % 12
  return `${y}년 ${mo}개월`
}

async function loadKeywords(projectId: number): Promise<KeywordRow[]> {
  return query<KeywordRow>(
    `SELECT keyword, sort_order FROM keywords WHERE project_id = $1 ORDER BY sort_order ASC`,
    [projectId]
  )
}

/** original_keyword → mapped_keyword 1:1 변환표 (예: "AI"/"지능형" 둘 다 → "인공지능"). */
async function loadKeywordMappingMap(projectId: number): Promise<Map<string, string>> {
  const rows = await query<{ original_keyword: string; mapped_keyword: string }>(
    `SELECT original_keyword, mapped_keyword FROM keyword_mappings WHERE project_id = $1`,
    [projectId]
  )
  const map = new Map<string, string>()
  for (const r of rows) map.set(r.original_keyword, r.mapped_keyword)
  return map
}

/**
 * proposal-portal-main/src/routes/personnel-list.ts의 키워드 매칭 규칙을 그대로 이식하되,
 * 그쪽에 있던 "담당분야 겹치면 도메인값을 대괄호로 보여주는" 2차 폴백은 뺐다 — 명시적으로
 * 등록된 키워드가 아닌 걸 대괄호로 보여주면 안 된다는 사용자 확인(2026-09-01). 키워드가
 * 하나도 안 걸리면 그냥 대괄호 없이 사업명만 보여준다.
 */
function matchHistoryEntry(h: HistoryRow, keywords: KeywordRow[], mappingMap: Map<string, string>): MatchResult {
  const combined = [h.project_name, h.domain ?? '', h.client_org ?? ''].join('').replace(/\s+/g, '')
  const matched: KeywordRow[] = []
  for (const kw of keywords) {
    if (combined.includes(kw.keyword.replace(/\s+/g, ''))) matched.push(kw)
  }
  if (matched.length > 0) {
    const top = matched[0]
    return { matchType: 'keyword', bracketText: mappingMap.get(top.keyword) ?? top.keyword, sortOrder: top.sort_order }
  }
  return { matchType: 'none', bracketText: null, sortOrder: Infinity }
}

function dedupeKey(h: HistoryRow): string {
  return [h.audit_yearmonth, h.project_name, h.client_org, h.sector, h.domain, h.role, h.participation_rate].join('|')
}

/** 순서를 유지한 채, 연속으로 같은 사업명인 행들을 하나의 클러스터로 묶는다. */
function clusterConsecutive(entries: HistoryRowData[]): HistoryRowData[][] {
  const clusters: HistoryRowData[][] = []
  for (const e of entries) {
    const last = clusters[clusters.length - 1]
    if (last && last[0].projectName === e.projectName) last.push(e)
    else clusters.push([e])
  }
  return clusters
}

/** 클러스터가 중간에 쪼개지지 않도록, 행 수 budget 안에서 앞쪽 클러스터들만 떼어낸다. */
function splitClustersByBudget(clusters: HistoryRowData[][], budget: number): { first: HistoryRowData[][]; rest: HistoryRowData[][] } {
  const first: HistoryRowData[][] = []
  let used = 0
  let i = 0
  for (; i < clusters.length; i++) {
    const n = clusters[i].length
    if (used > 0 && used + n > budget) break
    first.push(clusters[i])
    used += n
  }
  return { first, rest: clusters.slice(i) }
}

export interface CareerZipResult {
  zip: JSZip
  personCount: number
  skipped: string[]
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다.
 *  titlePrefix: 첨부PPT 묶음에서 이 항목이 몇 번째로 선택됐는지("2. " 등)를 제목 앞에 붙인다
 *  (단독 다운로드일 때는 생략되어 빈 문자열 — 기존과 동일하게 번호 없이 나온다). */
export async function buildCareerZip(
  templateBuf: Buffer,
  projectId: number,
  titlePrefix = '',
  onePage = false
): Promise<CareerZipResult> {
    // project/members/keywords/mapping은 서로 의존하는 값이 없는 독립 조회인데도 순서대로
    // await하면 원격 DB 환경에서는 라운드트립 지연이 그대로 4번 쌓인다(2026-09-02 실측: 이
    // 서버 환경에서 단순 조회 1번도 지연이 커서, 쿼리를 줄이는 것 자체가 핵심). 서로 안
    // 기다려도 되므로 한 번에 동시 요청한다.
    const [project, members, keywords, mappingMap] = await Promise.all([
      queryOne<{ project_name: string }>(`SELECT project_name FROM audit_projects WHERE id = $1`, [projectId]),
      query<Member>(`SELECT person_name, domain FROM proposal_members WHERE project_id = $1 ORDER BY id ASC`, [projectId]),
      loadKeywords(projectId),
      loadKeywordMappingMap(projectId),
    ])
    if (!project) throw new Error('사업을 찾을 수 없습니다')
    if (!members.length) throw new Error('이 사업에 투입된 인력이 없습니다')

    // 인력마다 personnel 조회 1번 + 실적/IT경력/자격증 3번, 총 (인원수 × 4)번을 각자 따로
    // 왕복하면 원격 DB 환경에서 인원이 많을수록 선형으로 느려진다(2026-09-02 실측: 17명
    // 기준 순차 처리 시 약 19초). 사람마다 결과가 갈리는 건 personnel_id일 뿐이므로, 이름
    // 목록으로 personnel을 한 번에 찾고, 그 id 목록으로 실적/IT경력/자격증도 각각 한 번씩만
    // (WHERE ... = ANY($1)) 조회한 뒤 personnel_id별로 메모리에서 묶는다 — 인원수와 무관하게
    // 총 4번의 추가 왕복으로 끝난다.
    const names = [...new Set(members.map(m => m.person_name))]
    const personnelRows = await query<{ id: number; name: string }>(
      `SELECT id, name FROM personnel WHERE name = ANY($1)`,
      [names]
    )
    const personnelIdByName = new Map<string, number>()
    for (const p of personnelRows) {
      if (!personnelIdByName.has(p.name)) personnelIdByName.set(p.name, p.id)
    }
    const foundIds = [...new Set(personnelIdByName.values())]

    const [allHistory, allItCareer, allProjectCareer, allCerts] = foundIds.length
      ? await Promise.all([
          query<HistoryRow & { personnel_id: number }>(
            `SELECT personnel_id, audit_yearmonth, project_name, client_org, sector, domain, role, participation_rate
             FROM personnel_audit_history WHERE personnel_id = ANY($1)`,
            [foundIds]
          ),
          query<ItCareerRow & { personnel_id: number }>(
            `SELECT personnel_id, period_start, period_end, career, duty, basis
             FROM personnel_it_career WHERE personnel_id = ANY($1) ORDER BY id ASC`,
            [foundIds]
          ),
          // "감리 이외의 IT 경력"이 없는 사람만 이걸로 대신 채운다(2026-09-09 사용자 확인).
          query<ProjectCareerRow & { personnel_id: number }>(
            `SELECT personnel_id, project_name, domain, role
             FROM personnel_project_career WHERE personnel_id = ANY($1) ORDER BY id ASC`,
            [foundIds]
          ),
          query<CertRow & { personnel_id: number }>(
            `SELECT personnel_id, cert_name, issuer, is_national, related_field
             FROM personnel_certifications WHERE personnel_id = ANY($1) ORDER BY id ASC`,
            [foundIds]
          ),
        ])
      : [[], [], [], []]

    function groupByPersonnelId<T extends { personnel_id: number }>(rows: T[]): Map<number, T[]> {
      const map = new Map<number, T[]>()
      for (const r of rows) {
        if (!map.has(r.personnel_id)) map.set(r.personnel_id, [])
        map.get(r.personnel_id)!.push(r)
      }
      return map
    }
    const historyByPid = groupByPersonnelId(allHistory)
    const itCareerByPid = groupByPersonnelId(allItCareer)
    const projectCareerByPid = groupByPersonnelId(allProjectCareer)
    const certsByPid = groupByPersonnelId(allCerts)

    const chunks: PersonChunk[] = []
    const skipped: string[] = []

    for (const m of members) {
      const pid = personnelIdByName.get(m.person_name)
      if (pid === undefined) {
        skipped.push(m.person_name)
        continue
      }
      const rawHistory = historyByPid.get(pid) ?? []
      const itCareer = itCareerByPid.get(pid) ?? []
      const projectCareer = projectCareerByPid.get(pid) ?? []
      const certs = certsByPid.get(pid) ?? []

      const seen = new Set<string>()
      const history = rawHistory.filter(h => {
        const key = dedupeKey(h)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const withMatch = history.map(h => ({ h, match: matchHistoryEntry(h, keywords, mappingMap) }))
      withMatch.sort((a, b) => {
        const ga = a.match.matchType === 'keyword' ? 0 : 1
        const gb = b.match.matchType === 'keyword' ? 0 : 1
        if (ga !== gb) return ga - gb
        if (a.match.matchType === 'keyword' && a.match.sortOrder !== b.match.sortOrder) return a.match.sortOrder - b.match.sortOrder
        return (b.h.audit_yearmonth || '').localeCompare(a.h.audit_yearmonth || '')
      })

      const toRowData = (entry: (typeof withMatch)[number], no: number): HistoryRowData => ({
        no,
        year: fmtYearMonth(entry.h.audit_yearmonth),
        projectName: entry.h.project_name,
        matchedText: entry.match.bracketText,
        isOrgMatch: entry.match.matchType === 'keyword' && ORG_CATEGORY_PATTERN.test(entry.match.bracketText ?? ''),
        clientOrg: entry.h.client_org ?? '',
        sector: entry.h.sector ?? '',
        domain: entry.h.domain ?? '',
        role: entry.h.role ?? '',
        participation: fmtParticipation(entry.h.participation_rate),
      })

      // 실제 건수가 cap을 넘을 때만 "총 건수" 요약 행(가장 오래된 이력, 번호=전체 건수)을
      // 만든다 — 일반 모드의 lastRow와 1페이지 모드의 onePageLastRow가 기준 건수만 다르고
      // 로직은 같아서 공용 클로저로 뺐다.
      const findOldestBeyondCap = (cap: number): HistoryRowData | null => {
        if (history.length <= cap) return null
        let oldest = withMatch[0]
        for (const e of withMatch) {
          if ((e.h.audit_yearmonth || '') < (oldest.h.audit_yearmonth || '')) oldest = e
        }
        return toRowData(oldest, history.length)
      }

      let slide1Clusters: HistoryRowData[][] = []
      let slide2Clusters: HistoryRowData[][] = []
      let lastRow: HistoryRowData | null = null
      let onePageClusters: HistoryRowData[][] = []
      let onePageLastRow: HistoryRowData | null = null

      if (onePage) {
        // "1페이지로 압축": 상위 ONE_PAGE_HISTORY_CAP건 + (넘으면) "중간 생략" 요약 행.
        const capped = withMatch.slice(0, ONE_PAGE_HISTORY_CAP)
        onePageClusters = clusterConsecutive(capped.map((e, i) => toRowData(e, i + 1)))
        onePageLastRow = findOldestBeyondCap(ONE_PAGE_HISTORY_CAP)
      } else {
        const visible = withMatch.slice(0, HISTORY_VISIBLE_CAP)
        const allClusters = clusterConsecutive(visible.map((e, i) => toRowData(e, i + 1)))
        const split = splitClustersByBudget(allClusters, HISTORY_SLIDE1_CAP)
        slide1Clusters = split.first
        slide2Clusters = split.rest
        // 번호는 최종 슬라이드1→슬라이드2 순서로 다시 매긴다 (클러스터 경계에 맞춰 25행에서
        // 살짝 못 미칠 수도 있으므로 원래 인덱스가 아니라 실제 출력 순서 기준으로).
        let seq = 0
        for (const cl of slide1Clusters) for (const e of cl) e.no = ++seq
        for (const cl of slide2Clusters) for (const e of cl) e.no = ++seq

        lastRow = findOldestBeyondCap(HISTORY_VISIBLE_CAP)
      }

      // "감리 이외의 IT 경력"이 없는 사람은 "프로젝트 및 기타 경력"으로 대신 채운다
      // (2026-09-09 사용자 확인). 이쪽은 기간 데이터가 없어(연도는 제외하고 프로젝트명/
      // 담당분야/역할만 씀) 기간(년) 열은 비워두고, 총 기간 요약도 계산하지 않는다.
      const itCareerRows =
        itCareer.length > 0
          ? itCareer.map(r => ({
              period: `${r.period_start ?? ''} ~ ${r.period_end ?? ''}`,
              career: r.career,
              duty: r.duty ?? '',
              basis: r.basis ?? '',
            }))
          : projectCareer.map(r => ({
              period: '',
              career: r.project_name,
              duty: r.domain ?? '',
              basis: r.role ?? '',
            }))
      const itCareerDuration =
        itCareer.length > 0
          ? fmtYearsMonths(itCareer.reduce((s, r) => s + monthsBetween(r.period_start, r.period_end), 0))
          : ''

      chunks.push({
        name: m.person_name,
        domain: m.domain ?? '',
        historyTotal: history.length,
        slide1Clusters,
        slide2Clusters,
        lastRow,
        onePageLastRow,
        onePageClusters,
        itCareerDuration,
        itCareerRows,
        certTotal: certs.length,
        certRows: certs.map(r => ({
          name: r.cert_name,
          issuer: r.issuer ?? '',
          type: r.is_national ? '국가공인' : '민간',
          field: r.related_field ?? '',
        })),
      })
    }

    if (!chunks.length) {
      throw new Error('실적 DB에서 매칭되는 인력이 한 명도 없습니다 (' + skipped.join(', ') + ')')
    }

    const commonMap: Record<string, string> = {
      '[제목]': `${titlePrefix}${PAGE_TITLE}`,
      '[감리사업명]': project.project_name,
    }

    const zip = await JSZip.loadAsync(templateBuf)

    const sharedPartNames = Object.keys(zip.files).filter(
      f => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f) || /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(f)
    )
    for (const partName of sharedPartNames) {
      const partXml = await zip.file(partName)!.async('string')
      const patched = applyPlaceholderMap(partXml, commonMap)
      if (patched !== partXml) zip.file(partName, patched)
    }

    if (onePage) {
      // "1페이지로 압축": 원래 2슬라이드(1/2=유사 감리 실적만, 2/2=실적 나머지+IT경력+자격증)
      // 중 3개 표가 다 있는 "2/2" 슬라이드만 남기고 나머지는 지운다. 파일 이름 순서에
      // 기대지 않고 내용(자격증 표가 있는지)으로 판별한다 — buildMultiSlideDeck은 zip에
      // 남아있는 slideN.xml 파일들만 템플릿으로 보므로, 여기서 미리 걸러두면 이후 콜백은
      // 항상 "2/2" 레이아웃 하나만 받게 된다.
      const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      for (const sf of slideFiles) {
        const xml = await zip.file(sf)!.async('string')
        if (!findTable(xml, CERT_HEADER_MARKERS)) {
          zip.remove(sf)
          const relsFile = sf.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
          if (zip.file(relsFile)) zip.remove(relsFile)
        }
      }
    }

    /** IT경력(고정 3행) + 자격증(고정 4행) 표 채우기 — "2/2" 레이아웃(일반 모드의 2번째
     *  슬라이드, "1페이지로 압축" 모드의 유일한 슬라이드)에서 공통으로 쓴다. */
    function fillItCareerAndCert(xml: string, tplSlideXml: string, person: PersonChunk): string {
      xml = applyPlaceholderMap(xml, {
        '[IT경력]': person.itCareerDuration,
        '[자격증개수]': String(person.certTotal),
      })
      const itCanonical = getRow(tplSlideXml, IT_CAREER_HEADER_MARKERS, 1)
      const itRowsXml = person.itCareerRows
        .map(r =>
          fillSimpleRow(itCanonical, {
            '[IT경력시작일] ~ [IT경력종료일]': r.period,
            '[경력]': r.career,
            '[담당업무]': r.duty,
            '[경력근거]': r.basis,
          })
        )
        .join('')
      xml = replaceDataRows(xml, IT_CAREER_HEADER_MARKERS, itRowsXml, 0)

      const certCanonical = getRow(tplSlideXml, CERT_HEADER_MARKERS, 1)
      const certRowsXml = person.certRows
        .map(r =>
          fillSimpleRow(certCanonical, {
            '[자격증명]': r.name,
            '[발급처]': r.issuer,
            '[구분]': r.type,
            '[관련분야]': r.field,
          })
        )
        .join('')
      return replaceDataRows(xml, CERT_HEADER_MARKERS, certRowsXml, 0)
    }

    await buildMultiSlideDeck(
      zip,
      (tplSlideXml, person: PersonChunk, templateIndex) => {
        const personMap = { ...commonMap, '[이름]': person.name, '[담당분야]': person.domain }
        let xml = applyPlaceholderMap(tplSlideXml, personMap)

        if (onePage) {
          // 유사 감리 실적 표: 행 높이/글자 크기는 템플릿 원본 그대로 두고 상위
          // ONE_PAGE_HISTORY_CAP건(+ 넘으면 "중간 생략" 구분행 + 총건수 요약행)을 그냥
          // 채운다(2026-09-05 사용자 확인 — "그냥 안내선 아래로 내려가도 되니까 그냥
          // 표시해... 나중에 고치면 됨" — 자동으로 줄여서 맞추지 않고, 표가 원래 자리보다
          // 아래로 늘어나는 건 감수한다. 다만 "유사감리실적중간생략" 구분행+요약행은
          // 일반 모드와 동일하게 유지).
          const found = findTable(tplSlideXml, HISTORY_HEADER_MARKERS)
          if (!found) throw new Error('유사 감리 실적 표를 찾지 못했습니다')
          const canonical = found.rows[found.headerIdx + 1]
          let rowsXml = person.onePageClusters.map(cl => fillHistoryCluster(canonical, cl)).join('')
          if (person.onePageLastRow) {
            const dividerRow = found.rows[found.rows.length - 2]
            rowsXml += dividerRow + fillHistoryCluster(canonical, [person.onePageLastRow])
          }
          xml = replaceDataRows(xml, HISTORY_HEADER_MARKERS, rowsXml, 0)

          // 이 슬라이드는 원래 "2/2"(2장 중 두 번째)였다는 표시가 제목 옆에 고정 텍스트로
          // 박혀있는데, 1페이지 모드는 슬라이드가 이거 하나뿐이라 의미가 없어 지운다.
          xml = xml.replace(/<a:r>((?:(?!<\/a:r>)[\s\S])*?)<a:t(?:\s[^>]*)?>\(2\/2\)<\/a:t><\/a:r>/, '')

          return fillItCareerAndCert(xml, tplSlideXml, person)
        }

        if (templateIndex === 0) {
          // 1/2: 감리실적 총건수 + 유사 감리 실적 표 앞 25행
          xml = applyPlaceholderMap(xml, { '[감리실적]': String(person.historyTotal) })
          const canonical = getRow(tplSlideXml, HISTORY_HEADER_MARKERS, 1)
          const rowsXml = person.slide1Clusters.map(cl => fillHistoryCluster(canonical, cl)).join('')
          xml = replaceDataRows(xml, HISTORY_HEADER_MARKERS, rowsXml, 0)
          return xml
        }

        // 2/2: 유사 감리 실적 표 나머지(26~35행 + 총건수 행) + IT경력 3행 + 자격증 4행
        const historyCanonical = getRow(tplSlideXml, HISTORY_HEADER_MARKERS, 1)
        const slide2RowsXml = person.slide2Clusters.map(cl => fillHistoryCluster(historyCanonical, cl)).join('')
        const lastRowXml = person.lastRow ? fillHistoryCluster(historyCanonical, [person.lastRow]) : ''
        // 표 구조: 헤더, 데이터(최대10), 구분선(고정), 총건수행 — 마지막 총건수행이 필요없으면
        // 구분선까지 같이 지운다(둘 다 keepTrailingRows에서 제외).
        const found = findTable(tplSlideXml, HISTORY_HEADER_MARKERS)
        if (!found) throw new Error('2/2 유사 감리 실적 표를 찾지 못했습니다')
        const dividerRow = found.rows[found.rows.length - 2]
        const trailing = person.lastRow ? dividerRow + lastRowXml : ''
        xml = replaceDataRows(xml, HISTORY_HEADER_MARKERS, slide2RowsXml + trailing, 0)

        return fillItCareerAndCert(xml, tplSlideXml, person)
      },
      chunks
    )

    return { zip, personCount: chunks.length, skipped, projectName: project.project_name }
}

app.post('/:projectId', async (c) => {
  try {
    const projectId = Number(c.req.param('projectId'))
    if (!projectId) return c.json({ ok: false, error: 'projectId가 필요합니다' }, 400)

    const contentType = c.req.header('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ ok: false, error: 'multipart/form-data 로 template 파일을 보내주세요' }, 400)
    }
    const form = await c.req.formData()
    const file = form.get('template') as File | null
    if (!file || file.size === 0) {
      return c.json({ ok: false, error: '첨부 템플릿(.pptx) 파일이 필요합니다' }, 400)
    }

    const templateBuf = Buffer.from(await file.arrayBuffer())
    const onePage = form.get('onePage') === 'true'
    const { zip, personCount, skipped, projectName } = await buildCareerZip(templateBuf, projectId, '', onePage)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('2_투입감리원별실적및경력_' + safeName)}.pptx"`)
    c.header('X-Auditor-Count', String(personCount))
    c.header('X-Skipped', encodeURIComponent(skipped.join(',')))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-career] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
