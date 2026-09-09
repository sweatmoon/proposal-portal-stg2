/**
 * PPT 생성 API — 첨부 템플릿(pptx) + 사업 데이터 → 치환된 pptx 다운로드
 *
 * ⚠️ 중요: 업로드된 템플릿 파일은 이 요청을 처리하는 동안만 메모리에 존재하며,
 *          디스크나 DB에 절대 저장하지 않습니다. 응답을 보내고 나면 그대로 폐기됩니다.
 *          (나중에 "템플릿 라이브러리" 기능을 만들 때 ppt_templates 테이블에 저장하는
 *           방식으로 확장할 예정 — 지금은 요구사항에 따라 저장 로직을 넣지 않았습니다.)
 *
 * POST /api/ppt-generate/:projectId
 *   multipart/form-data:
 *     - template: File (.pptx)
 *   응답: 치환된 .pptx 바이너리 (Content-Disposition: attachment)
 *
 * 지원 플레이스홀더 (템플릿 슬라이드에 텍스트로 그대로 입력해두면 치환됩니다):
 *   {{PROJECT_NAME}} {{CLIENT_ORG}} {{BID_NOTICE_NO}} {{REGISTERED_YM}}
 *   {{BID_DEADLINE}} {{BID_AMOUNT}} {{REQUIRED_MD}} {{PROPOSED_MD}}
 *   {{WRITER}} {{DIRECTOR}}
 *   {{TARGET_PROJECT_NAME}} {{TARGET_CLIENT_ORG}} {{TARGET_CONTRACTOR}}
 *   {{TARGET_PERIOD_START}} {{TARGET_PERIOD_END}}
 */
import { Hono } from 'hono'
import JSZip from 'jszip'
import { queryOne } from '../db/client.js'

const app = new Hono()

/** XML 특수문자 이스케이프 (치환할 값 안에 &, <, > 등이 있을 경우 pptx가 깨지는 것 방지) */
function escapeXml(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fmtMoneyPlain(n: unknown): string {
  if (n === null || n === undefined) return ''
  const num = Number(n)
  if (Number.isNaN(num)) return String(n)
  return num.toLocaleString('ko-KR')
}

/** DB 로우 → 플레이스홀더 맵 */
function buildPlaceholderMap(p: Record<string, unknown>): Record<string, string> {
  return {
    '{{PROJECT_NAME}}': escapeXml(p.project_name),
    '{{CLIENT_ORG}}': escapeXml(p.client_org),
    '{{BID_NOTICE_NO}}': escapeXml(p.bid_notice_no),
    '{{REGISTERED_YM}}': escapeXml(p.registered_yearmonth),
    '{{BID_DEADLINE}}': escapeXml(p.bid_deadline),
    '{{BID_AMOUNT}}': fmtMoneyPlain(p.bid_amount),
    '{{REQUIRED_MD}}': escapeXml(p.required_md),
    '{{PROPOSED_MD}}': escapeXml(p.proposed_md),
    '{{WRITER}}': escapeXml(p.writer),
    '{{DIRECTOR}}': escapeXml(p.director),
    '{{TARGET_PROJECT_NAME}}': escapeXml(p.target_project_name),
    '{{TARGET_CLIENT_ORG}}': escapeXml(p.target_client_org),
    '{{TARGET_CONTRACTOR}}': escapeXml(p.target_contractor),
    '{{TARGET_PERIOD_START}}': escapeXml(p.target_period_start),
    '{{TARGET_PERIOD_END}}': escapeXml(p.target_period_end),
  }
}

/** 문자열 안의 모든 플레이스홀더를 치환 */
function applyPlaceholders(xml: string, map: Record<string, string>): string {
  let out = xml
  for (const [token, value] of Object.entries(map)) {
    out = out.split(token).join(value)
  }
  return out
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

    const project = await queryOne<Record<string, unknown>>(
      `SELECT * FROM audit_projects WHERE id = $1`,
      [projectId]
    )
    if (!project) return c.json({ ok: false, error: '사업을 찾을 수 없습니다' }, 404)

    // ── 템플릿은 메모리에서만 처리 (디스크/DB 저장 없음) ──────────
    const templateBuf = Buffer.from(await file.arrayBuffer())
    const zip = await JSZip.loadAsync(templateBuf)
    const placeholderMap = buildPlaceholderMap(project)

    let replacedSlides = 0
    const slideFiles = Object.keys(zip.files).filter(name =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    )
    for (const name of slideFiles) {
      const xml = await zip.files[name].async('string')
      const patched = applyPlaceholders(xml, placeholderMap)
      if (patched !== xml) replacedSlides++
      zip.file(name, patched)
    }

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    const safeName = String(project.project_name ?? 'proposal')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 60)

    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    c.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.pptx"`
    )
    c.header('X-Replaced-Slides', String(replacedSlides))
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
