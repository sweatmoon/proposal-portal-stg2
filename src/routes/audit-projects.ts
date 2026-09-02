/**
 * 사업(audit_projects) 목록/단건 조회 API — 읽기 전용
 *
 * GET /api/audit-projects        — 목록
 * GET /api/audit-projects/:id    — 단건 (PPT 생성용 상세 필드 포함)
 */
import { Hono } from 'hono'
import { query, queryOne } from '../db/client.js'

const app = new Hono()

/** GET /api/audit-projects — 목록 */
app.get('/', async (c) => {
  try {
    const search = c.req.query('search') || ''
    let sql = `
      SELECT id, project_name, client_org, bid_notice_no,
             registered_yearmonth, bid_deadline, proposal_status,
             writer, director
      FROM audit_projects
      WHERE 1=1
    `
    const params: string[] = []
    if (search) {
      sql += ` AND (project_name ILIKE $1 OR client_org ILIKE $1)`
      params.push(`%${search}%`)
    }
    sql += ` ORDER BY bid_deadline DESC NULLS LAST, id DESC`

    const rows = await query(sql, params)
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** GET /api/audit-projects/:id — 단건 (PPT 치환용 전체 필드) */
app.get('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const row = await queryOne(`SELECT * FROM audit_projects WHERE id = $1`, [id])
    if (!row) return c.json({ ok: false, error: '사업을 찾을 수 없습니다' }, 404)
    return c.json({ ok: true, data: row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** GET /api/audit-projects/:id/phases — "1. 감리원 일정 현황표" 생성 모달에서
 *  단계별 "추가" 체크박스를 그리기 위한 단계 목록 (검수지원 단계는 항상 고정값이라 제외) */
app.get('/:id/phases', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const rows = await query(
      `SELECT id, phase_name, phase_start_date, phase_end_date
       FROM audit_phases
       WHERE project_id = $1 AND replace(phase_name, ' ', '') <> '검수지원'
       ORDER BY phase_start_date`,
      [id]
    )
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
