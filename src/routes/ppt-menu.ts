/**
 * PPT 목차/메뉴/템플릿/생성규칙/구성순서 관리 API
 *
 * POST   /api/ppt-menus/migrate               — PPT 테이블 생성 (멱등)
 * POST   /api/ppt-menus/seed                  — 명세 기반 전체 목차 시드 (멱등)
 *
 * GET    /api/ppt-menus                        — 전체 메뉴 트리
 * POST   /api/ppt-menus                        — 메뉴 생성
 * PUT    /api/ppt-menus/:id                   — 메뉴 수정
 * DELETE /api/ppt-menus/:id                   — 메뉴 삭제
 *
 * GET    /api/ppt-menus/:id/rule              — 생성규칙 조회
 * PUT    /api/ppt-menus/:id/rule              — 생성규칙 저장 (upsert)
 *
 * GET    /api/ppt-menus/:id/templates         — 템플릿 목록
 * POST   /api/ppt-menus/:id/templates         — 템플릿 생성
 * PUT    /api/ppt-templates/:tid              — 템플릿 수정
 * DELETE /api/ppt-templates/:tid              — 템플릿 삭제
 *
 * GET    /api/ppt-compositions                 — 구성순서 목록
 * POST   /api/ppt-compositions                 — 구성순서 항목 추가
 * PUT    /api/ppt-compositions/:cid            — 구성순서 수정
 * DELETE /api/ppt-compositions/:cid            — 구성순서 삭제
 * POST   /api/ppt-compositions/reorder         — 순서 일괄 변경
 */

import { Hono } from 'hono'
import { query, queryOne } from '../db/client.js'
import { inflateRawSync } from 'zlib'
import { isAttachmentBuildKind, type AttachmentBuildKind } from '../lib/attachment-build-kind.js'

const app = new Hono()

// ─────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────
async function exec(sql: string, params: unknown[] = []) {
  return query(sql, params)
}

/**
 * PPTX(ZIP) 버퍼에서 slideLayout XML을 파싱하여 레이아웃 이름 배열 반환
 * 추가 npm 패키지 없이 Node.js 내장 zlib만 사용
 */
function extractLayoutNamesFromPptx(buf: Buffer): string[] {
  const names: string[] = []
  try {
    // ZIP 파일 끝에서 End-of-Central-Directory 레코드 탐색
    let eocdOffset = -1
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break }
    }
    if (eocdOffset < 0) return names

    const cdOffset = buf.readUInt32LE(eocdOffset + 16)
    const cdSize   = buf.readUInt32LE(eocdOffset + 12)
    let pos = cdOffset

    while (pos < cdOffset + cdSize) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break
      const compression  = buf.readUInt16LE(pos + 10)
      const compSize     = buf.readUInt32LE(pos + 20)
      const uncompSize   = buf.readUInt32LE(pos + 24)
      const fileNameLen  = buf.readUInt16LE(pos + 28)
      const extraLen     = buf.readUInt16LE(pos + 30)
      const commentLen   = buf.readUInt16LE(pos + 32)
      const localOffset  = buf.readUInt32LE(pos + 42)
      const fileName     = buf.slice(pos + 46, pos + 46 + fileNameLen).toString('utf8')
      pos += 46 + fileNameLen + extraLen + commentLen

      // slideLayout XML만 처리
      if (!fileName.match(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/)) continue

      // Local File Header → 실제 데이터 위치 계산
      const lhFnLen  = buf.readUInt16LE(localOffset + 26)
      const lhExLen  = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lhFnLen + lhExLen

      let xmlBuf: Buffer
      if (compression === 0) {
        xmlBuf = buf.slice(dataStart, dataStart + uncompSize)
      } else {
        xmlBuf = inflateRawSync(buf.slice(dataStart, dataStart + compSize))
      }
      const xml = xmlBuf.toString('utf8')

      // <p:cSld name="레이아웃이름"> 추출
      const m = xml.match(/<p:cSld[^>]*\bname="([^"]+)"/)
      const layoutName = m ? m[1] : fileName.replace(/^.*\//, '').replace('.xml', '')
      if (layoutName && !names.includes(layoutName)) names.push(layoutName)
    }
  } catch (e) {
    console.warn('[extractLayouts] 파싱 실패:', (e as Error).message)
  }
  return names
}

// ═══════════════════════════════════════════════════════════════════
// [1] 마이그레이션 — 6개 테이블 생성 (멱등)
// ═══════════════════════════════════════════════════════════════════
app.post('/migrate', async (c) => {
  try {
    // 1. ppt_menus
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_menus (
        id          SERIAL PRIMARY KEY,
        parent_id   INTEGER REFERENCES ppt_menus(id) ON DELETE SET NULL,
        menu_code   TEXT    NOT NULL UNIQUE,
        menu_name   TEXT    NOT NULL,
        menu_number TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        is_enabled  INTEGER NOT NULL DEFAULT 1,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // 2. ppt_templates
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_templates (
        id              SERIAL PRIMARY KEY,
        menu_id         INTEGER NOT NULL REFERENCES ppt_menus(id) ON DELETE CASCADE,
        template_name   TEXT    NOT NULL,
        variant_code    TEXT    NOT NULL DEFAULT 'DEFAULT',
        pptx_file_path  TEXT,
        pptx_b64_key    TEXT,
        capacity        INTEGER,
        slide_count     INTEGER,
        version         INTEGER NOT NULL DEFAULT 1,
        is_default      INTEGER NOT NULL DEFAULT 1,
        is_active       INTEGER NOT NULL DEFAULT 1,
        metadata        TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (menu_id, variant_code, version)
      )
    `)

    // 3. ppt_generation_rules
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_generation_rules (
        id               SERIAL PRIMARY KEY,
        menu_id          INTEGER NOT NULL UNIQUE REFERENCES ppt_menus(id) ON DELETE CASCADE,
        generation_mode  TEXT    NOT NULL DEFAULT 'BUILD_TABLE',
        template_strategy TEXT   NOT NULL DEFAULT 'PPTX_TEMPLATE',
        calculator_code  TEXT,
        renderer_code    TEXT,
        pagination_mode  TEXT    NOT NULL DEFAULT 'SINGLE',
        postprocess_mode TEXT    NOT NULL DEFAULT 'NONE',
        merge_strategy   TEXT    NOT NULL DEFAULT 'STANDARD',
        rule_config      TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // 4. ppt_template_elements
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_template_elements (
        id            SERIAL PRIMARY KEY,
        template_id   INTEGER NOT NULL REFERENCES ppt_templates(id) ON DELETE CASCADE,
        element_code  TEXT    NOT NULL,
        element_type  TEXT    NOT NULL,
        data_key      TEXT,
        slide_index   INTEGER,
        x             REAL,
        y             REAL,
        width         REAL,
        height        REAL,
        config        TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // 5. ppt_compositions (최종 PPT 구성 순서 / 조건)
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_compositions (
        id             SERIAL PRIMARY KEY,
        proposal_type  TEXT    NOT NULL DEFAULT 'DEFAULT',
        menu_id        INTEGER NOT NULL REFERENCES ppt_menus(id) ON DELETE CASCADE,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        is_required    INTEGER NOT NULL DEFAULT 1,
        condition_code TEXT,
        is_enabled     INTEGER NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (proposal_type, menu_id)
      )
    `)

    // 6. ppt_template_versions (버전 이력)
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_template_versions (
        id            SERIAL PRIMARY KEY,
        template_id   INTEGER NOT NULL REFERENCES ppt_templates(id) ON DELETE CASCADE,
        version       INTEGER NOT NULL,
        file_path     TEXT,
        pptx_b64_key  TEXT,
        uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        uploaded_by   TEXT,
        change_note   TEXT,
        UNIQUE (template_id, version)
      )
    `)

    // 인덱스
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_ppt_menus_parent        ON ppt_menus(parent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_menus_sort          ON ppt_menus(sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_templates_menu      ON ppt_templates(menu_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_gen_rules_menu      ON ppt_generation_rules(menu_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_elements_template   ON ppt_template_elements(template_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_compositions_menu   ON ppt_compositions(menu_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_compositions_sort   ON ppt_compositions(proposal_type, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_ppt_tpl_versions_tpl    ON ppt_template_versions(template_id)`,
    ]
    for (const sql of indexes) await exec(sql)

    // 7. ppt_presets (전체 목차 스냅샷 프리셋)
    await exec(`
      CREATE TABLE IF NOT EXISTS ppt_presets (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        menu_count  INTEGER NOT NULL DEFAULT 0,
        snapshot    JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await exec(`CREATE INDEX IF NOT EXISTS idx_ppt_presets_created ON ppt_presets(created_at DESC)`)

    // 8. ppt_master_templates (전체 PPT에 적용할 마스터 디자인 템플릿)
    await exec(`
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
    `)
    await exec(`CREATE INDEX IF NOT EXISTS idx_ppt_masters_active ON ppt_master_templates(is_active DESC, created_at DESC)`)
    // layouts 컬럼 없는 구버전 자동 업그레이드 (멱등)
    await exec(`ALTER TABLE ppt_master_templates ADD COLUMN IF NOT EXISTS layouts JSONB NOT NULL DEFAULT '[]'`)

    // 9. ppt_generation_rules 에 target_layout_name 컬럼 추가 (구버전 호환)
    await exec(`ALTER TABLE ppt_generation_rules ADD COLUMN IF NOT EXISTS target_layout_name TEXT`)

    // 10. ppt_menus 에 category 컬럼 추가 (proposal / attachment 구분, 구버전 호환)
    await exec(`ALTER TABLE ppt_menus ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'proposal'`)

    // 11. ppt_menus 에 build_kind 컬럼 추가 — 첨부 항목이 실제로 어떻게 만들어지는지 3가지
    // 분류(PERSON_PAGES/IMAGE_REPLACE/SHARED_TABLE, src/lib/attachment-build-kind.ts 참고)
    // 중 어디에 속하는지 표시하는 가벼운 태그. proposal 카테고리 메뉴에는 해당 없어 NULL로
    // 둔다(2026-09-10 사용자 확인 — "템플릿(첨부/서류 항목)도 저 3가지로 가볍게 분류해줘").
    await exec(`ALTER TABLE ppt_menus ADD COLUMN IF NOT EXISTS build_kind TEXT`)

    // 12. ppt_menus 에 nas_path 컬럼 추가 — IMAGE_REPLACE 항목이 NAS의 어느 폴더에서 원본
    // 스캔본/PDF를 가져오는지, 관리자가 "PPT 템플릿 관리 → 첨부 → 이미지 치환" 탭에서
    // 직접 수정할 수 있는 경로(2026-09-10 사용자 확인 — "이름, 경로 수정이 가능해야 해").
    await exec(`ALTER TABLE ppt_menus ADD COLUMN IF NOT EXISTS nas_path TEXT`)

    // 13. ppt_menus 에 variant_options 컬럼 추가 — 법인등기부등본의 "말소사항 포함/미포함"
    // 같은 "같은 폴더 안에 파일명으로 구분되는 여러 종류" 케이스를 "+"로 추가한 항목도
    // 지원하기 위한 범용 옵션 목록(JSON 배열: [{label, includes, excludes}]).
    // includes/excludes는 파일명에 포함/제외돼야 하는 문자열 — 둘 다 없으면 옵션 선택 없이
    // 그냥 최신 파일 하나를 쓴다(2026-09-10 사용자 확인 — "특수 필터/조건... 저걸로 모든걸
    // 해결 가능하게 만들어야해").
    await exec(`ALTER TABLE ppt_menus ADD COLUMN IF NOT EXISTS variant_options TEXT`)

    return c.json({ ok: true, message: 'PPT 테이블 마이그레이션 완료 (8개 테이블 + 컬럼 업그레이드)' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [2] 시드 — 명세 기반 전체 목차 (38개 메뉴 + 6개 섹션) + GenerationRule
// ═══════════════════════════════════════════════════════════════════
app.post('/seed', async (c) => {
  try {
    // ── 구버전 menu_code 호환 rename (멱등) ────────────────────────
    // SUMMARY_TABLE → COMPLIANCE, ASSIGN_TABLE → MANPOWER_MD, PHOTO_ASSIGN → AUDITOR_PROFILE
    const renames: Array<[string, string]> = [
      ['SUMMARY_TABLE', 'COMPLIANCE'],
      ['ASSIGN_TABLE',  'MANPOWER_MD'],
      ['PHOTO_ASSIGN',  'AUDITOR_PROFILE'],
    ]
    for (const [oldCode, newCode] of renames) {
      // 새 코드가 아직 없을 때만 rename (이미 둘 다 존재하면 건드리지 않음)
      await exec(`
        UPDATE ppt_menus
        SET menu_code = $2, updated_at = NOW()
        WHERE menu_code = $1
          AND NOT EXISTS (SELECT 1 FROM ppt_menus WHERE menu_code = $2)
      `, [oldCode, newCode])
    }

    // ── 섹션 (parent) 정의 ─────────────────────────────────────────
    type SectionDef = { code: string; name: string; number: string; sort: number }
    const SECTIONS: SectionDef[] = [
      { code: 'SECTION_SCHEDULE',  name: '감리 수행 계획',   number: '다', sort: 300 },
      { code: 'SECTION_MANPOWER',  name: '감리 수행 인력',    number: '라', sort: 400 },
      { code: 'SECTION_QUALITY',   name: '감리 품질 및 지원', number: '마', sort: 600 },
      { code: 'SECTION_COMPANY',   name: '제안사 현황',        number: '바', sort: 800 },
    ]
    for (const s of SECTIONS) {
      await exec(`
        INSERT INTO ppt_menus (menu_code, menu_name, menu_number, sort_order, is_enabled)
        VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (menu_code) DO UPDATE
          SET menu_name=$2, menu_number=$3, sort_order=$4, updated_at=NOW()
      `, [s.code, s.name, s.number, s.sort])
    }

    // 섹션 ID 맵
    const secRows = await query<{ id: number; menu_code: string }>(
      `SELECT id, menu_code FROM ppt_menus WHERE menu_code = ANY($1)`,
      [SECTIONS.map(s => s.code)]
    )
    const SEC: Record<string, number> = {}
    for (const r of secRows) SEC[r.menu_code] = r.id

    // ── 메뉴 + 생성규칙 정의 ───────────────────────────────────────
    type MenuDef = {
      parentKey: string
      code: string; name: string; number: string; sort: number; enabled: number
      mode: string; strategy: string; calc: string; renderer: string
      pagination: string; postprocess: string; merge: string; config: object
      templates?: Array<{ variant: string; capacity: number | null; b64Key?: string }>
    }

    const MENUS: MenuDef[] = [
      // ── 다. 감리 일정 및 절차 ─────────────────────────────────────
      {
        parentKey: 'SECTION_SCHEDULE', code: 'SCHEDULE_PLAN', name: '감리 일정 계획',
        number: '1.1', sort: 310, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_SCHEDULE', code: 'DETAIL_SCHEDULE', name: '세부 감리 일정 (1/2)',
        number: '1.2', sort: 320, enabled: 1,
        mode: 'BUILD_TABLE', strategy: 'FRAME_TEMPLATE',
        calc: 'computeDetailSchedule1Rows', renderer: 'renderDetailScheduleTable',
        pagination: 'ROW_SPLIT', postprocess: 'OOXML_PATCH', merge: 'STANDARD',
        config: { variantBy: 'TEAM_TYPE', preSurveyOffsetDays: -7, overflow: 'NEW_SLIDE' },
        templates: [
          { variant: 'AUDIT_TEAM',   capacity: null },
          { variant: 'EXPERT_TEST',  capacity: null },
        ],
      },
      {
        parentKey: 'SECTION_SCHEDULE', code: 'AUDIT_PROCEDURE', name: '단계별 감리 수행 절차',
        number: '2.1', sort: 330, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_SCHEDULE', code: 'ACTION_CONFIRM_PROCEDURE', name: '시정조치확인 수행 절차',
        number: '3.1', sort: 340, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_SCHEDULE', code: 'ACTION_CONFIRM_STAFF', name: '시정조치확인 수행 인력',
        number: '3.2', sort: 350, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },

      // ── 라. 감리 인력 ──────────────────────────────────────────────
      {
        parentKey: 'SECTION_MANPOWER', code: 'MANPOWER_BASIS', name: '감리 인력 편성 근거',
        number: '1.1', sort: 410, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'ORGANIZATION', name: '감리 수행 조직',
        number: '1.2', sort: 420, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'ORGANIZATION_ROLE', name: '감리 조직별 역할',
        number: '1.3', sort: 430, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'MANPOWER_MD', name: '감리 인력 투입 공수',
        number: '1.4', sort: 440, enabled: 1,
        mode: 'BUILD_TABLE', strategy: 'FRAME_TEMPLATE',
        calc: 'computeManpowerMd', renderer: 'renderManpowerMdTable',
        pagination: 'ROW_SPLIT', postprocess: 'OOXML_PATCH', merge: 'STANDARD',
        config: { repeatUnit: 'MEMBER', dynamicColumns: 'PHASE', maxRowsPerSlide: 15, headerRepeat: true },
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'FULLTIME_RATIO', name: '상근 감리원 투입 비율',
        number: '1.5', sort: 450, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'PM_PROFILE_CAPABILITY', name: '총괄 감리원의 전문 역량',
        number: '2.1', sort: 460, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: 1 }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'PM_PROFILE_REQUIREMENTS', name: '총괄 감리원 자격 요건',
        number: '2.2', sort: 470, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: 1 }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'AUDITOR_PROFILE', name: '단계 감리원의 전문 역량',
        number: '3.1', sort: 480, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: 'computeAuditorProfiles', renderer: 'buildPhotoPptxFromTemplate',
        pagination: 'BEST_FIT', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: { variants: [2, 4, 6, 9], overflow: 'NEW_SLIDE', fillOrder: 'COLUMN_MAJOR', slotRemoval: true },
        templates: [
          { variant: 'PERSON_2', capacity: 2 },
          { variant: 'PERSON_4', capacity: 4 },
          { variant: 'PERSON_6', capacity: 6 },
          { variant: 'PERSON_9', capacity: 9 },
        ],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'CORE_EXPERT_PROFILE', name: '핵심기술 점검팀의 전문 역량',
        number: '3.2', sort: 490, enabled: 0,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: 'computeCoreExpertProfiles', renderer: 'buildPhotoPptxFromTemplate',
        pagination: 'BEST_FIT', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: { variants: [2, 4, 6, 9], overflow: 'NEW_SLIDE' },
        templates: [
          { variant: 'PERSON_2', capacity: 2 },
          { variant: 'PERSON_4', capacity: 4 },
          { variant: 'PERSON_6', capacity: 6 },
          { variant: 'PERSON_9', capacity: 9 },
        ],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'EXPERT_PROFILE', name: '필수기술, 보안 점검팀 및 테스트팀의 전문 역량',
        number: '3.3', sort: 500, enabled: 0,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: 'computeExpertProfiles', renderer: 'buildPhotoPptxFromTemplate',
        pagination: 'BEST_FIT', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: { variants: [2, 4, 6, 9], mergeCategories: true, categoryOrder: ['REQUIRED', 'SECURITY', 'TEST'] },
        templates: [
          { variant: 'PERSON_2', capacity: 2 },
          { variant: 'PERSON_4', capacity: 4 },
          { variant: 'PERSON_6', capacity: 6 },
          { variant: 'PERSON_9', capacity: 9 },
        ],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'AUDITOR_HISTORY', name: '감리원별 유사 감리 실적 및 경력, 자격',
        number: '3.4', sort: 510, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: 'computeAuditorHistory', renderer: 'cloneHistoryTemplate',
        pagination: 'CAPACITY_SPLIT', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: { repeatUnit: 'AUDITOR', historyLimit: 5, overflow: 'NEW_SLIDE' },
        templates: [{ variant: 'DEFAULT', capacity: 1 }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'EXPERT_HISTORY', name: '전문가별 유사 감리 실적 및 경력, 자격',
        number: '3.5', sort: 520, enabled: 0,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: 'computeExpertHistory', renderer: 'cloneHistoryTemplate',
        pagination: 'CAPACITY_SPLIT', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: { repeatUnit: 'EXPERT', historyLimit: 5, overflow: 'NEW_SLIDE' },
        templates: [{ variant: 'DEFAULT', capacity: 1 }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'CONTINUING_EDU', name: '참여 감리원 계속교육 이수 실적',
        number: '3.6', sort: 530, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_MANPOWER', code: 'MANPOWER_RATIO', name: '감리원 및 전문가 투입 비율',
        number: '3.7', sort: 540, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },

      // ── 마. 품질 및 지원 ───────────────────────────────────────────
      {
        parentKey: 'SECTION_QUALITY', code: 'QA_SYSTEM', name: '제안사 품질보증체계',
        number: '1.1', sort: 610, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'QA_MANAGEMENT', name: '감리 품질관리 수행 방안',
        number: '1.2', sort: 620, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'REPORT_QUALITY', name: '감리보고서 품질 지표 관리 방안',
        number: '1.3', sort: 630, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'DELIVERABLE_MGMT', name: '단계별 산출물 관리',
        number: '1.4', sort: 640, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'RESEARCH_SUPPORT', name: '제안사 연구 및 기술지원, 교육 수행 체계',
        number: '1.5', sort: 650, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'AUTO_TOOL_PLAN', name: '단계별 자동화 도구 적용 방안',
        number: '2.1', sort: 660, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'AUTO_TOOL_OBJECTIVITY', name: '자동화 도구 객관성·타당성 확보 방안',
        number: '2.2', sort: 670, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'AUTO_TOOL_DETAIL', name: '자동화 도구 적용 상세',
        number: '2.3', sort: 680, enabled: 0,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'ADDITIONAL_SUPPORT', name: '추가 지원 사항',
        number: '3.1', sort: 690, enabled: 0,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'CONSTANT_SUPPORT', name: '제안사 상시 지원 프로세스',
        number: '3.2', sort: 700, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'RISK_MANAGEMENT', name: '위험 관리',
        number: '3.3', sort: 710, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'SECURITY_MANAGEMENT', name: '감리 보안 관리',
        number: '3.4', sort: 720, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'SAFETY_HEALTH', name: '3.5 안전 및 보건 관리 등 비상 대책 수립 방안',
        number: '3.5', sort: 730, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_QUALITY', code: 'COMPLIANCE', name: '주관기관 요청사항 준수 여부',
        number: '3.6', sort: 740, enabled: 1,
        mode: 'BUILD_TABLE', strategy: 'FRAME_TEMPLATE',
        calc: 'computeSummaryTableData', renderer: 'renderComplianceTable',
        pagination: 'ROW_SPLIT', postprocess: 'OOXML_PATCH', merge: 'STANDARD',
        config: { headerRepeat: true, overflow: 'NEW_SLIDE' },
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },

      // ── 바. 제안사 소개 ────────────────────────────────────────────
      {
        parentKey: 'SECTION_COMPANY', code: 'COMPANY_OVERVIEW', name: '제안사 일반 현황',
        number: '1.1', sort: 810, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_COMPANY', code: 'FINANCIAL_CREDIT', name: '제안사 재무 현황 및 신용 등급',
        number: '1.2', sort: 820, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_COMPANY', code: 'COMPANY_ORG', name: '제안사 조직 및 인력 현황',
        number: '2.1', sort: 830, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_COMPANY', code: 'COMPANY_TECH', name: '주요 사업 분야 및 보유 기술',
        number: '3.1', sort: 840, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
      {
        parentKey: 'SECTION_COMPANY', code: 'COMPANY_PERFORMANCE', name: '제안사 사업 실적',
        number: '3.2', sort: 850, enabled: 1,
        mode: 'CLONE_SLIDE', strategy: 'PPTX_XML_TEMPLATE',
        calc: '', renderer: '',
        pagination: 'SINGLE', postprocess: 'NONE', merge: 'FOREIGN_TEMPLATE',
        config: {},
        templates: [{ variant: 'DEFAULT', capacity: null }],
      },
    ]

    let menuInserted = 0
    let ruleInserted = 0
    let tplInserted  = 0
    let compInserted = 0

    for (const m of MENUS) {
      const parentId = SEC[m.parentKey] ?? null

      // 메뉴 upsert
      await exec(`
        INSERT INTO ppt_menus (parent_id, menu_code, menu_name, menu_number, sort_order, is_enabled)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (menu_code) DO UPDATE
          SET parent_id=$1, menu_name=$3, menu_number=$4, sort_order=$5, updated_at=NOW()
      `, [parentId, m.code, m.name, m.number, m.sort, m.enabled])
      menuInserted++

      const menu = await queryOne<{ id: number }>(`SELECT id FROM ppt_menus WHERE menu_code=$1`, [m.code])
      if (!menu) continue

      // 생성규칙 upsert
      await exec(`
        INSERT INTO ppt_generation_rules
          (menu_id, generation_mode, template_strategy, calculator_code, renderer_code,
           pagination_mode, postprocess_mode, merge_strategy, rule_config)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (menu_id) DO UPDATE
          SET generation_mode=$2, template_strategy=$3, calculator_code=$4, renderer_code=$5,
              pagination_mode=$6, postprocess_mode=$7, merge_strategy=$8, rule_config=$9, updated_at=NOW()
      `, [menu.id, m.mode, m.strategy, m.calc, m.renderer,
          m.pagination, m.postprocess, m.merge, JSON.stringify(m.config)])
      ruleInserted++

      // 템플릿 upsert (variant별)
      for (const t of (m.templates ?? [])) {
        await exec(`
          INSERT INTO ppt_templates
            (menu_id, template_name, variant_code, capacity, version, is_default, is_active)
          VALUES ($1,$2,$3,$4,1,$5,1)
          ON CONFLICT (menu_id, variant_code, version) DO NOTHING
        `, [menu.id, `${m.name} [${t.variant}]`, t.variant, t.capacity ?? null,
            (m.templates?.indexOf(t) === 0) ? 1 : 0])
        tplInserted++
      }

      // ppt_compositions upsert
      await exec(`
        INSERT INTO ppt_compositions (proposal_type, menu_id, sort_order, is_required, is_enabled)
        VALUES ('DEFAULT', $1, $2, $3, $4)
        ON CONFLICT (proposal_type, menu_id) DO UPDATE
          SET sort_order=$2, is_required=$3, is_enabled=$4, updated_at=NOW()
      `, [menu.id, m.sort, m.enabled, m.enabled])
      compInserted++
    }

    return c.json({
      ok: true,
      message: `시드 완료 — 섹션 ${SECTIONS.length}개, 메뉴 ${menuInserted}개, 규칙 ${ruleInserted}개, 템플릿 ${tplInserted}개, 구성순서 ${compInserted}개`,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [3] 메뉴 CRUD
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-menus — 전체 메뉴 트리 (rule, templates 포함)
 *  ?category=proposal|attachment  (생략 시 전체) */
app.get('/', async (c) => {
  try {
    const cat = c.req.query('category') // 'proposal' | 'attachment' | undefined
    const menus = await query<{
      id: number; parent_id: number | null; menu_code: string; menu_name: string
      menu_number: string | null; sort_order: number; is_enabled: number; category: string
      build_kind: string | null; nas_path: string | null; variant_options: string | null
    }>(
      cat
        ? `SELECT * FROM ppt_menus WHERE category=$1 ORDER BY sort_order ASC, id ASC`
        : `SELECT * FROM ppt_menus ORDER BY sort_order ASC, id ASC`,
      cat ? [cat] : []
    )

    const rules = await query<{
      menu_id: number; generation_mode: string; template_strategy: string
      calculator_code: string; renderer_code: string; pagination_mode: string
      postprocess_mode: string; merge_strategy: string; rule_config: string
    }>(`SELECT * FROM ppt_generation_rules`)

    // pptx_b64_key 포함 — ppt-engine.js 템플릿 fallback용
    const templates = await query<{
      id: number; menu_id: number; template_name: string; variant_code: string
      capacity: number | null; is_default: number; is_active: number
      pptx_b64_key: string | null; pptx_file_path: string | null
    }>(`SELECT id, menu_id, template_name, variant_code, capacity, is_default, is_active,
              pptx_b64_key, pptx_file_path
       FROM ppt_templates WHERE is_active=1 ORDER BY is_default DESC, id ASC`)

    const ruleMap = Object.fromEntries(rules.map(r => [r.menu_id, r]))
    // 메뉴별 템플릿 배열 맵
    const tplMap: Record<number, typeof templates> = {}
    for (const t of templates) {
      if (!tplMap[t.menu_id]) tplMap[t.menu_id] = []
      tplMap[t.menu_id].push(t)
    }

    const enriched = menus.map(m => ({
      ...m,
      rule: ruleMap[m.id] ?? null,
      templates: tplMap[m.id] ?? [],
      template_count: (tplMap[m.id] ?? []).length,
    }))

    // 트리 변환
    const nodeMap: Record<number, typeof enriched[0] & { children: unknown[] }> = {}
    const roots: (typeof enriched[0] & { children: unknown[] })[] = []
    enriched.forEach(m => { nodeMap[m.id] = { ...m, children: [] } })
    enriched.forEach(m => {
      if (m.parent_id && nodeMap[m.parent_id]) nodeMap[m.parent_id].children.push(nodeMap[m.id])
      else roots.push(nodeMap[m.id])
    })

    return c.json({ ok: true, data: roots })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [A] 첨부 템플릿 시드 — BUNDLE_ITEM_DEFS 기반 메뉴 + 빈 템플릿 슬롯 생성
// ═══════════════════════════════════════════════════════════════════
/** POST /api/ppt-menus/attachment-seed
 *  첨부PPT 항목(표지, 일정표, 실적경력, 동의서 … 9종)을
 *  ppt_menus(category='attachment') + ppt_templates(빈 슬롯)로 등록.
 *  멱등(ON CONFLICT DO UPDATE)이므로 반복 실행 안전. */
app.post('/attachment-seed', async (c) => {
  try {
    // 첨부PPT 항목 정의 (attachment-bundle-widget.ts 의 BUNDLE_ITEM_DEFS 와 동일 순서).
    // kind: attachment-build-kind.ts의 3가지 분류 중 이 항목이 실제로 어떻게 만들어지는지
    // (2026-09-10 사용자 확인). 표지는 인력/이미지와 무관하게 텍스트만 치환해 셋 중 어디에도
    // 안 맞으므로 null로 둔다.
    const ITEMS: { code: string; name: string; sort: number; kind: AttachmentBuildKind | null }[] = [
      { code: 'ATT_COVER',        name: '0. 정성제안서 첨부 표지',       sort:  0, kind: null },
      { code: 'ATT_SCHEDULE',     name: '감리원 일정 현황표',             sort: 10, kind: 'SHARED_TABLE' },
      { code: 'ATT_CAREER',       name: '투입 감리원별 실적 및 경력',     sort: 20, kind: 'PERSON_PAGES' },
      { code: 'ATT_CONSENT',      name: '비상근 감리원 참여 동의서',      sort: 30, kind: 'PERSON_PAGES' },
      { code: 'ATT_STAMP_NO',     name: '범용 템플릿(도장X)',             sort: 40, kind: 'IMAGE_REPLACE' },
      { code: 'ATT_STAMP_YES',    name: '범용 템플릿(도장O)',             sort: 50, kind: 'IMAGE_REPLACE' },
      { code: 'ATT_EMPLOYMENT',   name: '재직증명서',                     sort: 60, kind: 'PERSON_PAGES' },
      { code: 'ATT_CAREER_CERT',  name: '경력증명서',                     sort: 70, kind: 'PERSON_PAGES' },
      { code: 'ATT_STAFFING',     name: '상근감리원인력현황',             sort: 80, kind: 'SHARED_TABLE' },
    ]
    const created: string[] = []
    const idByCode: Record<string, number> = {}
    for (const item of ITEMS) {
      // 1. 메뉴 upsert
      const menu = await queryOne<{ id: number }>(`
        INSERT INTO ppt_menus (menu_code, menu_name, sort_order, is_enabled, category, build_kind)
        VALUES ($1, $2, $3, 1, 'attachment', $4)
        ON CONFLICT (menu_code) DO UPDATE
          SET menu_name=$2, sort_order=$3, category='attachment', build_kind=$4, updated_at=NOW()
        RETURNING id
      `, [item.code, item.name, item.sort, item.kind])
      if (!menu) continue
      idByCode[item.code] = menu.id
      // 2. 빈 템플릿 슬롯 upsert (pptx_b64_key=NULL 인 채로 자리만 만들어 둠)
      await exec(`
        INSERT INTO ppt_templates (menu_id, template_name, variant_code, is_default, is_active)
        VALUES ($1, $2, 'DEFAULT', 1, 1)
        ON CONFLICT (menu_id, variant_code, version) DO UPDATE
          SET template_name=$2, updated_at=NOW()
      `, [menu.id, item.name])
      created.push(item.code)
    }

    // "범용 템플릿(도장O/도장X)" 슬롯 하나를 실제로 쓰는 첨부서류들 — 각자 NAS의 어느 경로에서
    // 원본을 가져오는지(src/lib/nas-client.ts의 경로 상수를 초기값으로 그대로 옮겨 적음).
    // parent_id로 슬롯에 매달아두면 "PPT 템플릿 관리 → 첨부 → 이미지 치환" 탭에서 그 슬롯을
    // 열었을 때 "이 템플릿을 사용하는 첨부서류" 목록으로 보여줄 수 있고, nas_path/menu_name을
    // 관리자가 직접 수정하면 실제 생성 로직도 그 값을 그대로 쓴다(2026-09-10 사용자 확인 —
    // "이름, 경로 수정이 가능해야 해... 변경 후에 실제 PPT 만드는 모달에서 바로 쓸 수 있도록").
    // 템플릿 파일 자체는 부모 슬롯 것을 공유하므로 이 자식 메뉴들은 자기 ppt_templates가 없다.
    const CHILD_ITEMS = [
      { code: 'ATT_FINANCIAL',    name: '표준재무제표',       parentCode: 'ATT_STAMP_NO',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/18.표준재무제표' },
      { code: 'ATT_BIZREG',       name: '사업자등록증',       parentCode: 'ATT_STAMP_YES',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/01.사업자등록증' },
      { code: 'ATT_TAXCERT',      name: '국세 납세증명서',     parentCode: 'ATT_STAMP_YES',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/11.국세 납세증명서' },
      { code: 'ATT_LOCALTAXCERT', name: '지방세 납세증명서',   parentCode: 'ATT_STAMP_YES',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/12.지방세 납세증명서' },
      { code: 'ATT_CORPREGISTRY', name: '법인등기부등본',      parentCode: 'ATT_STAMP_YES',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/07.법인등기부등본',
        // "말소사항 포함/미포함" — 예전엔 이 항목 하나만을 위한 전용 UI/코드(corpRegistryIncludeCancelled)
        // 였는데, "+"로 추가한 항목도 쓸 수 있는 범용 variant_options로 통일했다(2026-09-11
        // 사용자 확인 — "각 템플릿에 변수명 추가하라고 한건... 동일하게 첨부가 만들어지길").
        variantOptions: [
          { label: '말소사항포함', includes: '말소사항포함' },
          { label: '말소사항미포함', excludes: '말소사항포함' },
        ] },
      { code: 'ATT_INSURANCE',    name: '4대보험 가입확인서',  parentCode: 'ATT_STAMP_YES',
        nasPath: '/activo/04.제안팀/99.악티보포털참조용/01.회사/14.4대 사회보험 사업장 가입자명부' },
    ]
    for (let i = 0; i < CHILD_ITEMS.length; i++) {
      const child = CHILD_ITEMS[i] as typeof CHILD_ITEMS[number] & { variantOptions?: unknown[] }
      const parentId = idByCode[child.parentCode]
      if (!parentId) continue
      // ON CONFLICT는 menu_code UNIQUE 제약을 그대로 쓴다 — 이미 있으면 이름은 그대로 두고
      // (관리자가 고쳐뒀을 수 있으니) parent_id/build_kind/category만 맞춰준다. nas_path/
      // variant_options는 최초 생성 시에만 기본값을 넣고, 이미 있으면 관리자가 수정한 값을
      // 덮어쓰지 않는다.
      const variantOptionsJson = child.variantOptions && child.variantOptions.length ? JSON.stringify(child.variantOptions) : null
      await exec(`
        INSERT INTO ppt_menus (menu_code, menu_name, parent_id, sort_order, is_enabled, category, build_kind, nas_path, variant_options)
        VALUES ($1, $2, $3, $4, 1, 'attachment', 'IMAGE_REPLACE', $5, $6)
        ON CONFLICT (menu_code) DO UPDATE
          SET parent_id=$3, category='attachment', build_kind='IMAGE_REPLACE', updated_at=NOW()
      `, [child.code, child.name, parentId, (i + 1) * 10, child.nasPath, variantOptionsJson])
      created.push(child.code)
    }

    return c.json({ ok: true, created })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-menus/restore — 프리셋 복원용: 원본 id로 메뉴 + rule 한번에 upsert */
app.post('/restore', async (c) => {
  try {
    const body = await c.req.json()
    const { id, parent_id, menu_code, menu_name, menu_number, sort_order, is_enabled, rule } = body
    if (!id || !menu_code || !menu_name) return c.json({ ok: false, error: 'id, menu_code, menu_name 필수' }, 400)

    // 메뉴 upsert (원본 id 보존)
    await exec(`
      INSERT INTO ppt_menus (id, parent_id, menu_code, menu_name, menu_number, sort_order, is_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE
        SET parent_id=$2, menu_code=$3, menu_name=$4, menu_number=$5,
            sort_order=$6, is_enabled=$7, updated_at=NOW()
    `, [id, parent_id ?? null, menu_code, menu_name, menu_number ?? null, sort_order ?? 0, is_enabled ?? 1])

    // rule upsert (있을 때만)
    if (rule) {
      const { generation_mode, template_strategy, calculator_code, renderer_code,
              pagination_mode, postprocess_mode, merge_strategy, rule_config } = rule
      await exec(`
        INSERT INTO ppt_generation_rules
          (menu_id, generation_mode, template_strategy, calculator_code, renderer_code,
           pagination_mode, postprocess_mode, merge_strategy, rule_config)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (menu_id) DO UPDATE
          SET generation_mode=$2, template_strategy=$3, calculator_code=$4, renderer_code=$5,
              pagination_mode=$6, postprocess_mode=$7, merge_strategy=$8, rule_config=$9, updated_at=NOW()
      `, [id, generation_mode, template_strategy, calculator_code, renderer_code,
          pagination_mode, postprocess_mode, merge_strategy,
          typeof rule_config === 'object' ? JSON.stringify(rule_config) : rule_config])
    }

    return c.json({ ok: true, restored: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** POST /api/ppt-menus
 *  category('proposal'|'attachment', 생략 시 기존처럼 컬럼 기본값 'proposal')와 build_kind
 *  (attachment 항목일 때만 의미 있음, attachment-build-kind.ts 참고)를 새로 받는다 —
 *  PPT 템플릿 관리 첨부 탭의 "항목 추가"가 category='attachment'로 호출한다. nas_path는
 *  build_kind='IMAGE_REPLACE' 항목("이미지 치환" 슬롯 밑의 첨부서류)일 때 그 서류의 NAS
 *  원본 폴더 경로 — "+"로 새로 추가할 때 이름과 함께 여기로 들어온다(2026-09-10 사용자
 *  확인 — "이 탭에서 + 누르고 이름과 경로만 입력하면 쓸 수 있도록"). */
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { parent_id, menu_code, menu_name, menu_number, sort_order, is_enabled, category, build_kind, nas_path, variant_options } = body
    if (build_kind != null && !isAttachmentBuildKind(build_kind)) {
      return c.json({ ok: false, error: `알 수 없는 build_kind: ${build_kind}` }, 400)
    }
    const variantOptionsJson = Array.isArray(variant_options) && variant_options.length ? JSON.stringify(variant_options) : null
    const row = await queryOne<{ id: number }>(`
      INSERT INTO ppt_menus (parent_id, menu_code, menu_name, menu_number, sort_order, is_enabled, category, build_kind, nas_path, variant_options)
      VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7,'proposal'), $8, $9, $10) RETURNING id
    `, [parent_id ?? null, menu_code, menu_name, menu_number ?? null, sort_order ?? 0, is_enabled ?? 1, category ?? null, build_kind ?? null, nas_path ?? null, variantOptionsJson])
    return c.json({ ok: true, id: row?.id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** PUT /api/ppt-menus/:id
 *  build_kind/nas_path도 갱신 가능(생략하면 기존 값 유지) — 첨부 탭에서 항목의 분류를
 *  바꾸거나, "이미지 치환" 첨부서류의 이름/NAS 경로를 수정할 때 씀(2026-09-10 사용자
 *  확인 — "이름, 경로 수정이 가능해야 해"). */
app.put('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const { menu_name, menu_number, sort_order, is_enabled, parent_id, build_kind, nas_path, variant_options } = body
    if (build_kind !== undefined && build_kind !== null && !isAttachmentBuildKind(build_kind)) {
      return c.json({ ok: false, error: `알 수 없는 build_kind: ${build_kind}` }, 400)
    }
    // variant_options는 "안 보냄"(다른 모달에서 이름/분류만 바꿀 때)과 "빈 배열로 보냄"
    // (관리자가 옵션을 전부 지웠을 때)을 구분해야 해서 COALESCE 대신 직접 분기한다.
    if (variant_options !== undefined) {
      const variantOptionsJson = Array.isArray(variant_options) && variant_options.length ? JSON.stringify(variant_options) : null
      await exec(`
        UPDATE ppt_menus
        SET menu_name=$1, menu_number=$2, sort_order=$3, is_enabled=$4, parent_id=$5,
            build_kind=COALESCE($6, build_kind), nas_path=COALESCE($8, nas_path),
            variant_options=$9, updated_at=NOW()
        WHERE id=$7
      `, [menu_name, menu_number ?? null, sort_order ?? 0, is_enabled ?? 1, parent_id ?? null, build_kind ?? null, id, nas_path || null, variantOptionsJson])
    } else {
      await exec(`
        UPDATE ppt_menus
        SET menu_name=$1, menu_number=$2, sort_order=$3, is_enabled=$4, parent_id=$5,
            build_kind=COALESCE($6, build_kind), nas_path=COALESCE($8, nas_path),
            updated_at=NOW()
        WHERE id=$7
      `, [menu_name, menu_number ?? null, sort_order ?? 0, is_enabled ?? 1, parent_id ?? null, build_kind ?? null, id, nas_path || null])
    }
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** DELETE /api/ppt-menus/:id */
app.delete('/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    await exec(`DELETE FROM ppt_menus WHERE id=$1`, [id])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [4] 생성 규칙 CRUD
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-menus/:id/rule */
app.get('/:id/rule', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const row = await queryOne(`SELECT * FROM ppt_generation_rules WHERE menu_id=$1`, [id])
    return c.json({ ok: true, data: row ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** PUT /api/ppt-menus/:id/rule — upsert */
app.put('/:id/rule', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()
    const {
      generation_mode, template_strategy, calculator_code, renderer_code,
      pagination_mode, postprocess_mode, merge_strategy, rule_config,
      target_layout_name,
    } = body
    await exec(`
      INSERT INTO ppt_generation_rules
        (menu_id, generation_mode, template_strategy, calculator_code, renderer_code,
         pagination_mode, postprocess_mode, merge_strategy, rule_config, target_layout_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (menu_id) DO UPDATE
        SET generation_mode=$2, template_strategy=$3, calculator_code=$4, renderer_code=$5,
            pagination_mode=$6, postprocess_mode=$7, merge_strategy=$8, rule_config=$9,
            target_layout_name=$10, updated_at=NOW()
    `, [id, generation_mode, template_strategy, calculator_code, renderer_code,
        pagination_mode, postprocess_mode, merge_strategy,
        typeof rule_config === 'object' ? JSON.stringify(rule_config) : rule_config,
        target_layout_name ?? null])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [5] 템플릿 CRUD
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-menus/:id/templates */
app.get('/:id/templates', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const rows = await query(`
      SELECT t.*, COUNT(e.id) AS element_count
      FROM ppt_templates t
      LEFT JOIN ppt_template_elements e ON e.template_id = t.id
      WHERE t.menu_id=$1
      GROUP BY t.id
      ORDER BY t.variant_code, t.version DESC
    `, [id])
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-menus/:id/templates — multipart/form-data 파일 업로드 */
app.post('/:id/templates', async (c) => {
  try {
    const menuId = Number(c.req.param('id'))
    const contentType = c.req.header('content-type') || ''

    let template_name: string
    let variant_code: string
    let capacity: number | null
    let pptx_b64_key: string | null = null
    let pptx_file_path: string | null = null

    if (contentType.includes('multipart/form-data')) {
      // ── 파일 업로드 경로 ──────────────────────────────────────
      const form = await c.req.formData()
      template_name = String(form.get('template_name') ?? '')
      variant_code  = String(form.get('variant_code')  ?? 'DEFAULT') || 'DEFAULT'
      capacity      = form.get('capacity') ? Number(form.get('capacity')) : null
      const file = form.get('pptx_file') as File | null
      if (file && file.size > 0) {
        // 파일을 ArrayBuffer → Base64로 인코딩하여 pptx_b64_key 컬럼에 저장
        const buf    = await file.arrayBuffer()
        const bytes  = new Uint8Array(buf)
        let binary   = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const b64 = btoa(binary)
        // 저장 키: "FILE:<원본파일명>:<업로드타임스탬프>"
        pptx_b64_key  = b64
        pptx_file_path = file.name
      }
    } else {
      // ── JSON 경로 (하위 호환) ─────────────────────────────────
      const body = await c.req.json()
      template_name  = body.template_name
      variant_code   = body.variant_code ?? 'DEFAULT'
      capacity       = body.capacity ?? null
      pptx_b64_key   = body.pptx_b64_key ?? null
      pptx_file_path = body.pptx_file_path ?? null
    }

    if (!template_name) return c.json({ ok: false, error: '템플릿 이름은 필수입니다' }, 400)

    const row = await queryOne<{ id: number }>(`
      INSERT INTO ppt_templates
        (menu_id, template_name, variant_code, pptx_b64_key, pptx_file_path, capacity, is_default, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,1,1)
      ON CONFLICT (menu_id, variant_code, version) DO UPDATE
        SET template_name  = EXCLUDED.template_name,
            pptx_b64_key   = EXCLUDED.pptx_b64_key,
            pptx_file_path = EXCLUDED.pptx_file_path,
            capacity       = EXCLUDED.capacity,
            is_active      = 1
      RETURNING id
    `, [menuId, template_name, variant_code, pptx_b64_key, pptx_file_path, capacity ?? null])
    return c.json({ ok: true, id: row?.id, file_name: pptx_file_path })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** PUT /api/ppt-templates/:tid */
app.put('/templates/:tid', async (c) => {
  try {
    const tid = Number(c.req.param('tid'))
    const body = await c.req.json()
    const { template_name, variant_code, pptx_b64_key, capacity, slide_count, is_default, is_active, metadata } = body
    await exec(`
      UPDATE ppt_templates
      SET template_name=$1, variant_code=$2, pptx_b64_key=$3, capacity=$4,
          slide_count=$5, is_default=$6, is_active=$7, metadata=$8, updated_at=NOW()
      WHERE id=$9
    `, [template_name, variant_code, pptx_b64_key ?? null, capacity ?? null,
        slide_count ?? null, is_default ?? 1, is_active ?? 1,
        metadata ? JSON.stringify(metadata) : null, tid])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** DELETE /api/ppt-templates/:tid */
app.delete('/templates/:tid', async (c) => {
  try {
    const tid = Number(c.req.param('tid'))
    await exec(`DELETE FROM ppt_templates WHERE id=$1`, [tid])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** DELETE /api/ppt-templates/:tid/file — 파일(b64)만 지우고 슬롯 레코드 유지 */
app.delete('/templates/:tid/file', async (c) => {
  try {
    const tid = Number(c.req.param('tid'))
    await exec(`UPDATE ppt_templates SET pptx_b64_key=NULL, pptx_file_path=NULL WHERE id=$1`, [tid])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [6] 구성순서 (ppt_compositions) CRUD
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-compositions?type=DEFAULT */
app.get('/compositions', async (c) => {
  try {
    const type = c.req.query('type') ?? 'DEFAULT'
    const rows = await query(`
      SELECT pc.*, m.menu_code, m.menu_name, m.menu_number, m.sort_order AS menu_sort
      FROM ppt_compositions pc
      JOIN ppt_menus m ON m.id = pc.menu_id
      WHERE pc.proposal_type = $1
      ORDER BY pc.sort_order ASC
    `, [type])
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-compositions */
app.post('/compositions', async (c) => {
  try {
    const body = await c.req.json()
    const { proposal_type, menu_id, sort_order, is_required, condition_code, is_enabled } = body
    const row = await queryOne<{ id: number }>(`
      INSERT INTO ppt_compositions
        (proposal_type, menu_id, sort_order, is_required, condition_code, is_enabled)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (proposal_type, menu_id) DO UPDATE
        SET sort_order=$3, is_required=$4, condition_code=$5, is_enabled=$6, updated_at=NOW()
      RETURNING id
    `, [proposal_type ?? 'DEFAULT', menu_id, sort_order ?? 0,
        is_required ?? 1, condition_code ?? null, is_enabled ?? 1])
    return c.json({ ok: true, id: row?.id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** PUT /api/ppt-compositions/:cid */
app.put('/compositions/:cid', async (c) => {
  try {
    const cid = Number(c.req.param('cid'))
    const body = await c.req.json()
    const { sort_order, is_required, condition_code, is_enabled } = body
    await exec(`
      UPDATE ppt_compositions
      SET sort_order=$1, is_required=$2, condition_code=$3, is_enabled=$4, updated_at=NOW()
      WHERE id=$5
    `, [sort_order ?? 0, is_required ?? 1, condition_code ?? null, is_enabled ?? 1, cid])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** DELETE /api/ppt-compositions/:cid */
app.delete('/compositions/:cid', async (c) => {
  try {
    const cid = Number(c.req.param('cid'))
    await exec(`DELETE FROM ppt_compositions WHERE id=$1`, [cid])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-compositions/reorder — [{id, sort_order}, …] 일괄 변경 */
app.post('/compositions/reorder', async (c) => {
  try {
    const body = await c.req.json() as Array<{ id: number; sort_order: number }>
    for (const item of body) {
      await exec(
        `UPDATE ppt_compositions SET sort_order=$1, updated_at=NOW() WHERE id=$2`,
        [item.sort_order, item.id]
      )
    }
    return c.json({ ok: true, updated: body.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [8] 프리셋 CRUD  /api/ppt-menus/presets
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-menus/presets — 전체 목록 (snapshot 제외, 목록용) */
app.get('/presets', async (c) => {
  try {
    const rows = await query(`
      SELECT id, name, menu_count, created_at, updated_at
      FROM ppt_presets ORDER BY created_at DESC
    `)
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** GET /api/ppt-menus/presets/:id — snapshot 포함 단건 조회 */
app.get('/presets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    const row = await queryOne(`SELECT * FROM ppt_presets WHERE id=$1`, [id])
    if (!row) return c.json({ ok: false, error: 'not found' }, 404)
    return c.json({ ok: true, data: row })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-menus/presets — 새 프리셋 저장 */
app.post('/presets', async (c) => {
  try {
    const { name, snapshot } = await c.req.json()
    if (!name || !Array.isArray(snapshot)) return c.json({ ok: false, error: 'name, snapshot 필수' }, 400)
    const row = await queryOne<{ id: number }>(`
      INSERT INTO ppt_presets (name, menu_count, snapshot)
      VALUES ($1, $2, $3) RETURNING id
    `, [name, snapshot.length, JSON.stringify(snapshot)])
    return c.json({ ok: true, id: row?.id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** DELETE /api/ppt-menus/presets/:id — 프리셋 삭제 */
app.delete('/presets/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    await exec(`DELETE FROM ppt_presets WHERE id=$1`, [id])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════
// [9] 마스터 템플릿 CRUD
//     GET    /api/ppt-menus/master-templates         — 목록 (pptx_b64 제외)
//     GET    /api/ppt-menus/master-templates/active  — 활성 마스터 단건 (pptx_b64 포함)
//     POST   /api/ppt-menus/master-templates         — 업로드 (multipart/form-data)
//     PUT    /api/ppt-menus/master-templates/:id/activate — 활성 마스터 변경
//     DELETE /api/ppt-menus/master-templates/:id     — 삭제
// ═══════════════════════════════════════════════════════════════════

/** GET /api/ppt-menus/master-templates — 목록 (pptx_b64 제외, 용량 절약) */
app.get('/master-templates', async (c) => {
  try {
    const rows = await query(`
      SELECT id, name, description, layouts, is_active, created_at
      FROM ppt_master_templates
      ORDER BY is_active DESC, created_at DESC
    `)
    return c.json({ ok: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** GET /api/ppt-menus/master-templates/active — 현재 활성 마스터 (pptx_b64 포함) */
app.get('/master-templates/active', async (c) => {
  try {
    const row = await queryOne(`
      SELECT id, name, description, pptx_b64, layouts, is_active, created_at
      FROM ppt_master_templates
      WHERE is_active = 1
      ORDER BY created_at DESC LIMIT 1
    `)
    return c.json({ ok: true, data: row ?? null })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** POST /api/ppt-menus/master-templates — 업로드 */
app.post('/master-templates', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const name = (formData.get('name') as string | null)?.trim() || ''
    const description = (formData.get('description') as string | null)?.trim() || ''
    const setActive = formData.get('set_active') === '1' || formData.get('set_active') === 'true'

    if (!file || !name) return c.json({ ok: false, error: 'file, name 필수' }, 400)

    // 파일 → base64
    const buf = Buffer.from(await file.arrayBuffer())
    const b64 = buf.toString('base64')

    // PPTX(ZIP)에서 레이아웃 이름 추출
    const layouts = extractLayoutNamesFromPptx(buf)

    // 활성으로 설정 시 기존 활성 해제
    if (setActive) {
      await exec(`UPDATE ppt_master_templates SET is_active = 0, updated_at = NOW()`)
    }

    const row = await queryOne<{ id: number }>(`
      INSERT INTO ppt_master_templates (name, description, pptx_b64, layouts, is_active)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [name, description, b64, JSON.stringify(layouts), setActive ? 1 : 0])

    return c.json({ ok: true, id: row?.id, layouts })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 400)
  }
})

/** PUT /api/ppt-menus/master-templates/:id/activate — 활성 마스터 변경 */
app.put('/master-templates/:id/activate', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    // 전체 비활성화 후 선택된 것만 활성화
    await exec(`UPDATE ppt_master_templates SET is_active = 0, updated_at = NOW()`)
    await exec(`UPDATE ppt_master_templates SET is_active = 1, updated_at = NOW() WHERE id = $1`, [id])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

/** DELETE /api/ppt-menus/master-templates/:id — 삭제 */
app.delete('/master-templates/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    await exec(`DELETE FROM ppt_master_templates WHERE id = $1`, [id])
    return c.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

export default app
