/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] 템플릿 시트(인원 1명
 * 분량)를 선택된 인원 수만큼 복제해서 워크북에 시트 탭으로 추가하는 엔진.
 * src/lib/pptx-deck.ts(슬라이드 복제)의 엑셀판 — workbook.xml / workbook.xml.rels /
 * [Content_Types].xml의 시트 관계·번호를 전부 재계산해서 새로 만들어야 엑셀이 깨지지
 * 않는다.
 *
 * 원본 시트(sheet1.xml/drawing1.xml)는 그대로 두지 않고 인원 수만큼 전부 새 번호로
 * 다시 만든다(sheet1.xml → sheet1.xml, sheet2.xml, ... 인원마다 독립된 시트/드로잉 파트를
 * 가져야 그림을 인원별로 다르게 바꿔치기할 수 있다).
 *
 * sharedStrings.xml/styles.xml/theme는 워크북 전체가 공유하는 파트라 건드리지 않는다 —
 * 플레이스홀더 치환은 xlsx-runtext.ts가 시트별 inline string으로 처리하므로 공용 문자열
 * 테이블과 무관하다.
 */
import type JSZip from 'jszip'

export interface ClonedSheet {
  /** 1부터 시작하는 시트 번호(파일명에 씀: sheetN.xml 등) */
  index: number
  drawingPath: string
  drawingRelsPath: string
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 시트 탭 이름을 엑셀 규칙에 맞게 다듬는다: 31자 제한, 금지 문자(\/?*[]:) 제거,
 *  같은 이름이 이미 있으면 "이름(2)"처럼 번호를 붙여 구분한다(동명이인 대비). */
export function sanitizeSheetName(rawName: string, usedNames: Set<string>): string {
  let base = rawName.replace(/[\\/?*[\]:]/g, '').trim() || '이름없음'
  if (base.length > 31) base = base.slice(0, 31)

  let candidate = base
  let suffix = 2
  while (usedNames.has(candidate)) {
    const maxBaseLen = 31 - `(${suffix})`.length
    candidate = `${base.slice(0, maxBaseLen)}(${suffix})`
    suffix++
  }
  usedNames.add(candidate)
  return candidate
}

/**
 * 템플릿(시트 1장짜리 xlsx)을 sheetNames.length 장으로 복제한다. 각 시트의 셀 내용은
 * fillSheetXml(templateSheetXml, index)로 만들고, 그림 자리는 손대지 않은 채(호출 쪽이
 * xlsx-cert-image-swap.ts로 이어서 처리) 반환값의 drawingPath/drawingRelsPath로 알려준다.
 */
export async function cloneSheetPerPerson(
  zip: JSZip,
  sheetNames: string[],
  fillSheetXml: (templateSheetXml: string, index: number) => string
): Promise<ClonedSheet[]> {
  if (!sheetNames.length) throw new Error('생성할 시트가 없습니다')

  // 템플릿 파트를 먼저 전부 읽어둔다(삭제 전에 — pptx-deck.ts와 같은 이유).
  const sheetXmlTemplate = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  const sheetRelsTemplate = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string')
  const drawingXmlTemplate = await zip.file('xl/drawings/drawing1.xml')!.async('string')
  const drawingRelsTemplate = await zip.file('xl/drawings/_rels/drawing1.xml.rels')!.async('string')

  let workbookXml = await zip.file('xl/workbook.xml')!.async('string')
  let workbookRelsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  let ctXml = await zip.file('[Content_Types].xml')!.async('string')

  // 새로 넣는 미디어(자격증 스캔본)는 png라 [Content_Types].xml에 png 확장자 선언이
  // 없으면(템플릿은 jpeg/jpg만 씀) 엑셀이 그림을 못 읽는다.
  if (!/<Default Extension="png"/.test(ctXml)) {
    ctXml = ctXml.replace('<Default Extension="jpeg"', '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg"')
  }

  let maxWbRid = 0
  workbookRelsXml.replace(/Id="rId(\d+)"/g, (_m, n) => {
    maxWbRid = Math.max(maxWbRid, Number(n))
    return _m
  })
  let maxSheetId = 0
  workbookXml.replace(/sheetId="(\d+)"/g, (_m, n) => {
    maxSheetId = Math.max(maxSheetId, Number(n))
    return _m
  })

  // 기존 시트 관계 전부 제거 — sheets 목록/워크북 rels/Content-Types 모두 새로 만든다.
  workbookXml = workbookXml.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets>__SHEETS__</sheets>')
  workbookRelsXml = workbookRelsXml.replace(/<Relationship[^/]*Type="[^"]*\/worksheet"[^/]*\/>/g, '')
  ctXml = ctXml.replace(/<Override[^>]*worksheet\+xml[^>]*\/>/g, '')
  ctXml = ctXml.replace(/<Override[^>]*PartName="\/xl\/drawings\/drawing1\.xml"[^>]*\/>/, '')

  zip.remove('xl/worksheets/sheet1.xml')
  zip.remove('xl/worksheets/_rels/sheet1.xml.rels')
  zip.remove('xl/drawings/drawing1.xml')
  zip.remove('xl/drawings/_rels/drawing1.xml.rels')

  let sheetsTags = ''
  let wbRelsAdd = ''
  let ctAdd = ''
  const results: ClonedSheet[] = []

  sheetNames.forEach((name, i) => {
    const n = i + 1
    const sheetPath = `xl/worksheets/sheet${n}.xml`
    const sheetRelsPath = `xl/worksheets/_rels/sheet${n}.xml.rels`
    const drawingPath = `xl/drawings/drawing${n}.xml`
    const drawingRelsPath = `xl/drawings/_rels/drawing${n}.xml.rels`

    const sheetRid = `rId${++maxWbRid}`
    const sheetIdNum = ++maxSheetId

    const sheetXml = fillSheetXml(sheetXmlTemplate, i)
    zip.file(sheetPath, sheetXml)

    // 시트 rels: printerSettings는 원본 파트를 그대로 공유(내용이 인원과 무관), drawing만
    // 이 시트 전용 번호로 다시 연결한다.
    const theseSheetRels = sheetRelsTemplate.replace('drawings/drawing1.xml', `drawings/drawing${n}.xml`)
    zip.file(sheetRelsPath, theseSheetRels)

    // 그림 자리 치환은 호출 쪽에서 반환된 경로로 이어서 처리 — 여기서는 템플릿 그대로 복제.
    zip.file(drawingPath, drawingXmlTemplate)
    zip.file(drawingRelsPath, drawingRelsTemplate)

    const safeName = escapeXmlAttr(name)
    sheetsTags += `<sheet name="${safeName}" sheetId="${sheetIdNum}" r:id="${sheetRid}"/>`
    wbRelsAdd += `<Relationship Id="${sheetRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`
    ctAdd +=
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`

    results.push({ index: n, drawingPath, drawingRelsPath })
  })

  workbookXml = workbookXml.replace('__SHEETS__', sheetsTags)
  workbookRelsXml = workbookRelsXml.replace('</Relationships>', wbRelsAdd + '</Relationships>')
  ctXml = ctXml.replace('</Types>', ctAdd + '</Types>')

  zip.file('xl/workbook.xml', workbookXml)
  zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml)
  zip.file('[Content_Types].xml', ctXml)

  return results
}
