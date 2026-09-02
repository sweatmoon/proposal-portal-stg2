/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트의 공용 유틸] 이 파일이 속한 전체 세트 설명은
 * src/routes/ppt-attachment-bundle.ts 상단 주석 참고. (새로 추가된 파일 — 기존 파일 수정 없음)
 *
 * "0. 정성제안서 첨부 표지" 템플릿의 번호 매긴 목차 리스트("1. OOO", "2. OOO", ...)를
 * 실제 선택된 첨부 항목 목록으로 다시 만든다.
 *
 * 템플릿 안에서 이 목차 텍스트 상자를 찾는 방법: 텍스트 상자의 첫 번째 문단이
 * "숫자. " 로 시작하는 걸 찾는다(예: "1. 감리원 일정 현황표") — 고정된 라벨 문자열에
 * 의존하지 않아서, 나중에 표지 문구가 바뀌어도 그대로 동작한다.
 *
 * 각 줄(문단)은 서식(줄간격 등)은 그대로 유지하고, 텍스트만 그 문단의 첫 번째 런의
 * 서식으로 통일해서 다시 쓴다(원본이 문단 하나를 여러 런으로 쪼개놓은 경우가 있어서 —
 * 예: "3. 비상근 전문인력 "+"참여"+" "+"동의서" — 이 경우도 첫 런 서식으로 합쳐서 한 런으로
 * 만든다. 시각적으로는 폰트가 전부 같아서 차이가 없다).
 */
function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function extractText(xml: string): string {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => m[1]).join('')
}

function replaceParaWithSingleRun(paraXml: string, newText: string): string {
  const runs = paraXml.match(/<a:r>[\s\S]*?<\/a:r>/g)
  if (!runs || runs.length === 0) return paraXml
  const firstRun = runs[0]
  const rPrMatch = firstRun.match(/<a:rPr[\s\S]*?<\/a:rPr>|<a:rPr[^/]*\/>/)
  const rPr = rPrMatch ? rPrMatch[0] : ''
  const newRun = `<a:r>${rPr}<a:t>${esc(newText)}</a:t></a:r>`
  return paraXml.replace(runs.join(''), newRun)
}

/**
 * slideXml 안에서 번호 매긴 목차 텍스트 상자를 찾아 labels로 다시 만든다.
 * 못 찾으면 null (이 슬라이드는 표지가 아니라는 뜻이므로 호출 쪽에서 그대로 두면 됨).
 */
export function rebuildCoverToc(slideXml: string, labels: string[]): string | null {
  const spMatches = [...slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
  for (const spMatch of spMatches) {
    const sp = spMatch[0]
    const paras = sp.match(/<a:p>[\s\S]*?<\/a:p>/g)
    if (!paras || paras.length === 0) continue
    if (!/^\d+\.\s*\S/.test(extractText(paras[0]))) continue

    const template = paras[0]
    const newParasXml = labels.map((label, i) => replaceParaWithSingleRun(template, `${i + 1}. ${label}`)).join('')
    const newSp = sp.replace(paras.join(''), newParasXml)
    return slideXml.replace(sp, newSp)
  }
  return null
}
