/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 재직증명서 발행용 엑셀
 * (00.재직증명서발행파일v4.xlsm)의 "직원정보" 시트를 파싱해서 이름으로 직원 정보를 찾는다.
 * 엑셀 파일도 결국 XML을 zip으로 묶은 것이라, Excel 프로그램이나 그 안의 매크로를 전혀
 * 실행하지 않고 zip 안의 XML만 읽어서 값을 뽑아낸다(2026-09-04 사용자 확인 — "엑셀의 값만
 * 찾아서 웹상에서 처리").
 *
 * "직원정보" 시트의 A~L열 구성(2026-09-04 실측):
 *   A=이름  B=구분  C=주민번호(생년월일 6자리)  D=전화번호  E=성별  F=입사일(YYYY.MM.DD)
 *   G=직위  H=주소  I=퇴직여부("퇴직"이면 표시)  J=(내부용, 안 씀)  K=근무부서  L=퇴직일자
 *
 * 원본 엑셀의 각 증명서 시트가 VLOOKUP + MID로 만들던 표시용 문자열(생년월일 "1979년
 * 02월 20일", 입사일 "2021년 01월 18일" 등)도 이 파일에서 그대로 재현한다.
 */
import JSZip from 'jszip'

export interface EmployeeRecord {
  name: string
  category: string
  residentNumberPrefix: string
  hireDateRaw: string
  position: string
  department: string
  resigned: boolean
}

function loadSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
}

/** 시트 이름(예: "직원정보")으로 실제 ppt/xl 파트 경로(xl/worksheets/sheetN.xml)를 찾는다 —
 *  엑셀이 저장될 때마다 시트 순서/번호가 바뀔 수 있어 이름으로 매번 다시 찾아야 한다. */
async function findSheetPathByName(zip: JSZip, sheetName: string): Promise<string | null> {
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!workbookXml) return null
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sheetMatch = workbookXml.match(new RegExp(`<sheet[^>]*name="${escaped}"[^>]*r:id="(rId\\d+)"`))
  if (!sheetMatch) return null
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!relsXml) return null
  const relMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`))
  if (!relMatch) return null
  return 'xl/' + relMatch[1]
}

/** 한 <row>...</row> 안의 셀들을 "열 문자(A,B,C...) → 값" 맵으로 만든다. */
function parseRowCells(rowXml: string, sharedStrings: string[]): Map<string, string> {
  const map = new Map<string, string>()
  const cellRe = /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  for (const m of rowXml.matchAll(cellRe)) {
    const attrs = m[1]
    const inner = m[2] ?? ''
    const refMatch = attrs.match(/r="([A-Z]+)\d+"/)
    if (!refMatch) continue
    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
    if (!vMatch) continue
    const typeMatch = attrs.match(/t="(\w+)"/)
    let value = vMatch[1]
    if (typeMatch && typeMatch[1] === 's') value = sharedStrings[Number(value)] ?? ''
    map.set(refMatch[1], value)
  }
  return map
}

/** 엑셀 buffer를 받아 "직원정보" 시트를 이름 → EmployeeRecord 맵으로 파싱한다. */
export async function loadEmployeeDirectory(xlsxBuf: Buffer): Promise<Map<string, EmployeeRecord>> {
  const zip = await JSZip.loadAsync(xlsxBuf)
  const sheetPath = await findSheetPathByName(zip, '직원정보')
  if (!sheetPath) throw new Error('재직증명서 발행파일에서 "직원정보" 시트를 찾지 못했습니다')

  const [sheetXml, sharedStringsXml] = await Promise.all([
    zip.file(sheetPath)!.async('string'),
    zip.file('xl/sharedStrings.xml')?.async('string') ?? Promise.resolve(''),
  ])
  const sharedStrings = sharedStringsXml ? loadSharedStrings(sharedStringsXml) : []

  const result = new Map<string, EmployeeRecord>()
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = parseRowCells(rowMatch[1], sharedStrings)
    const name = cells.get('A')
    if (!name || name === '외부인력이름') continue // 헤더 행 스킵
    result.set(name, {
      name,
      category: cells.get('B') ?? '',
      residentNumberPrefix: cells.get('C') ?? '',
      hireDateRaw: cells.get('F') ?? '',
      position: cells.get('G') ?? '',
      department: cells.get('K') ?? '',
      resigned: (cells.get('I') ?? '') === '퇴직',
    })
  }
  return result
}

/** 주민번호 앞 6자리(YYMMDD)를 "1979년 02월 20일" 형식으로. 원본 엑셀의
 *  IF(MID(...,1,1)="0","20"&...,"19"&...) 규칙 그대로 — 앞자리가 "0"이면 2000년대,
 *  아니면 1900년대로 판단한다. 형식이 아니면 빈 문자열. */
export function formatBirthdate(residentNumberPrefix: string): string {
  if (!/^\d{6}$/.test(residentNumberPrefix)) return ''
  const century = residentNumberPrefix[0] === '0' ? '20' : '19'
  const yy = residentNumberPrefix.slice(0, 2)
  const mm = residentNumberPrefix.slice(2, 4)
  const dd = residentNumberPrefix.slice(4, 6)
  return `${century}${yy}년 ${mm}월 ${dd}일`
}

/** "YYYY.MM.DD" 형식의 입사일을 "YYYY년 MM월 DD일"로. 원본 엑셀의
 *  MID(입사일,1,4)&"년 "&MID(입사일,6,2)&"월 "&MID(입사일,9,2)&"일" 그대로. */
export function formatDateKorean(dateRaw: string): string {
  const m = dateRaw.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/)
  if (!m) return dateRaw
  const [, y, mo, d] = m
  return `${y}년 ${mo.padStart(2, '0')}월 ${d.padStart(2, '0')}일`
}

/** "YYYY.MM.DD" 형식의 입사일을 재직증명서의 [입사일자] 자리에 쓰는 형식("YYYY.MM.DD.")으로 —
 *  원본 엑셀이 뒤에 마침표를 붙여 쓰던 것 그대로. */
export function formatHireDateWithDot(dateRaw: string): string {
  return dateRaw ? `${dateRaw}.` : ''
}

/** "YYYY-MM-DD" 형식의 사업 입찰마감일에서 하루를 뺀 날짜를 "YYYY년 MM월 DD일"로.
 *  [제출마감하루전] 자리에 쓴다(2026-09-04 사용자 확인 — 입찰마감일 하루 전 날짜). */
export function dayBeforeDeadlineKorean(bidDeadline: string): string {
  const d = new Date(bidDeadline + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}년 ${mo}월 ${da}일`
}

/** 증명서에 실제로 인쇄할 이름. 지금은 직원정보의 이름을 그대로 쓴다(예: 동명이인 구분용
 *  "김영범A"도 그대로 "김영범A"라고 나옴 — 2026-09-04 사용자 확인: "이름 표시는 그냥 따로
 *  바꿀게 아무것도 하지 말고 그냥 김영범A로 표시해"). 나중에 접미사를 뗀 진짜 이름으로
 *  바꾸고 싶어지면 이 함수 하나만 고치면 된다(사용자 확인 — "나중에 수정할 수 있도록 할 것"). */
export function formatDisplayName(name: string): string {
  return name
}
