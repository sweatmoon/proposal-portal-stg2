/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * 여러 개의 완성된 pptx(JSZip)를 한 파일로 이어붙이는 엔진.
 *
 * 전제: 합칠 덱들이 전부 "같은 마스터/레이아웃/테마"를 쓴다(우리 첨부 템플릿들 — 표지/
 * 1.일정표/2.실적경력/3.동의서 — 는 전부 같은 정성제안서 마스터에서 나온 파일이라 실제로
 * theme1.xml·slideMaster1.xml이 바이트 단위로 동일함, 2026-09-01 확인). 그래서 첫 번째
 * 덱(표지)의 마스터/레이아웃/테마/프레젠테이션 골격만 남기고, 그 뒤 덱들의 "슬라이드
 * 본문"만 순서대로 뽑아 이어붙이면 된다 — 각 슬라이드의 슬라이드-레이아웃 상대경로
 * (예: "../slideLayouts/slideLayout2.xml")는 어느 덱에서 왔든 동일해서, 그대로 둬도
 * base 안의 같은 파일을 정확히 가리킨다.
 *
 * 마스터가 서로 다른 덱을 합쳐야 하는 경우는 지원하지 않는다(그 경우 레이아웃까지
 * 전부 복사하고 이름 충돌을 피해야 해서 훨씬 복잡함 — 지금은 필요하지 않아 구현 안 함).
 *
 * ⚠️ media 파일 처리 (2026-09-02 버그 수정): base(표지) 이외의 덱이 자기 슬라이드에만 쓰는
 * 고유 이미지(예: 동의서의 인력별 개인도장 — NAS에서 받아온 사람마다 다른 파일)를 가지고
 * 있으면, 그 media 파일도 반드시 base로 복사해야 합니다. 예전에는 슬라이드 XML/rels만
 * 옮기고 media 파일 자체는 안 옮겨서, 병합 후 그 이미지 참조만 남고 실제 파일은 빠져
 * "그림을 표시할 수 없습니다" 깨진 이미지가 되는 버그가 있었습니다. base 자신의 media는
 * 마스터/레이아웃이 그 파일명을 그대로 참조하므로 이름을 바꾸지 않고 그대로 두고, 그 외
 * 덱들의 media만 이름 충돌 없이 새 이름을 붙여 복사한 뒤 그 덱의 슬라이드 rels에서
 * Target을 새 이름으로 바꿔줍니다.
 */
import type JSZip from 'jszip'

const DEFAULT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
  '</Relationships>'

/**
 * @param zips  이어붙일 순서대로 나열한 JSZip 목록(각각 buildXxxZip()이 만든, 이미 완성된
 *              덱). 첫 번째 zip이 "base"가 되어 마스터/레이아웃/테마/프레젠테이션 골격을
 *              제공하고, in-place로 수정돼서 반환된다.
 */
export async function mergeDecksSharingMaster(zips: JSZip[]): Promise<JSZip> {
  if (zips.length === 0) throw new Error('합칠 PPT가 없습니다')
  const base = zips[0]
  if (zips.length === 1) return base

  let presXml = await base.file('ppt/presentation.xml')!.async('string')
  let presRelsXml = await base.file('ppt/_rels/presentation.xml.rels')!.async('string')
  let ctXml = await base.file('[Content_Types].xml')!.async('string')

  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst></p:sldIdLst>')
  presRelsXml = presRelsXml.replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, '')
  ctXml = ctXml.replace(/<Override[^>]*presentationml\.slide\+xml[^>]*\/>/g, '')

  // base(index 0) 이외 덱들의 고유 media를 파일명 충돌 없이 base로 복사하고, 그 덱의
  // 슬라이드 rels에서 참조할 새 이름을 기억해둔다. base 자신의 media는 이름을 바꾸지
  // 않는다(마스터/레이아웃이 원래 이름을 그대로 참조하기 때문).
  let mediaCounter = 0
  const mediaRenameMaps: Map<string, string>[] = [] // zips와 같은 인덱스, key: 원래 파일명(예: "stamp_p1.png") → 새 파일명
  for (let zi = 0; zi < zips.length; zi++) {
    const renameMap = new Map<string, string>()
    mediaRenameMaps.push(renameMap)
    if (zi === 0) continue

    // Object.keys(zip.files)에는 "ppt/media/" 같은 디렉터리 엔트리도 섞여 나오는데,
    // 그건 zip.file(path)로 열면 null이라 반드시 걸러야 한다(디렉터리 엔트리에 .dir===true).
    const mediaFiles = Object.keys(zips[zi].files).filter(
      f => /^ppt\/media\//.test(f) && !zips[zi].files[f].dir
    )
    for (const mf of mediaFiles) {
      const originalName = mf.replace('ppt/media/', '')
      const dot = originalName.lastIndexOf('.')
      const ext = dot >= 0 ? originalName.slice(dot) : ''
      const newName = `merged_${++mediaCounter}${ext}`
      const content = await zips[zi].file(mf)!.async('nodebuffer')
      base.file(`ppt/media/${newName}`, content)
      renameMap.set(originalName, newName)
    }
  }

  // base(=zips[0])의 원본 슬라이드 내용을 먼저 전부 메모리에 읽어둔다 — base의 슬라이드 파일을
  // 지우기 전에 읽어야 한다. base도 아래 zips 순회 대상에 포함되므로(표지 자신의 슬라이드도
  // 다시 붙여야 함), 먼저 지우고 나서 base.files를 읽으면 표지 내용이 통째로 사라진다.
  const allSlideEntries: { xml: string; relXml: string | null; mediaRenameMap: Map<string, string> }[] = []
  for (let zi = 0; zi < zips.length; zi++) {
    const zip = zips[zi]
    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))
    for (const sf of slideFiles) {
      const xml = await zip.file(sf)!.async('string')
      const relFile = sf.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
      const relXmlFile = zip.file(relFile)
      const relXml = relXmlFile ? await relXmlFile.async('string') : null
      allSlideEntries.push({ xml, relXml, mediaRenameMap: mediaRenameMaps[zi] })
    }
  }

  const baseSlideFiles = Object.keys(base.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
  for (const sf of baseSlideFiles) {
    base.remove(sf)
    const rf = sf.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    if (base.file(rf)) base.remove(rf)
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

  let newRels = ''
  let newSldIds = ''
  let newCt = ''
  let slideNum = 0

  for (const entry of allSlideEntries) {
    slideNum++
    const xml = entry.xml
    const relXml = entry.relXml ?? DEFAULT_RELS_XML
    const relEntries: { id: string; type: string; target: string }[] = []
    relXml.replace(
      /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"[^/]*\/>/g,
      (_m, id, type, target) => {
        relEntries.push({ id, type, target })
        return _m
      }
    )

    const rIdMap: Record<string, string> = {}
    const relTags = relEntries.map(e => {
      const newId = `rId${++maxRid}`
      rIdMap[e.id] = newId
      // 이 덱만의 media를 새 이름으로 복사해뒀다면, Target도 그 새 이름을 가리키게 바꾼다.
      let target = e.target
      const mediaMatch = target.match(/^\.\.\/media\/(.+)$/)
      if (mediaMatch && entry.mediaRenameMap.has(mediaMatch[1])) {
        target = `../media/${entry.mediaRenameMap.get(mediaMatch[1])}`
      }
      return `<Relationship Id="${newId}" Type="${e.type}" Target="${target}"/>`
    })
    const newRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relTags.join('') +
      '</Relationships>'

    const newSlideXml = xml.replace(/\br:(embed|link|id)="(rId\d+)"/g, (full, attr, oldId) =>
      rIdMap[oldId] ? `r:${attr}="${rIdMap[oldId]}"` : full
    )

    const fileName = `ppt/slides/slide${slideNum}.xml`
    const newRelFileName = `ppt/slides/_rels/slide${slideNum}.xml.rels`
    base.file(fileName, newSlideXml)
    base.file(newRelFileName, newRelsXml)

    const sldRid = ++maxRid
    const sldId = ++maxSldId
    newRels += `<Relationship Id="rId${sldRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
    newSldIds += `<p:sldId id="${sldId}" r:id="rId${sldRid}"/>`
    newCt += `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  }

  presXml = presXml.replace('<p:sldIdLst></p:sldIdLst>', `<p:sldIdLst>${newSldIds}</p:sldIdLst>`)
  presRelsXml = presRelsXml.replace('</Relationships>', newRels + '</Relationships>')
  ctXml = ctXml.replace('</Types>', newCt + '</Types>')

  base.file('ppt/presentation.xml', presXml)
  base.file('ppt/_rels/presentation.xml.rels', presRelsXml)
  base.file('[Content_Types].xml', ctXml)

  return base
}
