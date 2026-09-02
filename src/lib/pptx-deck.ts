/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * 템플릿의 슬라이드(1장 또는 여러 장을 "1세트"로 취급)를 데이터 청크 개수만큼 복제해서
 * 새 pptx 덱을 만드는 엔진. proposal-portal-stg2 의 buildHistoryPptx() 안 슬라이드 복제
 * 로직을 서버(Node)용으로 그대로 포팅한 것이며, 템플릿이 슬라이드 여러 장(예: 1/2, 2/2
 * 두 장 한 세트)으로 이뤄진 경우도 지원하도록 확장했습니다 — 청크 1개마다 템플릿 슬라이드
 * 수만큼(예: 2장) 그대로 복제해서 순서대로 이어붙입니다.
 *
 * presentation.xml / presentation.xml.rels / [Content_Types].xml / 슬라이드별 .rels 의
 * rId·slideId를 전부 재계산해서 새로 만들어야 pptx가 안 깨집니다.
 */
import type JSZip from 'jszip'

interface TemplateSlide {
  xml: string
  relEntries: { id: string; type: string; target: string }[]
}

const DEFAULT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '</Relationships>'

/**
 * @param zip           템플릿을 로드한 JSZip 인스턴스 (in-place로 수정됨)
 * @param fillSlideXml  (템플릿 슬라이드 XML, 청크 데이터, 그 청크 안에서 몇 번째 템플릿
 *                      슬라이드인지(0부터)) => 치환된 슬라이드 XML
 * @param chunks        청크 배열 — 청크 1개당 "템플릿 슬라이드 수"만큼 출력 슬라이드가 생김
 *                      (템플릿이 1장이면 청크당 1장, 2장(1/2+2/2)이면 청크당 2장)
 */
export async function buildMultiSlideDeck<T>(
  zip: JSZip,
  fillSlideXml: (templateSlideXml: string, chunk: T, templateIndex: number) => string,
  chunks: T[]
): Promise<void> {
  const allSlideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)![1])
      const nb = Number(b.match(/slide(\d+)/)![1])
      return na - nb
    })

  if (!allSlideFiles.length) throw new Error('템플릿에 슬라이드가 없습니다.')

  // 모든 템플릿 슬라이드의 XML과 .rels를 먼저 읽어둔다.
  // ⚠️ 반드시 아래의 "기존 슬라이드 파일 삭제" 루프보다 먼저 읽어야 합니다 — 그 루프가
  // slideN.xml.rels 파일 자체를 지워버리기 때문에, 삭제 후에 읽으면 항상 실패해서
  // 이미지 관계(도장 이미지 등)가 통째로 사라지는 버그가 있었습니다.
  const templates: TemplateSlide[] = []
  for (const tplSlideFile of allSlideFiles) {
    const xml = await zip.file(tplSlideFile)!.async('string')
    const tplRelsFile = tplSlideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const tplRelsXmlFile = zip.file(tplRelsFile)
    const tplRelsXml = tplRelsXmlFile ? await tplRelsXmlFile.async('string') : DEFAULT_RELS_XML
    const relEntries: { id: string; type: string; target: string }[] = []
    tplRelsXml.replace(
      /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"[^/]*\/>/g,
      (_m, id, type, target) => {
        relEntries.push({ id, type, target })
        return _m
      }
    )
    templates.push({ xml, relEntries })
  }

  let presXml = await zip.file('ppt/presentation.xml')!.async('string')
  let presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  let ctXml = await zip.file('[Content_Types].xml')!.async('string')

  // 기존 슬라이드 관계 모두 제거
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst></p:sldIdLst>')
  presRelsXml = presRelsXml.replace(/<Relationship\b[^/]*Type="[^"]*\/slide"[^/]*\/>/g, '')
  ctXml = ctXml.replace(/<Override[^>]*presentationml\.slide\+xml[^>]*\/>/g, '')

  // 기존 슬라이드 파일 삭제 (이 시점 이후로는 템플릿 .rels를 다시 읽을 수 없음)
  for (const sf of allSlideFiles) {
    zip.remove(sf)
    const rf = sf.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    if (zip.file(rf)) zip.remove(rf)
  }

  let maxRid = 0
  presRelsXml.replace(/Id="rId(\d+)"/g, (_m, n) => {
    maxRid = Math.max(maxRid, Number(n))
    return _m
  })
  let maxSldId = 255
  presXml.replace(/<p:sldId\b[^>]*\bid="(\d+)"/g, (_m, n) => {
    maxSldId = Math.max(maxSldId, Number(n))
    return _m
  })

  function buildSlideRels(offset: number, relEntries: { id: string; type: string; target: string }[]) {
    const rIdMap: Record<string, string> = {}
    let localMax = offset
    const relTags = relEntries.map(e => {
      const newId = `rId${++localMax}`
      rIdMap[e.id] = newId
      return `<Relationship Id="${newId}" Type="${e.type}" Target="${e.target}"/>`
    })
    const relsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relTags.join('') +
      '</Relationships>'
    return { relsXml, rIdMap, nextMax: localMax }
  }

  function remapRids(slideXml: string, rIdMap: Record<string, string>) {
    return slideXml.replace(/\br:(embed|link|id)="(rId\d+)"/g, (full, attr, oldId) => {
      return rIdMap[oldId] ? `r:${attr}="${rIdMap[oldId]}"` : full
    })
  }

  let newRels = ''
  let newSldIds = ''
  let newCt = ''

  chunks.forEach((chunk, ci) => {
    templates.forEach((tpl, ti) => {
      const slideNum = ci * templates.length + ti + 1
      const fileName = `ppt/slides/slide${slideNum}.xml`
      const relFileName = `ppt/slides/_rels/slide${slideNum}.xml.rels`

      const { relsXml, rIdMap, nextMax } = buildSlideRels(maxRid, tpl.relEntries)
      maxRid = nextMax

      const sldRid = ++maxRid
      const sldId = ++maxSldId

      let slideXml = fillSlideXml(tpl.xml, chunk, ti)
      slideXml = remapRids(slideXml, rIdMap)

      zip.file(fileName, slideXml)
      zip.file(relFileName, relsXml)

      newRels += `<Relationship Id="rId${sldRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
      newSldIds += `<p:sldId id="${sldId}" r:id="rId${sldRid}"/>`
      newCt += `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    })
  })

  presXml = presXml.replace('<p:sldIdLst></p:sldIdLst>', `<p:sldIdLst>${newSldIds}</p:sldIdLst>`)
  presRelsXml = presRelsXml.replace('</Relationships>', newRels + '</Relationships>')
  ctXml = ctXml.replace('</Types>', newCt + '</Types>')

  zip.file('ppt/presentation.xml', presXml)
  zip.file('ppt/_rels/presentation.xml.rels', presRelsXml)
  zip.file('[Content_Types].xml', ctXml)
}
