/**
 * [ppt-portal 추가 기능 — 인력정보 탭] "감리원 경력 확인서 발급요청" 엑셀 생성.
 * 인력정보 탭에서 체크한 인원들을 대상으로, NAS의 고정 템플릿(감리원 경력 확인서
 * 발급요청(악티보)_yymmdd_n명(양식_변경X).xlsx, 시트 1장=인원 1명 분량)을 인원 수만큼
 * 복제해 워크북 하나(인원별 시트 탭)로 만든다.
 *
 * 인원별로 채우는 값(2026-09-08 사용자 확인):
 *   [이름]           personnel.name
 *   [감리원등급]      personnel.auditor_grade — "수석감리원"이면 그대로, 아니면 "감리원"
 *   [감리원증 발급번호] personnel.auditor_cert_no
 *   [자격명]          personnel_certifications 중 cert_name에 "기술사"가 있으면 그 cert_name
 *                     그대로, 없고 "감리사"가 있으면 "정보시스템감리사"(여기까지는
 *                     수석감리원일 때만) — 그 외(자격증이 둘 다 없거나 수석감리원이 아님)는
 *                     "정보처리기사"
 *   [입사일]          NAS의 "00.재직증명서발행파일v4.xlsm"(재직증명서/경력증명서와 같은
 *                     원본, src/lib/xlsx-employee-lookup.ts) "직원정보" 시트의 입사일
 *                     (YYYY.MM.DD) 그대로 — 템플릿 문구가 "[입사일].~현재일까지"라 뒤에
 *                     이미 마침표가 붙어있으므로 원본 그대로("2021.01.18") 넣는다(2026-09-08
 *                     사용자 확인 — 이 파일에 입사일이 있다고 안내받음). 직원정보에 없거나
 *                     퇴직 처리된 사람은 다른 첨부 기능과 같은 원칙으로 건너뛰고(대괄호
 *                     그대로 남김) skippedNoHireDate에 기록한다.
 *   그림 2개          NAS의 "자격증(이름).pptx"에서 등급 이미지(수석감리원증/감리원증)와
 *                     자격명 이미지(기술사/감리사/정보처리기사)를 찾아 각각 바꿔치기
 *                     (src/lib/pptx-cert-lookup.ts + xlsx-cert-image-swap.ts)
 *
 * 값이 실제로 채워진 셀은 검은 글씨로 바뀐다(원래 빨간 글씨 placeholder 스타일의 "폰트만
 * 검은색인 사본"을 만들어 그 셀에만 적용 — src/lib/xlsx-style-patch.ts). 매칭에 실패해
 * 대괄호가 그대로 남는 셀은 빨간 글씨 그대로 유지되어 "아직 수동으로 채워야 함"이 표시된다.
 *
 * 템플릿의 K열(3~5행에 남아있던 버전 관리용 잔여 값)은 인원과 무관하게 항상 지운다
 * (2026-09-08 사용자 확인).
 *
 * 템플릿 하단의 감리실적표(연월/사업명/주관기관/공공민간/담당분야/역할/참여단계)는
 * personnel_audit_history 전체를 최신순으로 채운다 — 개수가 템플릿 기본 용량(344줄)보다
 * 적으면 남는 빈 행을 지우고, 많으면(2026-09-08 실측 — 621건인 사람도 있음) 그만큼 행을
 * 늘려서 다 채운다. 마감 문구("...위와 같이 확인합니다...") 병합 블록은 항상 실제로 채운
 * 마지막 행 바로 다음으로 옮긴다(2026-09-08 사용자 확인 — src/lib/xlsx-audit-history.ts).
 * 감리원증 발급일자/자격증 취득일자는 이번 기능 범위에 포함하지 않고 템플릿 그대로 둔다.
 *
 * NAS 조회나 이미지/입사일 매칭에 실패해도(파일이 없거나 못 찾는 등) 그 항목만 건너뛰고
 * 나머지 인원은 정상 생성한다 — 다른 첨부 기능들과 같은 원칙.
 */
import JSZip from 'jszip'
import { query } from '../db/client.js'
import { loadSharedStrings } from './xlsx-parse.js'
import { applyXlsxPlaceholderMap, findPlaceholderStyleIndices, clearColumnData } from './xlsx-runtext.js'
import { buildBlackFontStylePatch } from './xlsx-style-patch.js'
import { fillAuditHistoryTable, patchFooterCertificationDate, type AuditHistoryRow } from './xlsx-audit-history.js'
import { cloneSheetPerPerson, sanitizeSheetName } from './xlsx-sheet-clone.js'
import { findXlsxPicRefs, replaceXlsxCertImage } from './xlsx-cert-image-swap.js'
import { findCertImages, type AuditorGrade, type CertType } from './pptx-cert-lookup.js'
import {
  fetchAuditorCareerRequestTemplateXlsx,
  fetchAuditorCertificatePptxs,
  fetchEmploymentCertificateSourceXlsx,
} from './nas-client.js'
import { loadEmployeeDirectory, type EmployeeRecord } from './xlsx-employee-lookup.js'

interface PersonnelRow {
  id: number
  name: string
  auditor_grade: string | null
  auditor_cert_no: string | null
}

interface Person {
  id: number
  name: string
  grade: AuditorGrade
  certNo: string
  certType: CertType
  certName: string
  hireDate: string | null
}

/** 이 5개 자리(값이 채워질 수 있는 모든 자리) — 스타일 검은색 패치 대상을 미리 스캔할 때 씀. */
const ALL_PLACEHOLDER_KEYS = ['[이름]', '[감리원등급]', '[감리원증 발급번호]', '[자격명]', '[입사일]']

export interface AuditorCareerRequestResult {
  zip: JSZip
  personCount: number
  /** 체크했지만 personnel 테이블에서 못 찾은 id 목록 */
  skippedNotFound: string[]
  /** NAS에 "자격증(이름).pptx"가 없어서 그림을 하나도 못 채운 사람 */
  skippedNoCertPptx: string[]
  /** pptx는 찾았지만 등급 이미지를 못 찾은 사람 */
  skippedNoGradeImage: string[]
  /** pptx는 찾았지만 자격명 이미지를 못 찾은 사람 */
  skippedNoCertImage: string[]
  /** 재직증명서발행파일 직원정보에 없거나 퇴직 처리돼있어 [입사일]을 못 채운 사람 */
  skippedNoHireDate: string[]
}

/** [자격명] 값과, 그 값이 기술사/감리사/정보처리기사 중 무엇이었는지를 함께 반환한다
 *  (자격명 이미지를 찾을 때 재사용). 우선순위: 수석감리원일 때만 기술사 > 감리사를 보고,
 *  그 외에는(자격증이 둘 다 없거나 수석감리원이 아니면) 정보처리기사. */
function pickCertName(certNames: string[], grade: AuditorGrade): { certType: CertType; certName: string } {
  if (grade === '수석감리원') {
    const gisul = certNames.find(n => n.includes('기술사'))
    if (gisul) return { certType: '기술사', certName: gisul }
    const gamri = certNames.find(n => n.includes('감리사'))
    if (gamri) return { certType: '감리사', certName: '정보시스템감리사' }
  }
  return { certType: '정보처리기사', certName: '정보처리기사' }
}

export async function buildAuditorCareerRequestXlsx(personnelIds: number[]): Promise<AuditorCareerRequestResult> {
  if (!personnelIds.length) throw new Error('선택된 인력이 없습니다')

  const [templateBuf, personnelRows, certRows, auditHistoryRows, employeeXlsxBuf] = await Promise.all([
    fetchAuditorCareerRequestTemplateXlsx(),
    query<PersonnelRow>(`SELECT id, name, auditor_grade, auditor_cert_no FROM personnel WHERE id = ANY($1)`, [personnelIds]),
    query<{ personnel_id: number; cert_name: string }>(
      `SELECT personnel_id, cert_name FROM personnel_certifications WHERE personnel_id = ANY($1)`,
      [personnelIds]
    ),
    // 인력 상세 페이지(감리 실적 목록)와 같은 정렬 — 최신순(연월 내림차순).
    query<{
      personnel_id: number
      audit_yearmonth: string
      project_name: string
      client_org: string | null
      sector: string | null
      domain: string | null
      role: string | null
      phase: string | null
    }>(
      `SELECT personnel_id, audit_yearmonth, project_name, client_org, sector, domain, role, phase
       FROM personnel_audit_history WHERE personnel_id = ANY($1) ORDER BY personnel_id, audit_yearmonth DESC`,
      [personnelIds]
    ),
    fetchEmploymentCertificateSourceXlsx(),
  ])
  if (!templateBuf) throw new Error('NAS에서 감리원 경력 확인서 발급요청 템플릿을 가져오지 못했습니다')

  const auditHistoryByPersonnelId = new Map<number, AuditHistoryRow[]>()
  for (const h of auditHistoryRows) {
    const list = auditHistoryByPersonnelId.get(h.personnel_id) ?? []
    list.push({
      auditYearmonth: h.audit_yearmonth ?? '',
      projectName: h.project_name ?? '',
      clientOrg: h.client_org ?? '',
      sector: h.sector ?? '',
      domain: h.domain ?? '',
      role: h.role ?? '',
      phase: h.phase ?? '',
    })
    auditHistoryByPersonnelId.set(h.personnel_id, list)
  }

  const employeeDirectory: Map<string, EmployeeRecord> = employeeXlsxBuf
    ? await loadEmployeeDirectory(employeeXlsxBuf)
    : new Map()

  const personnelById = new Map(personnelRows.map(p => [p.id, p]))
  const certsByPersonnelId = new Map<number, string[]>()
  for (const c of certRows) {
    const list = certsByPersonnelId.get(c.personnel_id) ?? []
    list.push(c.cert_name)
    certsByPersonnelId.set(c.personnel_id, list)
  }

  const skippedNotFound: string[] = []
  const skippedNoHireDate: string[] = []
  const people: Person[] = []
  for (const id of personnelIds) {
    const row = personnelById.get(id)
    if (!row) {
      skippedNotFound.push(String(id))
      continue
    }
    const grade: AuditorGrade = row.auditor_grade === '수석감리원' ? '수석감리원' : '감리원'
    const { certType, certName } = pickCertName(certsByPersonnelId.get(id) ?? [], grade)

    const empRecord = employeeDirectory.get(row.name)
    const hireDate = empRecord && !empRecord.resigned ? empRecord.hireDateRaw || null : null
    if (!hireDate) skippedNoHireDate.push(row.name)

    people.push({ id, name: row.name, grade, certNo: row.auditor_cert_no ?? '', certType, certName, hireDate })
  }
  if (!people.length) throw new Error('선택된 인력을 personnel 테이블에서 찾지 못했습니다')

  const certPptxMap = await fetchAuditorCertificatePptxs(people.map(p => p.name))

  const zip = await JSZip.loadAsync(templateBuf)
  const sharedStringsXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const sharedStrings = loadSharedStrings(sharedStringsXml)

  // 마감 문구의 날짜를 오늘 날짜로 — 인원과 무관한 공용 문자열이라 한 번만 패치하면 모든
  // 시트에 반영된다(2026-09-08 사용자 확인).
  const patchedSharedStringsXml = patchFooterCertificationDate(sharedStringsXml)
  if (patchedSharedStringsXml !== sharedStringsXml) zip.file('xl/sharedStrings.xml', patchedSharedStringsXml)

  // 치환에 성공한 셀만 검은 글씨로 — 템플릿 원본(복제 전)에서 플레이스홀더 셀들의 스타일을
  // 미리 스캔해 "폰트만 검은색인 사본" 스타일을 styles.xml에 한 번만 추가한다.
  const templateSheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  const placeholderStyleIndices = findPlaceholderStyleIndices(templateSheetXml, sharedStrings, ALL_PLACEHOLDER_KEYS)
  const stylesXml = await zip.file('xl/styles.xml')!.async('string')
  const { styleMap, patchedStylesXml } = buildBlackFontStylePatch(stylesXml, placeholderStyleIndices)
  if (patchedStylesXml !== stylesXml) zip.file('xl/styles.xml', patchedStylesXml)

  const usedSheetNames = new Set<string>()
  const sheetNames = people.map(p => sanitizeSheetName(p.name, usedSheetNames))

  const clonedSheets = await cloneSheetPerPerson(zip, sheetNames, (templateXml, i) => {
    const person = people[i]
    const placeholderMap: Record<string, string> = {
      '[이름]': person.name,
      '[감리원등급]': person.grade,
      '[감리원증 발급번호]': person.certNo,
      '[자격명]': person.certName,
    }
    if (person.hireDate) placeholderMap['[입사일]'] = person.hireDate

    let filled = applyXlsxPlaceholderMap(templateXml, sharedStrings, placeholderMap, styleMap)
    filled = clearColumnData(filled, 'K')
    filled = fillAuditHistoryTable(filled, auditHistoryByPersonnelId.get(person.id) ?? [])
    return filled
  })

  const skippedNoCertPptx: string[] = []
  const skippedNoGradeImage: string[] = []
  const skippedNoCertImage: string[] = []

  for (let i = 0; i < people.length; i++) {
    const person = people[i]
    const sheet = clonedSheets[i]
    const pptxBuf = certPptxMap.get(person.name)
    if (!pptxBuf) {
      skippedNoCertPptx.push(person.name)
      continue
    }

    const { gradeImage, certImage } = await findCertImages(pptxBuf, person.grade, person.certType)
    if (!gradeImage) skippedNoGradeImage.push(person.name)
    if (!certImage) skippedNoCertImage.push(person.name)
    if (!gradeImage && !certImage) continue

    let drawingXml = await zip.file(sheet.drawingPath)!.async('string')
    let relsXml = await zip.file(sheet.drawingRelsPath)!.async('string')
    // [0] = "사과" 스톡사진(감리원등급 자리), [1] = pxhere 스톡사진(자격명 자리) —
    // xlsx-cert-image-swap.ts 상단 설명 참고.
    const picRefs = findXlsxPicRefs(drawingXml, relsXml)

    if (gradeImage && picRefs[0]) {
      const r = replaceXlsxCertImage(zip, drawingXml, relsXml, picRefs[0], gradeImage, `grade_${sheet.index}.png`)
      drawingXml = r.drawingXml
      relsXml = r.relsXml
    }
    if (certImage && picRefs[1]) {
      const r = replaceXlsxCertImage(zip, drawingXml, relsXml, picRefs[1], certImage, `cert_${sheet.index}.png`)
      drawingXml = r.drawingXml
      relsXml = r.relsXml
    }

    zip.file(sheet.drawingPath, drawingXml)
    zip.file(sheet.drawingRelsPath, relsXml)
  }

  return {
    zip,
    personCount: people.length,
    skippedNotFound,
    skippedNoCertPptx,
    skippedNoGradeImage,
    skippedNoCertImage,
    skippedNoHireDate,
  }
}
