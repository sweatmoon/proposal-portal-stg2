/**
 * [ppt-portal 추가 기능 — 감리원 경력 확인서 발급요청 엑셀 생성] NAS의 "자격증(이름).pptx"
 * (인력별로 보유한 모든 자격증 스캔 이미지를 캡션과 함께 모아둔, 담당자가 손으로 만든
 * 파일)에서 특정 조건(감리원등급/기술사·감리사·정보처리기사)에 맞는 이미지 한 장을 찾는다.
 *
 * 이 파일들은 표(자격증 개수만큼 열이 있는 표 하나 밑에 이미지들)로 만든 것도 있고,
 * 텍스트박스를 이미지 옆에 따로 놓은 것도 있어(2026-09-08 실측 — 두 형식이 실제로 섞여
 * 있음) 자격증 종류별로 정해진 위치나 구조에 의존할 수 없다.
 *
 * 처음엔 "캡션과 그림 중 가장 가까운 것끼리" 단순 최근접으로 짝지었는데, 실측해보니(2026-
 * 09-08 — 127명 전수 조사) 캡션들은 좌/우 2열로 가지런히 배치돼있는데 그 아래 놓인
 * 그림들의 세로 위치가 열마다, 파일마다 미묘하게 달라서 "다른 열의 가까운 캡션"을 잘못
 * 집거나(캡션 하나가 그림 2개에 중복으로 짝지어짐), 정작 맞는 그림이 하나도 안 집히는
 * 경우(캡션이 고아로 남음)가 자주 있었다. 그래서 먼저 가로 위치(cx)로 열을 나누고(캡션+
 * 그림을 합쳐서 같이 군집화 — 같은 열이면 캡션과 그림의 cx가 거의 비슷하다), 각 열 안에서만
 * 세로 위치(cy) 오름차순으로 정렬해 n번째 캡션↔n번째 그림으로 순서대로 짝짓는다. 이러면
 * 열이 살짝 어긋나 있어도(그림이 캡션보다 항상 좀 더 아래/위에 있어도) 같은 열 안에서의
 * "몇 번째냐"는 안 흔들리므로 훨씬 안정적이다.
 *
 * 한계(2026-09-08 — 사람이 손으로 만든 ~150개 파일 전체에 대한 완전한 정확성은 보장 못함):
 *   - 그룹 도형(<p:grpSp>) 안의 좌표는 그룹 자체의 이동/배율을 반영하지 않는다(실측한 샘플
 *     파일들에는 그룹이 없었음).
 *   - 한 열 안에서 캡션 수와 그림 수가 다르면(표 셀은 있는데 그림이 비어있는 등) 순서대로
 *     짝지을 수 있는 만큼만 짝짓고 나머지는 버린다.
 *   - 캡션을 못 찾거나 위치가 애매하면(같은 슬라이드에 텍스트가 하나도 없는 등) null을
 *     반환하고, 호출 쪽(auditor-career-request-doc.ts)이 그 항목만 건너뛴다 — 이미지를
 *     못 찾았다고 엑셀 생성 전체를 막지 않는다.
 */
import JSZip from 'jszip'

interface Caption {
  text: string
  cx: number
  cy: number
}

interface Pic {
  target: string
  cx: number
  cy: number
}

function center(x: number, y: number, w: number, h: number): { cx: number; cy: number } {
  return { cx: x + w / 2, cy: y + h / 2 }
}

/** <p:graphicFrame> 표 안의 셀 텍스트들을, 표의 전체 위치 + 열 너비/행 높이 누적으로 계산한
 *  각 셀의 중심 좌표와 함께 뽑아낸다. */
function extractTableCaptions(graphicFrameXml: string): Caption[] {
  const offMatch = graphicFrameXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/)
  const extMatch = graphicFrameXml.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)
  if (!offMatch || !extMatch) return []
  const tableX = Number(offMatch[1])
  const tableY = Number(offMatch[2])

  const gridMatch = graphicFrameXml.match(/<a:tblGrid>([\s\S]*?)<\/a:tblGrid>/)
  if (!gridMatch) return []
  const colWidths = [...gridMatch[1].matchAll(/<a:gridCol[^>]*\bw="(\d+)"/g)].map(m => Number(m[1]))
  if (!colWidths.length) return []

  const captions: Caption[] = []
  let cumY = tableY
  for (const trMatch of graphicFrameXml.matchAll(/<a:tr\b[^>]*\bh="(\d+)"[^>]*>([\s\S]*?)<\/a:tr>/g)) {
    const rowH = Number(trMatch[1])
    const rowXml = trMatch[2]
    let cumX = tableX
    let colIdx = 0
    for (const tcMatch of rowXml.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)) {
      const colW = colWidths[colIdx] ?? 0
      const text = [...tcMatch[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
      if (text.trim()) {
        captions.push({ text, cx: cumX + colW / 2, cy: cumY + rowH / 2 })
      }
      cumX += colW
      colIdx++
    }
    cumY += rowH
  }
  return captions
}

/** <p:sp> 텍스트박스 캡션 — 자체 위치(<a:off>/<a:ext>)를 그대로 쓴다. */
function extractTextboxCaptions(xml: string): Caption[] {
  const captions: Caption[] = []
  for (const spMatch of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const block = spMatch[0]
    const offMatch = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/)
    const extMatch = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)
    if (!offMatch || !extMatch) continue
    const text = [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
    if (!text.trim()) continue
    const { cx, cy } = center(Number(offMatch[1]), Number(offMatch[2]), Number(extMatch[1]), Number(extMatch[2]))
    captions.push({ text, cx, cy })
  }
  return captions
}

function extractPics(xml: string, relMap: Map<string, string>): Pic[] {
  const pics: Pic[] = []
  for (const picMatch of xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
    const block = picMatch[0]
    const offMatch = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/)
    const extMatch = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/)
    const embedMatch = block.match(/r:embed="(rId\d+)"/)
    if (!offMatch || !extMatch || !embedMatch) continue
    const target = relMap.get(embedMatch[1])
    if (!target) continue
    const { cx, cy } = center(Number(offMatch[1]), Number(offMatch[2]), Number(extMatch[1]), Number(extMatch[2]))
    pics.push({ target, cx, cy })
  }
  return pics
}

interface CaptionedImage {
  caption: string
  target: string
}

/** 가로 위치(cx)가 이 EMU 값 이내면 "같은 열"로 본다. 실측(2026-09-08)한 여러 파일에서
 *  같은 열 안의 캡션-그림 cx 차이는 최대 6~7만 EMU였고, 서로 다른 열 사이의 간격은 항상
 *  300만 EMU 이상이었다 — 그 사이 어디로 잡아도 안전하되 여유 있게 50만으로 둔다. */
const COLUMN_THRESHOLD_EMU = 500_000

/** 캡션과 그림을 가로 위치(cx) 기준으로 같은 열끼리 묶는다(둘을 합쳐서 같이 군집화해야
 *  "이 캡션 열"과 "이 그림 열"이 같은 그룹으로 잡힌다). */
function groupByColumn(captions: Caption[], pics: Pic[]): { captions: Caption[]; pics: Pic[] }[] {
  type Tagged = { cx: number; kind: 'cap' | 'pic'; capRef?: Caption; picRef?: Pic }
  const tagged: Tagged[] = [
    ...captions.map(c => ({ cx: c.cx, kind: 'cap' as const, capRef: c })),
    ...pics.map(p => ({ cx: p.cx, kind: 'pic' as const, picRef: p })),
  ]
  if (!tagged.length) return []
  tagged.sort((a, b) => a.cx - b.cx)

  const groups: Tagged[][] = [[tagged[0]]]
  for (let i = 1; i < tagged.length; i++) {
    if (tagged[i].cx - tagged[i - 1].cx > COLUMN_THRESHOLD_EMU) groups.push([])
    groups[groups.length - 1].push(tagged[i])
  }

  return groups.map(g => ({
    captions: g.filter(t => t.kind === 'cap').map(t => t.capRef!),
    pics: g.filter(t => t.kind === 'pic').map(t => t.picRef!),
  }))
}

/** pptx 전체(모든 슬라이드)에서 "캡션 텍스트 + 그림"의 쌍 목록을 만든다 — 열(가로 위치)로
 *  먼저 나눈 뒤, 각 열 안에서 세로 위치 순서대로 n번째끼리 짝짓는다(파일 상단 설명 참고). */
async function extractCaptionedImages(zip: JSZip): Promise<CaptionedImage[]> {
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]))

  const result: CaptionedImage[] = []

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)!.async('string')
    const relsFile = slideFile.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels'
    const relsXml = (await zip.file(relsFile)?.async('string')) ?? ''

    const relMap = new Map<string, string>()
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap.set(m[1], m[2])
    }

    // 모든 슬라이드 맨 위에 있는 "투입 감리원 자격 (이름)" 제목은 캡션이 아니다 — 이걸
    // 캡션 후보에 넣어두면 열 안에서 세로 순서 1번을 제목이 차지해버려서, 그 아래 진짜
    // 캡션들이 한 칸씩 밀려 그림과 어긋난다(2026-09-08 실측 — 곽종필/이은옥 등에서 이
    // 제목 때문에 뒤쪽 캡션이 통째로 못 찾아지는 걸 발견).
    const captions: Caption[] = [
      ...extractTextboxCaptions(xml),
      ...[...xml.matchAll(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g)].flatMap(m => extractTableCaptions(m[0])),
    ].filter(c => !c.text.trim().startsWith('투입'))
    if (!captions.length) continue

    const pics = extractPics(xml, relMap)
    if (!pics.length) continue

    for (const column of groupByColumn(captions, pics)) {
      const sortedCaptions = [...column.captions].sort((a, b) => a.cy - b.cy)
      const sortedPics = [...column.pics].sort((a, b) => a.cy - b.cy)
      const n = Math.min(sortedCaptions.length, sortedPics.length)
      for (let i = 0; i < n; i++) {
        result.push({ caption: sortedCaptions[i].text, target: sortedPics[i].target })
      }
    }
  }

  return result
}

async function loadImageByTarget(zip: JSZip, slideRelTarget: string): Promise<Buffer | null> {
  // target은 슬라이드 파트 기준 상대경로("../media/imageN.png") — ppt/media/imageN.png로 변환.
  const mediaPath = 'ppt/' + slideRelTarget.replace(/^(\.\.\/)+/, '')
  const file = zip.file(mediaPath)
  return file ? await file.async('nodebuffer') : null
}

export type AuditorGrade = '수석감리원' | '감리원'
export type CertType = '기술사' | '감리사' | '정보처리기사'

export interface CertImageLookupResult {
  gradeImage: Buffer | null
  certImage: Buffer | null
}

/**
 * 자격증(이름).pptx 안에서 감리원등급 이미지와 자격명 이미지를 각각 찾는다.
 *   - 등급: grade === '수석감리원'이면 캡션에 "수석감리원"이 포함된 것,
 *           grade === '감리원'이면 "감리원"은 포함하되 "수석감리원"은 아닌 것
 *           ("감리원"이 "수석감리원"의 부분 문자열이라 구분이 필요하다). 수석감리원인데도
 *           캡션이 "정보시스템 감리원증"처럼 수석 여부를 안 적어둔 파일도 있어서(2026-09-08
 *           실측), 정확히 매칭되는 게 없으면 "감리원증"/"감리원"이 들어간 아무 캡션이나
 *           대신 쓴다(수석/일반 상관없이 감리원증 이미지는 보통 파일당 하나뿐이라 이 정도
 *           완화는 안전하다).
 *   - 자격명: 캡션에 certType(기술사/감리사/정보처리기사)이 포함된 것.
 * 못 찾으면 해당 자리는 null(호출 쪽에서 원본 템플릿 placeholder를 그대로 두고 건너뛴다).
 */
export async function findCertImages(
  pptxBuf: Buffer,
  grade: AuditorGrade,
  certType: CertType
): Promise<CertImageLookupResult> {
  const zip = await JSZip.loadAsync(pptxBuf)
  const pairs = await extractCaptionedImages(zip)

  const gradeMatch =
    pairs.find(p =>
      grade === '수석감리원' ? p.caption.includes('수석감리원') : p.caption.includes('감리원') && !p.caption.includes('수석감리원')
    ) ?? (grade === '수석감리원' ? pairs.find(p => p.caption.includes('감리원증') || p.caption.includes('감리원')) : undefined)
  const certMatch = pairs.find(p => p.caption.includes(certType))

  const gradeImage = gradeMatch ? await loadImageByTarget(zip, gradeMatch.target) : null
  const certImage = certMatch ? await loadImageByTarget(zip, certMatch.target) : null

  return { gradeImage, certImage }
}
