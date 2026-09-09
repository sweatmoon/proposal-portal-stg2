/**
 * 인력 HTML 업로드 → 파싱 → PostgreSQL 저장 API
 * POST /api/upload/personnel
 * 중복 처리: personnel.name 동일 시 UPSERT (덮어쓰기)
 */
import { Hono } from 'hono'
import { parsePersonnelHtml } from '../parsers/personnel-parser.js'
import { transaction } from '../db/client.js'
import type pg from 'pg'

const app = new Hono()

app.post('/', async (c) => {
  // ── 파일 수신 ──
  let html: string
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ ok: false, error: 'file 필드가 없습니다' }, 400)
    if (!file.name.toLowerCase().endsWith('.html'))
      return c.json({ ok: false, error: 'HTML 파일만 업로드 가능합니다' }, 400)
    html = await file.text()
  } catch (e) {
    return c.json({ ok: false, error: `파일 읽기 실패: ${String(e)}` }, 400)
  }

  // ── 파싱 ──
  let parsed
  try {
    parsed = parsePersonnelHtml(html)
  } catch (e) {
    return c.json({ ok: false, error: `파싱 실패: ${String(e)}` }, 422)
  }

  const { personnel, certifications, audit_history, it_career, project_career } = parsed
  if (!personnel.name)
    return c.json({ ok: false, error: '성명을 파싱할 수 없습니다. 인력 프로파일 HTML인지 확인하세요' }, 422)

  // ── DB 저장 ──
  try {
    const result = await transaction(async (client: pg.PoolClient) => {
      // email 중복 방지: 동일 email이 다른 인력에 이미 존재하면 NULL 처리
      let safeEmail: string | null = personnel.email || null
      if (safeEmail) {
        const existing = await client.query(
          `SELECT id FROM personnel WHERE email = $1 AND name != $2 LIMIT 1`,
          [safeEmail, personnel.name]
        )
        if (existing.rows.length > 0) safeEmail = null
      }

      // 1. personnel UPSERT (name 기준)
      const upsertRes = await client.query(`
        INSERT INTO personnel (
          name, position, is_fulltime, company,
          email, phone, birthdate,
          auditor_cert_no, auditor_grade, tech_grade,
          school, major, degree,
          career_summary, career_qualif, career_project, career_expert,
          education_name, education_hours, education_org,
          updated_at
        ) VALUES ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10, $11,$12,$13, $14,$15,$16,$17, $18,$19,$20, NOW())
        ON CONFLICT (name) DO UPDATE SET
          position        = EXCLUDED.position,
          is_fulltime     = EXCLUDED.is_fulltime,
          company         = EXCLUDED.company,
          email           = EXCLUDED.email,
          phone           = EXCLUDED.phone,
          birthdate       = EXCLUDED.birthdate,
          auditor_cert_no = EXCLUDED.auditor_cert_no,
          auditor_grade   = EXCLUDED.auditor_grade,
          tech_grade      = EXCLUDED.tech_grade,
          school          = EXCLUDED.school,
          major           = EXCLUDED.major,
          degree          = EXCLUDED.degree,
          career_summary  = EXCLUDED.career_summary,
          career_qualif   = EXCLUDED.career_qualif,
          career_project  = EXCLUDED.career_project,
          career_expert   = EXCLUDED.career_expert,
          education_name  = EXCLUDED.education_name,
          education_hours = EXCLUDED.education_hours,
          education_org   = EXCLUDED.education_org,
          updated_at      = NOW()
        RETURNING id
      `, [
        personnel.name, personnel.position, personnel.is_fulltime, personnel.company,
        safeEmail, personnel.phone, personnel.birthdate,
        personnel.auditor_cert_no, personnel.auditor_grade, personnel.tech_grade,
        personnel.school, personnel.major, personnel.degree,
        personnel.career_summary, personnel.career_qualif, personnel.career_project, personnel.career_expert,
        personnel.education_name, personnel.education_hours, personnel.education_org,
      ])

      const pid: number = upsertRes.rows[0].id

      // 2. 하위 테이블 삭제
      await client.query('DELETE FROM personnel_certifications WHERE personnel_id = $1', [pid])
      await client.query('DELETE FROM personnel_audit_history WHERE personnel_id = $1', [pid])
      await client.query('DELETE FROM personnel_it_career WHERE personnel_id = $1', [pid])
      await client.query('DELETE FROM personnel_project_career WHERE personnel_id = $1', [pid])

      // 3. 자격증
      for (const cert of certifications) {
        await client.query(`
          INSERT INTO personnel_certifications (personnel_id, cert_name, cert_year, issuer, is_national, related_field)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [pid, cert.cert_name, cert.cert_year, cert.issuer, cert.is_national, cert.related_field])
      }

      // 4. 감리실적 (배치)
      const BATCH = 50
      for (let i = 0; i < audit_history.length; i += BATCH) {
        const chunk = audit_history.slice(i, i + BATCH)
        // VALUES 플레이스홀더 생성
        const values: unknown[] = []
        const placeholders = chunk.map((h, j) => {
          const base = j * 9
          values.push(pid, h.audit_yearmonth, h.project_name, h.client_org, h.sector, h.domain, h.role, h.phase, h.participation_rate)
          return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`
        }).join(',')
        await client.query(`
          INSERT INTO personnel_audit_history
            (personnel_id, audit_yearmonth, project_name, client_org, sector, domain, role, phase, participation_rate)
          VALUES ${placeholders}
        `, values)
      }

      // ── 감리경력 동적 계산 ──────────────────────────────────
      // audit_history 중 가장 오래된 audit_yearmonth → auditor_start_date
      // 현재까지 연수 = (현재년월 - 첫 감리년월) / 12
      if (audit_history.length > 0) {
        // "YYYY.MM" 또는 "YYYY년MM월" → 비교 가능 정렬 문자열로 변환
        const toSortable = (ym: string): string => {
          const m = ym.match(/(\d{4})[.\s년](\d{1,2})/)
          if (m) return `${m[1]}.${m[2].padStart(2, '0')}`
          return ym
        }
        const sorted = [...audit_history]
          .map(h => toSortable(h.audit_yearmonth))
          .filter(s => /^\d{4}\.\d{2}$/.test(s))
          .sort()  // 사전순 = 시간순

        if (sorted.length > 0) {
          const earliest = sorted[0]  // ex) "2003.07"
          const [startYear, startMonth] = earliest.split('.').map(Number)

          const now = new Date()
          const nowYear  = now.getFullYear()
          const nowMonth = now.getMonth() + 1  // 1-indexed

          const totalMonths = (nowYear - startYear) * 12 + (nowMonth - startMonth)
          const careerYrs   = Math.max(0, Math.round(totalMonths / 12 * 10) / 10)

          await client.query(`
            UPDATE personnel
            SET auditor_start_date = $1, auditor_career_yrs = $2
            WHERE id = $3
          `, [earliest, careerYrs, pid])
        }
      }

      // 5. IT 경력 (감리 이외의 IT 경력)
      for (const ic of it_career) {
        await client.query(`
          INSERT INTO personnel_it_career
            (personnel_id, period_start, period_end, career, duty, basis)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [pid, ic.period_start, ic.period_end, ic.career, ic.duty, ic.basis])
      }

      // 6. 프로젝트 및 기타 경력
      for (const pc of project_career) {
        await client.query(`
          INSERT INTO personnel_project_career
            (personnel_id, year_range, project_name, client_org, domain, role, company, remarks)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [pid, pc.year_range, pc.project_name, pc.client_org, pc.domain, pc.role, pc.company, pc.remarks])
      }

      return {
        personnel_id: pid,
        name: personnel.name,
        certifications: certifications.length,
        audit_history: audit_history.length,
        it_career: it_career.length,
        project_career: project_career.length,
      }
    })

    return c.json({ ok: true, message: `인력 "${personnel.name}" 저장 완료`, data: result })
  } catch (e) {
    return c.json({ ok: false, error: `DB 저장 실패: ${String(e)}` }, 500)
  }
})

export default app
