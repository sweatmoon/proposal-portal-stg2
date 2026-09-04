/**
 * Entry point — Hono + @hono/node-server (Railway / Node.js)
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { query } from './db/client.js'
import uploadPersonnelRoute from './routes/upload-personnel.js'
import uploadProjectRoute from './routes/upload-project.js'
import pagesRoute from './routes/pages.js'
import projectsApiRoute from './routes/projects.js'
import personnelApiRoute from './routes/personnel-list.js'
import pptMenuApiRoute from './routes/ppt-menu.js'
import auditProjectsApiRoute from './routes/audit-projects.js'
import pptGenerateApiRoute from './routes/ppt-generate.js'

// ── [ppt-portal 추가 기능] "첨부PPT 생성" 라우트 세트 ────────────────────────
// 사업별로 "0. 정성제안서 첨부 표지" + "1. 감리원 일정 현황표" + "2. 투입 감리원별
// 실적 및 경력" + "3. 비상근 감리원 참여 동의서" + "4. 표준재무제표" + "5. 사업자등록증"을,
// 웹 화면에서 체크·드래그로 고른 항목/순서대로 pptx 한 파일로 합쳐서 생성하는 기능
// 전체입니다. 아래 7개 파일 + src/lib/pptx-*.ts(OOXML 조립 유틸) + src/lib/nas-client.ts
// (NAS 조회) + src/views/attachment-bundle-widget.ts(UI)가 이 기능의 전부이고,
// ppt-portal(stg) 스테이징 사이트에서 검증 후 그대로 이식한 것입니다.
import pptConsentApiRoute from './routes/ppt-consent.js'
import pptScheduleApiRoute from './routes/ppt-schedule.js'
import pptCareerApiRoute from './routes/ppt-career.js'
import pptFinancialStatementApiRoute from './routes/ppt-financial-statement.js'
import pptBusinessRegistrationApiRoute from './routes/ppt-business-registration.js'
import pptTaxCertificateApiRoute from './routes/ppt-tax-certificate.js'
import pptLocalTaxCertificateApiRoute from './routes/ppt-local-tax-certificate.js'
import pptCorporateRegistryApiRoute from './routes/ppt-corporate-registry.js'
import pptCoverApiRoute from './routes/ppt-cover.js'
import pptAttachmentBundleApiRoute from './routes/ppt-attachment-bundle.js'

const app = new Hono()

// ── 미들웨어 ──────────────────────────────────────────────────
app.use('*', logger())
app.use('/api/*', cors())

// ── 정적 파일 서빙 (dist/static/) ────────────────────────────
app.use('/static/*', serveStatic({ root: './dist' }))

// ── 헬스체크 (Railway health probe) ──────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ── API 라우트 ────────────────────────────────────────────────
app.route('/api/upload/personnel', uploadPersonnelRoute)
app.route('/api/upload/project',   uploadProjectRoute)
app.route('/api/projects',         projectsApiRoute)
app.route('/api/personnel',        personnelApiRoute)
app.route('/api/ppt-menus',        pptMenuApiRoute)
app.route('/api/ppt-compositions', pptMenuApiRoute)   // compositions 서브라우트 별칭
app.route('/api/audit-projects',   auditProjectsApiRoute)
app.route('/api/ppt-generate',     pptGenerateApiRoute)

// [ppt-portal 추가 기능] 첨부PPT 생성 세트 — 위 import 블록의 배너 주석 참고.
app.route('/api/ppt-consent',              pptConsentApiRoute)
app.route('/api/ppt-schedule',             pptScheduleApiRoute)
app.route('/api/ppt-career',               pptCareerApiRoute)
app.route('/api/ppt-financial-statement',  pptFinancialStatementApiRoute)
app.route('/api/ppt-business-registration',pptBusinessRegistrationApiRoute)
app.route('/api/ppt-tax-certificate',      pptTaxCertificateApiRoute)
app.route('/api/ppt-local-tax-certificate',pptLocalTaxCertificateApiRoute)
app.route('/api/ppt-corporate-registry',   pptCorporateRegistryApiRoute)
app.route('/api/ppt-cover',                pptCoverApiRoute)
app.route('/api/ppt-attachment-bundle',    pptAttachmentBundleApiRoute)

// ── 페이지 라우트 (홈, /proposals, /personnel, /upload) ───────
app.route('/', pagesRoute)

// ── 전역 에러 핸들러 (디버그용 — 실제 에러 메시지 노출) ──────
app.onError((err, c) => {
  console.error('[onError]', err)
  return c.html(`
    <html><body style="background:#111;color:#f87171;font-family:monospace;padding:2rem">
      <h2 style="color:#fb923c">Internal Server Error</h2>
      <pre style="white-space:pre-wrap;font-size:13px">${err.stack ?? err.message}</pre>
    </body></html>
  `, 500)
})

// ── 서버 시작 ─────────────────────────────────────────────────
const port = parseInt(process.env.PORT ?? '3000', 10)
console.log(`🚀 서버 시작: http://localhost:${port}`)

serve({ fetch: app.fetch, port })

// ── 앱 시작 후 자동 마이그레이션 (ppt_master_templates 테이블 보장) ──
;(async () => {
  // 각 쿼리를 독립 try-catch — 일부 테이블이 없어도 나머지 계속 진행
  const safeExec = async (sql: string, label: string) => {
    try { await query(sql) }
    catch (e) { console.warn(`⚠️  auto-migrate [${label}] 스킵:`, (e as Error).message?.slice(0, 100)) }
  }

  await safeExec(`
    CREATE TABLE IF NOT EXISTS ppt_master_templates (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      pptx_b64     TEXT NOT NULL,
      layouts      JSONB NOT NULL DEFAULT '[]',
      is_active    INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `, 'create ppt_master_templates')
  await safeExec(`ALTER TABLE ppt_master_templates ADD COLUMN IF NOT EXISTS layouts JSONB NOT NULL DEFAULT '[]'`, 'add layouts col')
  await safeExec(`CREATE INDEX IF NOT EXISTS idx_ppt_masters_active ON ppt_master_templates(is_active DESC, created_at DESC)`, 'idx masters')
  await safeExec(`ALTER TABLE ppt_generation_rules ADD COLUMN IF NOT EXISTS target_layout_name TEXT`, 'add target_layout_name col')
  console.log('✅ auto-migrate 완료')
})()

export default app
