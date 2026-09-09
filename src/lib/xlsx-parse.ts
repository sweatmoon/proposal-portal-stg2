/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 엑셀(.xlsx/.xlsm) 파일을 프로그램
 * 없이 데이터로만 읽어내는 최소한의 파서. 엑셀 파일도 결국 zip으로 묶인 XML이라, 그 XML만
 * 정규식으로 읽어서 값을 뽑아낸다(2026-09-04 — 재직증명서 발행파일 파싱용으로 처음
 * 만들었다가, 상근인력현황 파싱에도 필요해져서 공용 저수준 파서로 분리했다).
 */
import JSZip from 'jszip'

export function loadSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => m[1].replace(/<[^>]+>/g, ''))
}

/** 시트 이름(예: "직원정보")으로 실제 zip 파트 경로(xl/worksheets/sheetN.xml)를 찾는다 —
 *  엑셀이 저장될 때마다 시트 순서/번호가 바뀔 수 있어 이름으로 매번 다시 찾아야 한다. */
export async function findSheetPathByName(zip: JSZip, sheetName: string): Promise<string | null> {
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
export function parseRowCells(rowXml: string, sharedStrings: string[]): Map<string, string> {
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

/** 엑셀 buffer에서 시트 하나를 통째로 "열 문자 → 값" 맵의 배열(행 순서 그대로)로 읽어온다. */
export async function loadSheetRows(xlsxBuf: Buffer, sheetName: string): Promise<Map<string, string>[]> {
  const zip = await JSZip.loadAsync(xlsxBuf)
  const sheetPath = await findSheetPathByName(zip, sheetName)
  if (!sheetPath) throw new Error(`엑셀 파일에서 "${sheetName}" 시트를 찾지 못했습니다`)

  const [sheetXml, sharedStringsXml] = await Promise.all([
    zip.file(sheetPath)!.async('string'),
    zip.file('xl/sharedStrings.xml')?.async('string') ?? Promise.resolve(''),
  ])
  const sharedStrings = sharedStringsXml ? loadSharedStrings(sharedStringsXml) : []

  return [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(m => parseRowCells(m[1], sharedStrings))
}
