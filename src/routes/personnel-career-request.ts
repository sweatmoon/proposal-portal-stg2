/**
 * [ppt-portal 추가 기능 — 인력정보 탭] "감리원 경력 확인서 발급요청" 엑셀 생성 라우트.
 * 실제 조립 로직은 src/lib/auditor-career-request-doc.ts 참고.
 *
 * POST /api/personnel-career-request
 *   JSON body: { personnelIds: number[] }
 */
import { Hono } from 'hono'
import { buildAuditorCareerRequestXlsx } from '../lib/auditor-career-request-doc.js'

const app = new Hono()

app.post('/', async (c) => {
  try {
    const body = await c.req.json<{ personnelIds?: unknown }>().catch(() => null)
    const personnelIds = Array.isArray(body?.personnelIds)
      ? body!.personnelIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
      : []
    if (!personnelIds.length) {
      return c.json({ ok: false, error: '선택된 인력이 없습니다' }, 400)
    }

    const { zip, personCount, skippedNotFound, skippedNoCertPptx, skippedNoGradeImage, skippedNoCertImage, skippedNoHireDate } =
      await buildAuditorCareerRequestXlsx(personnelIds)

    const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    // 파일명 형식은 원본 템플릿 파일명("감리원 경력 확인서 발급요청(악티보)_yymmdd_n명")과
    // 맞춘다 — yymmdd는 생성(작업)한 날짜, n명은 2자리로 0을 채운다(2026-09-08 사용자 확인).
    const now = new Date()
    const yy = String(now.getFullYear()).slice(-2)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const countStr = String(personCount).padStart(2, '0')
    const filename = `감리원 경력 확인서 발급요청(악티보)_${yy}${mm}${dd}_${countStr}명.xlsx`

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    c.header('X-Person-Count', String(personCount))
    c.header('X-Skipped-Not-Found', encodeURIComponent(skippedNotFound.join(',')))
    c.header('X-Skipped-No-Cert-Pptx', encodeURIComponent(skippedNoCertPptx.join(',')))
    c.header('X-Skipped-No-Grade-Image', encodeURIComponent(skippedNoGradeImage.join(',')))
    c.header('X-Skipped-No-Cert-Image', encodeURIComponent(skippedNoCertImage.join(',')))
    c.header('X-Skipped-No-Hire-Date', encodeURIComponent(skippedNoHireDate.join(',')))
    c.header(
      'Access-Control-Expose-Headers',
      'X-Person-Count, X-Skipped-Not-Found, X-Skipped-No-Cert-Pptx, X-Skipped-No-Grade-Image, X-Skipped-No-Cert-Image, X-Skipped-No-Hire-Date'
    )
    return c.body(new Uint8Array(outBuffer))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[personnel-career-request] 오류:', e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
