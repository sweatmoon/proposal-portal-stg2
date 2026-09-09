/**
 * 인력 프로파일 HTML 파서
 * 파일: 프로파일(성명).html
 *
 * 실제 확인된 HTML 테이블 구조 (강신배 기준):
 *   index 0~2 : 헤더/메뉴 등 무시
 *   index 3   : 기본정보
 *     row0: [성명 (직위)] [감리] [IT 경력] [프로젝트 경력] [보유 자격] [회사]  ← 헤더
 *     row1: [강신배 (수석, 상근)] [105회...] [9회...] [6회] [4개] [ATV]        ← 값
 *     row2: [감리원증] [감리원 등급] [기술 등급] [감리 경력] [감리 시작일]      ← 라벨행
 *     row3: [서울 제134호] [수석감리원] [기술사] [-] [0]                        ← 값행
 *     row4: [이메일] [연락처] [생년월일]                                         ← 라벨행
 *     row5: [sbaekang@activo.kr] [010-8769-9410] [640621]                       ← 값행
 *     row6: [최종학교] [전공분야] [학위]
 *     row7: [건국대학교 대학원 박사과정] [] [박사과정]
 *   index 4   : 교육정보
 *   index 8   : 감리실적  (헤더: 연월|사업명|주관기관|공공민간|담당분야|역할|참여단계|참여율)
 *   index 10  : (참고용, 더 이상 안 씀) 예전엔 여기를 "IT 경력"으로 취급했으나
 *               실제로는 "3. 프로젝트 및 기타 경력" 표(헤더: 연도|프로젝트명|주관기관
 *               |담당분야|역할|소속회사|비고)였다. 진짜 "2. 감리 이외의 IT 경력"은
 *               앵커 name="it" 섹션에 있고, 160개 프로파일 전수 확인 결과 항상
 *               기간(년)|경력|담당 업무|유사 경력의 근거 4열 포맷이다(2026-09-09
 *               발견 및 수정 — 아래 extractAnchorSectionHtml 참고).
 *   index 11  : 자격증    (헤더: 자격증명|발급처|국가공인여부|관련분야)
 */

import { parseHtmlTables, extractNumber } from './html-table-parser.js'

// 이메일 형식 검증
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

// 헤더 키워드로 테이블 동적 탐색 (모든 키워드가 첫 행에 포함돼야 매칭)
function findTableByHeaders(
  tables: { rows: string[][] }[],
  headers: string[]
): { rows: string[][] } | null {
  for (const t of tables) {
    const firstRow = (t.rows[0] ?? []).join(' ')
    if (headers.every(h => firstRow.includes(h))) return t
  }
  return null
}

// 프로파일 HTML의 각 섹션은 "<a name="섹션이름"></a>" 앵커로 시작한다(예:
// "it" = "2. 감리 이외의 IT 경력", "prjct" = "3. 프로젝트 및 기타 경력"). 헤더
// 텍스트만으로 표를 추측하면 인접 섹션의 표가 우연히 비슷한 헤더를 가질 때 잘못
// 고를 수 있어서, 해당 앵커부터 그 다음 앵커 전까지의 HTML만 잘라내 그 안의
// 표만 보도록 한다. 앵커를 못 찾으면 null(호출 쪽에서 기존 방식으로 fallback).
function extractAnchorSectionHtml(html: string, anchorName: string): string | null {
  const anchorRe = new RegExp(`<a\\s+name="${anchorName}"\\s*>`, 'i')
  const m = anchorRe.exec(html)
  if (!m) return null
  const rest = html.slice(m.index + m[0].length)
  const nextIdx = rest.search(/<a\s+name="[^"]+"\s*>/i)
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx)
}

// ─── 반환 타입 ────────────────────────────────────────────────
export interface PersonnelData {
  name: string
  position: string
  is_fulltime: number
  company: string
  email: string
  phone: string
  birthdate: string
  auditor_cert_no: string
  auditor_grade: string
  tech_grade: string
  school: string
  major: string
  degree: string
  career_summary: string
  career_qualif: string
  career_project: string
  career_expert: string
  education_name: string
  education_hours: number
  education_org: string
}

export interface PersonnelCertification {
  cert_name: string
  cert_year: string
  issuer: string
  is_national: number
  related_field: string
}

export interface PersonnelAuditHistory {
  audit_yearmonth: string
  project_name: string
  client_org: string
  sector: string
  domain: string
  role: string
  phase: string
  participation_rate: number
}

export interface PersonnelItCareer {
  period_start: string
  period_end: string
  /** "경력" 열 — HTML 원문 표기 그대로(감사 대상과 무관한 IT 경력을 쌓은 회사/부서명) */
  career: string
  /** "담당 업무" 열 */
  duty: string
  /** "유사 경력의 근거" 열 */
  basis: string
}

export interface PersonnelProjectCareer {
  /** "연도" 열 — HTML 원문 그대로(예: "2004.01-2004.09"), 시작/끝으로 안 나눔 */
  year_range: string
  project_name: string
  client_org: string
  domain: string
  role: string
  company: string
  remarks: string
}

export interface ParsedPersonnel {
  personnel: PersonnelData
  certifications: PersonnelCertification[]
  audit_history: PersonnelAuditHistory[]
  it_career: PersonnelItCareer[]
  project_career: PersonnelProjectCareer[]
}

// ─── 기간 파싱: "2015년10월～2017년3월" or "2015.10 ~ 2017.03" → { start, end } ──
function parsePeriod(raw: string): { start: string; end: string } {
  // 구분자: ～ | ~ | - (단, 연도 내부 - 는 제외)
  const sep = raw.includes('～') ? '～' : raw.includes('~') ? '~' : ' - '
  const parts = raw.split(sep).map(s => s.trim())

  const toYYYYMM = (s: string): string => {
    const m1 = s.match(/(\d{4})[년.\/\-](\d{1,2})/)
    if (m1) return `${m1[1]}.${m1[2].padStart(2, '0')}`
    const m2 = s.match(/(\d{4})\.(\d{1,2})/)
    if (m2) return `${m2[1]}.${m2[2].padStart(2, '0')}`
    return s
  }

  return {
    start: toYYYYMM(parts[0] ?? ''),
    end:   toYYYYMM(parts[1] ?? ''),
  }
}

// ─── 메인 파서 ───────────────────────────────────────────────
export function parsePersonnelHtml(html: string): ParsedPersonnel {
  const tables = parseHtmlTables(html)

  // ── 1. 기본정보 테이블 탐색 ──────────────────────────────
  // "성명 (직위)" 헤더를 포함하는 테이블 (index 3)
  const basicTable =
    tables[3] ??
    findTableByHeaders(tables, ['성명']) ??
    tables.find(t => t.rows.some(r => r.join(' ').includes('감리원증'))) ??
    null
  const t4 = basicTable?.rows ?? []

  const personnel: PersonnelData = {
    name: '', position: '', is_fulltime: 1, company: '',
    email: '', phone: '', birthdate: '',
    auditor_cert_no: '', auditor_grade: '', tech_grade: '',
    school: '', major: '', degree: '',
    career_summary: '', career_qualif: '', career_project: '', career_expert: '',
    education_name: '', education_hours: 0, education_org: '',
  }

  // ── rowspan 오프셋 감지 헬퍼 ─────────────────────────────────
  // HTML에서 첫 번째 열이 rowspan으로 인력 이름이 반복 삽입되는 경우,
  // cells[0]이 항상 이름이 되어 실제 라벨이 cells[1]부터 시작함
  // → 행 전체에서 라벨 키워드를 찾아 실제 시작 오프셋을 반환
  function findOffset(cells: string[], ...keywords: string[]): number {
    for (let ci = 0; ci < cells.length; ci++) {
      if (keywords.some(kw => cells[ci].includes(kw))) return ci
    }
    return 0
  }

  // 실제 HTML 구조: 라벨 행 다음에 값 행이 오는 패턴
  // rowspan 있는 경우: row N = [이름(rowspan), 감리원증, 감리원 등급, ...]
  //                   row N+1 = [이름(rowspan), 정감협 제4755호, 감리원, ...]
  // rowspan 없는 경우: row N = [감리원증, 감리원 등급, ...]
  //                   row N+1 = [정감협 제4755호, 감리원, ...]

  for (let i = 0; i < t4.length; i++) {
    const cells = (t4[i] ?? []).map(c => (c ?? '').trim())
    const rowText = cells.join(' ')

    // ── 성명/직위/회사 ─────────────────────────────────────
    if (rowText.includes('성명') && rowText.includes('직위')) {
      // 다음 행이 값 행
      const vRow = (t4[i + 1] ?? []).map(c => (c ?? '').trim())
      // 성명 헤더 오프셋 찾기
      const off = findOffset(cells, '성명')
      const raw = vRow[off] ?? ''   // "강신배 (수석, 상근)" 또는 "김현호 (과장, 상근)"
      const mName = raw.match(/^([^\(（\s]+)/)
      if (mName) personnel.name = mName[1]
      const mPos  = raw.match(/[（(]([^,）)]+)/)
      if (mPos) personnel.position = mPos[1].trim()
      personnel.is_fulltime = raw.includes('상근') ? 1 : 0
      // 회사: 마지막 셀 (index off+5 기준)
      personnel.company = vRow[off + 5] ?? vRow[vRow.length - 1] ?? ''
    }

    // ── 감리원증 / 감리원 등급 / 기술 등급 라벨 행 감지 ───
    if (rowText.includes('감리원증') || rowText.includes('감리원 번호')) {
      const off = findOffset(cells, '감리원증', '감리원 번호')
      const vRow = (t4[i + 1] ?? []).map(c => (c ?? '').trim())
      // off부터 라벨-값 대응
      for (let ci = off; ci < cells.length; ci++) {
        const lbl = cells[ci]
        const val = (vRow[ci] ?? '').trim()
        if (!val || val === '-') continue
        if (lbl.includes('감리원증') || lbl.includes('감리원 번호')) personnel.auditor_cert_no = val
        if (lbl.includes('감리원 등급') || lbl === '감리등급')         personnel.auditor_grade   = val
        if (lbl.includes('기술 등급')   || lbl === '기술등급')          personnel.tech_grade      = val
        // 감리 경력/시작일: HTML 값을 직접 저장 (audit_history 없을 때 fallback용)
        // upload-personnel.ts의 동적 계산이 우선이므로 여기서는 보조 저장하지 않음
      }
    }

    // ── 이메일 / 연락처 / 생년월일 라벨 행 감지 ──────────
    if (rowText.includes('이메일')) {
      const off = findOffset(cells, '이메일')
      const vRow = (t4[i + 1] ?? []).map(c => (c ?? '').trim())
      for (let ci = off; ci < cells.length; ci++) {
        const lbl = cells[ci]
        const val = vRow[ci] ?? ''
        if (!val || val === '-') continue
        if (lbl.includes('이메일')) {
          if (isValidEmail(val)) personnel.email = val
        } else if (lbl.includes('연락처') || lbl.includes('핸드폰') || lbl.includes('전화')) {
          personnel.phone = val
        } else if (lbl.includes('생년월일') || lbl.includes('생년')) {
          personnel.birthdate = val
        }
      }
    }

    // ── 최종학교 라벨 행 감지 ────────────────────────────
    if (rowText.includes('최종학교')) {
      const off = findOffset(cells, '최종학교')
      const vRow = (t4[i + 1] ?? []).map(c => (c ?? '').trim())
      personnel.school = vRow[off] ?? ''
      for (let ci = off + 1; ci < cells.length; ci++) {
        const lbl = cells[ci]
        const val = vRow[ci] ?? ''
        if (lbl.includes('전공')) personnel.major  = val
        if (lbl.includes('학위') || lbl.includes('졸업')) personnel.degree = val
      }
      if (!personnel.major  && vRow[off + 1]) personnel.major  = vRow[off + 1]
      if (!personnel.degree && vRow[off + 2]) personnel.degree = vRow[off + 2]
    }

    // ── 경력 관련 필드 (라벨 | 값 이 같은 행에 있는 구조) ───
    // rowspan 있는 경우: cells[0]=이름, cells[1]=라벨, cells[2]=값
    // rowspan 없는 경우: cells[0]=라벨, cells[1]=값
    const lblIdx  = findOffset(cells, '주요 경력', '주요경력')
    const lblCell = cells[lblIdx] ?? ''
    const valCell = (cells[lblIdx + 1] ?? '').trim()

    if (lblCell.includes('주요 경력') && !lblCell.includes('자격') && !lblCell.includes('및')) {
      if (valCell) personnel.career_summary = valCell
    }
    if (lblCell.includes('주요 경력 및 자격') || lblCell.includes('주요경력및자격')) {
      if (valCell) personnel.career_qualif = valCell
    }

    const lblIdx2  = findOffset(cells, '시스템 개발', '프로젝트 실무')
    const lblCell2 = cells[lblIdx2] ?? ''
    const valCell2 = (cells[lblIdx2 + 1] ?? '').trim()
    if (lblCell2.includes('시스템 개발') || lblCell2.includes('프로젝트 실무')) {
      if (valCell2) personnel.career_project = valCell2
    }

    const lblIdx3  = findOffset(cells, '주요 이력', '전문가용')
    const lblCell3 = cells[lblIdx3] ?? ''
    const valCell3 = (cells[lblIdx3 + 1] ?? '').trim()
    if (lblCell3.includes('주요 이력') || lblCell3.includes('전문가용')) {
      if (valCell3) personnel.career_expert = valCell3
    }
  }

  // ── 이메일 전체 재스캔 (보조) ──────────────────────────
  if (!personnel.email) {
    outer: for (const row of t4) {
      for (const cell of row) {
        if (isValidEmail(cell ?? '')) {
          personnel.email = cell.trim()
          break outer
        }
      }
    }
  }

  // ── 2. 교육정보 (index 4, 헤더: 교육명|교육이수시간|교육기관) ──
  const eduTable =
    findTableByHeaders(tables, ['교육명']) ??
    findTableByHeaders(tables, ['교육', '시간']) ??
    tables[4]
  const t5 = eduTable?.rows ?? []
  if (t5.length >= 2) {
    const dr = (t5[1] ?? []).map(c => (c ?? '').trim())
    personnel.education_name  = dr[0] ?? ''
    personnel.education_hours = extractNumber(dr[1] ?? '') ?? 0
    personnel.education_org   = dr[2] ?? ''
  }

  // ── 3. 감리실적 (헤더: 연월|사업명|주관기관|공공/민간|담당분야|역할|참여단계|참여율) ──
  const auditTable =
    findTableByHeaders(tables, ['사업명', '참여율']) ??
    findTableByHeaders(tables, ['사업명', '참여 단계']) ??
    tables[8]
  const t7 = auditTable?.rows ?? []
  const audit_history: PersonnelAuditHistory[] = []
  for (let i = 1; i < t7.length; i++) {
    const r = (t7[i] ?? []).map(c => (c ?? '').trim())
    if (!r[0] || !r[1]) continue
    if (!/\d{4}[.\s년]/.test(r[0])) continue
    audit_history.push({
      audit_yearmonth:    r[0],
      project_name:       r[1],
      client_org:         r[2] ?? '',
      sector:             r[3] ?? '',
      domain:             r[4] ?? '',
      role:               r[5] ?? '',
      phase:              r[6] ?? '',
      participation_rate: extractNumber(r[7] ?? '') ?? 100,
    })
  }

  // ── 4. IT 경력 ─────────────────────────────────────────────
  // "2. 감리 이외의 IT 경력" 섹션(앵커 name="it")의 표를 가져온다. 헤더는 항상
  // 기간(년)|경력|담당 업무|유사 경력의 근거 4열 포맷(160개 프로파일 전수 확인,
  // 2026-09-09).
  //
  // 예전에는 이 표를 헤더 텍스트("프로젝트명"/"소속 회사" 등)로 추측해서 찾았는데,
  // 바로 다음 섹션인 "3. 프로젝트 및 기타 경력"(전혀 다른 항목! 7열: 연도|프로젝트명
  // |주관기관|담당분야|역할|소속회사|비고)이 우연히 비슷한 헤더 키워드를 갖고 있어서
  // 그 표를 잘못 골라오는 버그가 있었다 — 그동안 DB의 personnel_it_career에는
  // "감리 이외의 IT 경력"이 아니라 "프로젝트 및 기타 경력"이 저장되고 있었다(실제
  // 강신배/강춘모 데이터로 확인). 헤더 추측 대신 "it" 앵커와 그 다음 앵커 사이의
  // HTML만 잘라서 그 안의 표만 보면 확실하게 올바른 섹션을 고를 수 있다.
  const itSectionHtml = extractAnchorSectionHtml(html, 'it')
  const itSectionTables = itSectionHtml ? parseHtmlTables(itSectionHtml) : []
  // 데이터 행이 2행 이상인 테이블만 유효로 판단 (헤더만 있는 테이블 제외)
  const hasData = (t: { rows: string[][] } | null | undefined) =>
    t != null && t.rows.length >= 2
  // 앵커를 못 찾은(옛 형식 등) 경우를 대비한 fallback — 헤더 키워드로 4열 표를 직접
  // 찾는다("3. 프로젝트 및 기타 경력"을 오인식하던 예전 fallback은 제거).
  const itTable =
    itSectionTables.find(hasData) ??
    itSectionTables[0] ??
    findTableByHeaders(tables, ['기간', '경력', '담당']) ??
    null
  const t9 = itTable?.rows ?? []
  const it_career: PersonnelItCareer[] = []

  if (t9.length > 0) {
    // 헤더에서 컬럼 인덱스 파악 (기간(년)|경력|담당 업무|유사 경력의 근거 4열 고정)
    const hdr = (t9[0] ?? []).map(c => (c ?? '').trim())
    let cPeriod = 0, cCareer = 1, cDuty = 2, cBasis = 3

    for (let ci = 0; ci < hdr.length; ci++) {
      const h = hdr[ci]
      if (h.includes('기간') || h.includes('연도'))       cPeriod = ci
      // '경력'이 포함되더라도 '근거'가 같이 있으면 "유사 경력의 근거" 열이므로 제외
      if (h.includes('경력') && !h.includes('근거'))       cCareer = ci
      if (h.includes('담당'))                              cDuty   = ci
      if (h.includes('근거') || h.includes('비고'))        cBasis  = ci
    }

    for (let i = 1; i < t9.length; i++) {
      const r = (t9[i] ?? []).map(c => (c ?? '').trim())
      const periodRaw = r[cPeriod] ?? ''
      const careerRaw = r[cCareer] ?? ''
      if (!periodRaw || !careerRaw) continue
      if (!/\d{4}/.test(periodRaw)) continue

      const period = parsePeriod(periodRaw)
      it_career.push({
        period_start: period.start,
        period_end:   period.end,
        career:       careerRaw,
        duty:         r[cDuty]  ?? '',
        basis:        r[cBasis] ?? '',
      })
    }
  }

  // ── 4-1. 프로젝트 및 기타 경력 ("3. 프로젝트 및 기타 경력" 섹션, 앵커 name="prjct") ──
  // 헤더는 항상 연도|프로젝트명|주관 기관|담당 분야|역할|소속 회사|비고 7열 고정(160개
  // 프로파일 전수 확인, 2026-09-09). "2. 감리 이외의 IT 경력"과 마찬가지로 헤더 텍스트
  // 추측 대신 앵커로 정확한 섹션만 잘라서 본다.
  const projectSectionHtml = extractAnchorSectionHtml(html, 'prjct')
  const projectSectionTables = projectSectionHtml ? parseHtmlTables(projectSectionHtml) : []
  const projectTable =
    projectSectionTables.find(hasData) ??
    projectSectionTables[0] ??
    findTableByHeaders(tables, ['프로젝트명', '소속 회사']) ??
    null
  const t9b = projectTable?.rows ?? []
  const project_career: PersonnelProjectCareer[] = []

  if (t9b.length > 0) {
    // 헤더에서 컬럼 인덱스 파악 (연도|프로젝트명|주관 기관|담당 분야|역할|소속 회사|비고 7열 고정)
    const hdr = (t9b[0] ?? []).map(c => (c ?? '').trim())
    let cYear = 0, cProject = 1, cClient = 2, cDomain = 3, cRole = 4, cCompany = 5, cRemarks = 6

    for (let ci = 0; ci < hdr.length; ci++) {
      const h = hdr[ci]
      if (h.includes('연도') || h.includes('기간'))                        cYear    = ci
      if (h.includes('프로젝트') || h.includes('사업명'))                  cProject = ci
      if (h.includes('주관') || h.includes('발주') || h.includes('기관'))  cClient  = ci
      if (h.includes('분야'))                                              cDomain  = ci
      if (h.includes('역할'))                                              cRole    = ci
      if (h.includes('소속') || h.includes('회사'))                        cCompany = ci
      if (h.includes('비고'))                                              cRemarks = ci
    }

    for (let i = 1; i < t9b.length; i++) {
      const r = (t9b[i] ?? []).map(c => (c ?? '').trim())
      const yearRaw    = r[cYear]    ?? ''
      const projectRaw = r[cProject] ?? ''
      if (!yearRaw || !projectRaw) continue
      if (!/\d{4}/.test(yearRaw)) continue

      project_career.push({
        year_range:   yearRaw,
        project_name: projectRaw,
        client_org:   r[cClient]  ?? '',
        domain:       r[cDomain]  ?? '',
        role:         r[cRole]    ?? '',
        company:      r[cCompany] ?? '',
        remarks:      r[cRemarks] ?? '',
      })
    }
  }

  // ── 5. 자격증 (헤더: 자격증명|발급처|국가공인여부|관련분야) ──
  // 실제 확인: index 11
  const certTable =
    findTableByHeaders(tables, ['자격증 명', '발급처']) ??
    findTableByHeaders(tables, ['자격증', '국가공인']) ??
    tables[11]
  const t10 = certTable?.rows ?? []
  const certifications: PersonnelCertification[] = []
  for (let i = 1; i < t10.length; i++) {
    const r = (t10[i] ?? []).map(c => (c ?? '').trim())
    if (!r[0]) continue
    const nameRaw = r[0]
    const mYear   = nameRaw.match(/\((\d{4})\)/)
    const certName = nameRaw.replace(/\s*\(\d{4}\)/, '').trim()
    certifications.push({
      cert_name:     certName,
      cert_year:     mYear ? mYear[1] : '',
      issuer:        r[1] ?? '',
      is_national:   (r[2] ?? '').includes('국가공인') ? 1 : 0,
      related_field: r[3] ?? '',
    })
  }

  return { personnel, certifications, audit_history, it_career, project_career }
}
