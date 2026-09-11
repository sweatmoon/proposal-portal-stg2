/**
 * [ppt-portal 추가 기능] 플레이스홀더 치환 값 소스 중 "DB" 종류가 실제로 읽을 수 있는
 * 필드의 화이트리스트(2026-09-11 — 관리자가 테이블/컬럼명을 직접 입력하게 하면 SQL
 * 인젝션·임의 테이블 조회 위험이 있어서, 미리 정의해둔 필드 중에서만 고르게 한다). 새
 * 필드가 필요해지면 이 배열에 하나 추가하는 정도의 코드 변경만 필요하다.
 *
 * scope='project'인 필드는 사업 전체에서 값이 하나(예: 사업명)라 person 목록과 무관하게
 * 한 번만 읽고, scope='person'인 필드는 인력마다 값이 달라서(예: 담당분야) 이름 목록으로
 * 한 번에 조회한 뒤 이름→값 맵으로 돌려준다 — 인원수와 무관하게 고정 왕복 수로 끝나는
 * ppt-career.ts의 최적화 패턴과 동일.
 */
import { query, queryOne } from '../db/client.js'

export interface ProjectScopedField {
  key: string
  label: string
  scope: 'project'
  load: (projectId: number) => Promise<string>
}

export interface PersonScopedField {
  key: string
  label: string
  scope: 'person'
  load: (projectId: number, personNames: string[]) => Promise<Map<string, string>>
}

export type DbFieldDef = ProjectScopedField | PersonScopedField

async function loadProjectField(projectId: number, column: 'project_name' | 'client_org' | 'bid_deadline'): Promise<string> {
  const row = await queryOne<Record<string, string | null>>(
    `SELECT ${column} FROM audit_projects WHERE id = $1`,
    [projectId]
  )
  return row?.[column] ?? ''
}

async function loadMemberDomain(projectId: number, names: string[]): Promise<Map<string, string>> {
  const rows = await query<{ person_name: string; domain: string | null }>(
    `SELECT person_name, domain FROM proposal_members WHERE project_id = $1 AND person_name = ANY($2)`,
    [projectId, names]
  )
  return new Map(rows.map(r => [r.person_name, r.domain ?? '']))
}

async function loadPersonnelColumn(names: string[], column: 'birthdate'): Promise<Map<string, string>> {
  const rows = await query<{ name: string; [k: string]: string | null }>(
    `SELECT name, ${column} FROM personnel WHERE name = ANY($1)`,
    [names]
  )
  return new Map(rows.map(r => [r.name, r[column] ?? '']))
}

async function loadPersonName(_projectId: number, names: string[]): Promise<Map<string, string>> {
  return new Map(names.map(n => [n, n]))
}

export const DB_FIELD_WHITELIST: DbFieldDef[] = [
  { key: 'person_name', label: '이름 (proposal_members.person_name — 이 사업 투입 인력 본인 이름)', scope: 'person',
    load: (projectId, names) => loadPersonName(projectId, names) },
  { key: 'project_name', label: '사업명 (audit_projects.project_name)', scope: 'project',
    load: (projectId) => loadProjectField(projectId, 'project_name') },
  { key: 'client_org', label: '주관기관 (audit_projects.client_org)', scope: 'project',
    load: (projectId) => loadProjectField(projectId, 'client_org') },
  { key: 'bid_deadline', label: '입찰마감일 (audit_projects.bid_deadline, YYYY-MM-DD)', scope: 'project',
    load: (projectId) => loadProjectField(projectId, 'bid_deadline') },
  { key: 'member_domain', label: '담당분야 (proposal_members.domain)', scope: 'person',
    load: (projectId, names) => loadMemberDomain(projectId, names) },
  { key: 'personnel_birthdate', label: '생년월일 (personnel.birthdate, YYMMDD)', scope: 'person',
    load: (_projectId, names) => loadPersonnelColumn(names, 'birthdate') },
]

export function findDbField(key: string): DbFieldDef | undefined {
  return DB_FIELD_WHITELIST.find(f => f.key === key)
}
