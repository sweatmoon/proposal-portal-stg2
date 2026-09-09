/**
 * [ppt-portal 추가 기능 — 첨부PPT 생성 세트] "0. 정성제안서 첨부 표지" PPT 생성
 * (이 파일은 새로 추가된 파일이며, 기존 파일을 수정한 곳은 없습니다. 세트 전체 설명/이식
 * 방법은 src/routes/ppt-attachment-bundle.ts 상단 주석 참고.)
 *
 * 첨부 목차 페이지 — 번호 매긴 목차 리스트("1. OOO", "2. OOO", ...)를 실제로 선택된
 * 첨부 항목 라벨로 다시 채운다. 항목 자체는 이 파일에서 정하지 않고 호출 쪽(주로
 * ppt-attachment-bundle.ts)이 넘겨주는 labels 배열 그대로 번호만 새로 매겨서 쓴다.
 *
 * 이 라우트 자체는 UI에 노출되지 않고(사용자 확인: 표지는 항상 자동 포함, 별도 버튼 없음),
 * 첨부 묶음 생성 시 내부적으로 buildCoverZip()을 호출해서 쓴다. 독립 테스트용으로
 * POST 엔드포인트도 같이 둔다.
 *
 * ⚠️ 템플릿 파일은 이 요청 처리 중에만 메모리에 존재하고 저장하지 않습니다 (DB/디스크 저장 없음).
 *
 * POST /api/ppt-cover/:projectId
 *   multipart/form-data: template (.pptx, 1슬라이드), labels: JSON 문자열 배열 (예: '["감리원 일정 현황표","투입 감리원별 실적 및 경력"]')
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { queryOne } from '../db/client.js'
import { applyPlaceholderMap } from '../lib/pptx-runtext.js'
import { rebuildCoverToc } from '../lib/pptx-cover-toc.js'

const app = new Hono()

export interface CoverZipResult {
  zip: JSZip
  projectName: string
}

/** 이 파일의 핵심 로직 — 단독 다운로드 라우트와 첨부 묶음 라우트 양쪽에서 호출한다. */
export async function buildCoverZip(templateBuf: Buffer, projectId: number, labels: string[]): Promise<CoverZipResult> {
  const project = await queryOne<{ project_name: string }>(
    `SELECT project_name FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  if (!project) throw new Error('사업을 찾을 수 없습니다')

  const commonMap: Record<string, string> = {
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

  const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  let handled = false
  for (const name of slideFiles) {
    let xml = await zip.files[name].async('string')
    xml = applyPlaceholderMap(xml, commonMap)
    const rebuilt = rebuildCoverToc(xml, labels)
    if (rebuilt !== null) {
      xml = rebuilt
      handled = true
    }
    zip.file(name, xml)
  }
  if (!handled) throw new Error('표지 템플릿에서 번호 매긴 목차 텍스트를 찾지 못했습니다')

  return { zip, projectName: project.project_name }
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
    let labels: string[] = []
    const rawLabels = form.get('labels')
    if (typeof rawLabels === 'string' && rawLabels.trim()) {
      try {
        const parsed = JSON.parse(rawLabels)
        if (Array.isArray(parsed)) labels = parsed.map(String)
      } catch {
        return c.json({ ok: false, error: 'labels는 JSON 배열이어야 합니다' }, 400)
      }
    }

    const templateBuf = Buffer.from(await file.arrayBuffer())
    const { zip, projectName } = await buildCoverZip(templateBuf, projectId, labels)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent('0_첨부표지_' + safeName)}.pptx"`)
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ppt-cover] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
