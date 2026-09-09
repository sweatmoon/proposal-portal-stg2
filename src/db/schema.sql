-- ============================================================
-- PostgreSQL 마이그레이션 (D1/SQLite → PostgreSQL 변환)
-- 실행: tsx src/db/migrate.ts
-- ============================================================

-- ──────────────────────────────────────────
-- 1. personnel (인력 기본정보)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel (
  id                  SERIAL PRIMARY KEY,
  name                TEXT    NOT NULL UNIQUE,
  position            TEXT,
  is_fulltime         INTEGER NOT NULL DEFAULT 1,
  company             TEXT,
  email               TEXT    UNIQUE,
  phone               TEXT,
  birthdate           TEXT,
  auditor_cert_no     TEXT,
  auditor_grade       TEXT,
  tech_grade          TEXT,
  auditor_career_yrs  REAL    DEFAULT 0,
  auditor_start_date  TEXT,
  school              TEXT,
  major               TEXT,
  degree              TEXT,
  career_summary      TEXT,
  career_qualif       TEXT,
  career_project      TEXT,
  career_expert       TEXT,
  education_name      TEXT,
  education_hours     INTEGER DEFAULT 0,
  education_org       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 2. personnel_certifications (자격증)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel_certifications (
  id              SERIAL PRIMARY KEY,
  personnel_id    INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  cert_name       TEXT    NOT NULL,
  cert_year       TEXT,
  issuer          TEXT,
  is_national     INTEGER DEFAULT 1,
  related_field   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 3. personnel_audit_history (감리실적)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel_audit_history (
  id               SERIAL PRIMARY KEY,
  personnel_id     INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  audit_yearmonth  TEXT    NOT NULL,
  project_name     TEXT    NOT NULL,
  client_org       TEXT,
  sector           TEXT,
  domain           TEXT,
  role             TEXT,
  phase            TEXT,
  participation_rate INTEGER DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 4. personnel_it_career (감리 이외의 IT 경력)
--    프로파일 HTML "2. 감리 이외의 IT 경력" 표 그대로 — 기간(년)|경력|담당 업무|
--    유사 경력의 근거 4열뿐이라, 안 쓰는 컬럼(예전 client_org/role/company)은 없앴다
--    (2026-09-09 — 예전엔 이 표 대신 "3. 프로젝트 및 기타 경력"이 잘못 적재되고
--    있었는데, 그 표에서만 쓰이던 컬럼이 여기 찌꺼기로 남아있었음).
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel_it_career (
  id              SERIAL PRIMARY KEY,
  personnel_id    INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  period_start    TEXT,
  period_end      TEXT,
  career          TEXT    NOT NULL,
  duty            TEXT,
  basis           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 라이브 DB에 이미 있던 테이블은 CREATE TABLE IF NOT EXISTS로 안 바뀌므로,
-- 컬럼 이름 변경/삭제를 직접 적용한다. 한 번 적용되면 이후 재실행 시 대상 컬럼이
-- 이미 없어서 조용히 건너뛴다(멱등).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'personnel_it_career' AND column_name = 'project_name') THEN
    ALTER TABLE personnel_it_career RENAME COLUMN project_name TO career;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'personnel_it_career' AND column_name = 'domain') THEN
    ALTER TABLE personnel_it_career RENAME COLUMN domain TO duty;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'personnel_it_career' AND column_name = 'remarks') THEN
    ALTER TABLE personnel_it_career RENAME COLUMN remarks TO basis;
  END IF;
END $$;
ALTER TABLE personnel_it_career DROP COLUMN IF EXISTS client_org;
ALTER TABLE personnel_it_career DROP COLUMN IF EXISTS role;
ALTER TABLE personnel_it_career DROP COLUMN IF EXISTS company;

-- ──────────────────────────────────────────
-- 4-1. personnel_project_career (프로젝트 및 기타 경력) — 신규
--    프로파일 HTML "3. 프로젝트 및 기타 경력" 표 그대로 — 연도|프로젝트명|주관 기관|
--    담당 분야|역할|소속 회사|비고 7열. 아직 파싱/저장 로직은 안 붙였고(2026-09-09),
--    테이블만 먼저 만들어 둔 상태.
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personnel_project_career (
  id              SERIAL PRIMARY KEY,
  personnel_id    INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  year_range      TEXT,
  project_name    TEXT    NOT NULL,
  client_org      TEXT,
  domain          TEXT,
  role            TEXT,
  company         TEXT,
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 5. audit_projects (감리 사업)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_projects (
  id                      SERIAL PRIMARY KEY,
  project_name            TEXT    NOT NULL UNIQUE,
  bid_notice_no           TEXT,
  client_org              TEXT,
  registered_yearmonth    TEXT,
  target_project_name     TEXT,
  target_client_org       TEXT,
  target_contractor       TEXT,
  target_budget           BIGINT,
  target_period_start     TEXT,
  target_period_end       TEXT,
  target_keywords         TEXT,
  keyword_mapping         TEXT,
  bid_amount              BIGINT,
  bid_amount_excl_vat     BIGINT,
  bid_rate                REAL,
  base_budget             BIGINT,
  bid_deadline            TEXT,
  bid_open_dt             TEXT,
  eval_dt                 TEXT,
  travel_cost_per_md      INTEGER DEFAULT 0,
  required_md             INTEGER,
  proposed_md             INTEGER,
  optimal_md              INTEGER,
  md_unit_price_incl      INTEGER,
  md_unit_price_excl      INTEGER,
  base_unit_price         INTEGER,
  proposal_allowance      BIGINT,
  proposal_allowance_rate REAL,
  required_phases         INTEGER,
  required_audit_days     INTEGER,
  eval_method             TEXT,
  proposal_status         TEXT,
  writer                  TEXT,
  director                TEXT,
  supporters              TEXT,
  references_cc           TEXT,
  special_notes           TEXT,
  remarks                 TEXT,
  proposal_template       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 6. audit_phases (감리 단계)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_phases (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  phase_name          TEXT    NOT NULL,
  phase_days          INTEGER,
  phase_start_date    TEXT,
  phase_end_date      TEXT,
  phase_order         INTEGER DEFAULT 0,
  total_auditor_cnt   INTEGER DEFAULT 0,
  total_expert_cnt    INTEGER DEFAULT 0,
  pre_survey_md       INTEGER DEFAULT 0,
  audit_md            INTEGER DEFAULT 0,
  action_confirm_md   INTEGER DEFAULT 0,
  proposed_md         INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 7. audit_phase_assignments (단계별 인력 배정)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_phase_assignments (
  id                SERIAL PRIMARY KEY,
  phase_id          INTEGER NOT NULL REFERENCES audit_phases(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  personnel_id      INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  person_name       TEXT    NOT NULL,
  member_type       TEXT    NOT NULL DEFAULT '감리원',
  domain            TEXT,
  pre_survey_md     INTEGER DEFAULT 0,
  audit_md          INTEGER DEFAULT 0,
  action_confirm_md INTEGER DEFAULT 0,
  -- total_md는 GENERATED 대신 일반 컬럼으로 (PostgreSQL 호환)
  total_md          INTEGER GENERATED ALWAYS AS (pre_survey_md + audit_md + action_confirm_md) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 8. proposal_members (제안 인력)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_members (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  personnel_id      INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
  person_name       TEXT    NOT NULL,
  member_group      TEXT,
  member_type       TEXT    NOT NULL DEFAULT '감리원',
  domain            TEXT,
  regular_md        INTEGER DEFAULT 0,
  additional_md     INTEGER DEFAULT 0,
  acceptance_md     INTEGER DEFAULT 0,
  total_md          INTEGER GENERATED ALWAYS AS (regular_md + additional_md + acceptance_md) STORED,
  is_fulltime       INTEGER DEFAULT 1,
  auditor_grade     TEXT,
  auditor_cert_no   TEXT,
  phone             TEXT,
  education_hours   INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 9. proposal_files (제안 파일)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_files (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  file_category   TEXT,
  file_name       TEXT    NOT NULL,
  file_size_kb    REAL,
  uploaded_at     TEXT,
  file_type       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 10. proposal_attachments_toc (첨부 목차)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_attachments_toc (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  item_order  INTEGER NOT NULL,
  item_name   TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 11. keywords (키워드)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  keyword     TEXT    NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, keyword)
);

-- ──────────────────────────────────────────
-- 12. keyword_mappings (키워드 매핑)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keyword_mappings (
  id               SERIAL PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  keyword_id       INTEGER REFERENCES keywords(id) ON DELETE SET NULL,
  original_keyword TEXT    NOT NULL,
  mapped_keyword   TEXT    NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, original_keyword, mapped_keyword)
);

-- ──────────────────────────────────────────
-- 인덱스
-- ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_personnel_name             ON personnel(name);
CREATE INDEX IF NOT EXISTS idx_personnel_auditor_grade    ON personnel(auditor_grade);
CREATE INDEX IF NOT EXISTS idx_audit_history_personnel    ON personnel_audit_history(personnel_id);
CREATE INDEX IF NOT EXISTS idx_audit_history_yearmonth    ON personnel_audit_history(audit_yearmonth);
CREATE INDEX IF NOT EXISTS idx_it_career_personnel        ON personnel_it_career(personnel_id);
CREATE INDEX IF NOT EXISTS idx_project_career_personnel   ON personnel_project_career(personnel_id);
CREATE INDEX IF NOT EXISTS idx_certifications_personnel   ON personnel_certifications(personnel_id);
CREATE INDEX IF NOT EXISTS idx_audit_projects_name        ON audit_projects(project_name);
CREATE INDEX IF NOT EXISTS idx_audit_projects_status      ON audit_projects(proposal_status);
CREATE INDEX IF NOT EXISTS idx_audit_phases_project       ON audit_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_phase_assignments_phase    ON audit_phase_assignments(phase_id);
CREATE INDEX IF NOT EXISTS idx_phase_assignments_person   ON audit_phase_assignments(personnel_id);
CREATE INDEX IF NOT EXISTS idx_proposal_members_project   ON proposal_members(project_id);
CREATE INDEX IF NOT EXISTS idx_proposal_members_person    ON proposal_members(personnel_id);
CREATE INDEX IF NOT EXISTS idx_proposal_files_project     ON proposal_files(project_id);
CREATE INDEX IF NOT EXISTS idx_keywords_project           ON keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_kwmap_project              ON keyword_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_kwmap_keyword              ON keyword_mappings(keyword_id);

-- ──────────────────────────────────────────
-- 13. ppt_menus (PPT 목차/메뉴 관리)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ppt_menus (
  id          SERIAL PRIMARY KEY,
  parent_id   INTEGER REFERENCES ppt_menus(id) ON DELETE SET NULL,
  menu_code   TEXT    NOT NULL UNIQUE,
  menu_name   TEXT    NOT NULL,
  menu_number TEXT,                         -- "다-1", "라-3" 등 목차 번호
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_enabled  INTEGER NOT NULL DEFAULT 1,   -- 1=사용, 0=미사용
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 14. ppt_templates (메뉴별 PPTX 템플릿)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ppt_templates (
  id              SERIAL PRIMARY KEY,
  menu_id         INTEGER NOT NULL REFERENCES ppt_menus(id) ON DELETE CASCADE,
  template_name   TEXT    NOT NULL,
  variant_code    TEXT    NOT NULL DEFAULT 'DEFAULT',  -- DEFAULT, PERSON_2, PERSON_4 ...
  pptx_file_path  TEXT,                                -- 파일 저장 경로 (null = 코드 생성)
  pptx_b64_key    TEXT,                                -- js 전역변수명 (b64 템플릿용)
  pptx_b64_data   TEXT,                                -- 업로드된 PPTX Base64 원본 데이터
  pptx_file_name  TEXT,                                -- 원본 파일명 (예: auditor_profile_2.pptx)
  capacity        INTEGER,                             -- variant별 슬롯 수
  slide_count     INTEGER,                             -- 템플릿 슬라이드 수
  version         INTEGER NOT NULL DEFAULT 1,
  is_default      INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1,
  metadata        TEXT,                                -- JSON: placeholder/anchor/component 목록
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (menu_id, variant_code, version)
);

-- ──────────────────────────────────────────
-- 15. ppt_generation_rules (메뉴별 생성 규칙)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ppt_generation_rules (
  id               SERIAL PRIMARY KEY,
  menu_id          INTEGER NOT NULL UNIQUE REFERENCES ppt_menus(id) ON DELETE CASCADE,
  generation_mode  TEXT    NOT NULL DEFAULT 'BUILD_TABLE',
                   -- REPLACE | CLONE_SLIDE | BUILD_TABLE | BUILD_OBJECTS | HYBRID
  template_strategy TEXT   NOT NULL DEFAULT 'PPTX_TEMPLATE',
                   -- PPTX_TEMPLATE | PPTX_XML_TEMPLATE | FRAME_TEMPLATE | VARIANT_TEMPLATE
  calculator_code  TEXT,   -- 계산 함수명 (예: computeDetailSchedule1Rows)
  renderer_code    TEXT,   -- 렌더 함수명 (예: renderDetailScheduleTable)
  pagination_mode  TEXT    NOT NULL DEFAULT 'SINGLE',
                   -- SINGLE | MAX_ROWS | VARIANT_OVERFLOW
  postprocess_mode TEXT    NOT NULL DEFAULT 'NONE',
                   -- NONE | OOXML_PATCH
  merge_strategy   TEXT    NOT NULL DEFAULT 'STANDARD',
                   -- STANDARD | FOREIGN_TEMPLATE
  rule_config      TEXT,   -- JSON 설정 (variants, maxRowsPerSlide, fillOrder 등)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────
-- 16. ppt_template_elements (템플릿 요소 정보)
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ppt_template_elements (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES ppt_templates(id) ON DELETE CASCADE,
  element_code  TEXT    NOT NULL,  -- [PROJECT.NAME], [TABLE_AREA], [PERSON_CARD] 등
  element_type  TEXT    NOT NULL,  -- VARIABLE | ANCHOR | COMPONENT
  data_key      TEXT,              -- 매핑될 ProjectViewModel 필드 경로
  slide_index   INTEGER,           -- 슬라이드 인덱스 (0-based)
  x             REAL,              -- EMU 단위
  y             REAL,
  width         REAL,
  height        REAL,
  config        TEXT,              -- JSON 추가 설정
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 17. ppt_compositions (최종 PPT 구성 순서 / 포함 조건) ─────────
CREATE TABLE IF NOT EXISTS ppt_compositions (
  id             SERIAL PRIMARY KEY,
  proposal_type  TEXT    NOT NULL DEFAULT 'DEFAULT',   -- 제안서 유형 (추후 확장용)
  menu_id        INTEGER NOT NULL REFERENCES ppt_menus(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_required    INTEGER NOT NULL DEFAULT 1,            -- 1=필수, 0=선택
  condition_code TEXT,                                  -- 생성조건 식별자 (예: HAS_AUDIT_PHASE)
  is_enabled     INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_type, menu_id)
);

-- ── 18. ppt_template_versions (템플릿 버전 이력) ────────────────
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
);

-- ── PPT 테이블 인덱스 ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ppt_menus_parent        ON ppt_menus(parent_id);
CREATE INDEX IF NOT EXISTS idx_ppt_menus_sort          ON ppt_menus(sort_order);
CREATE INDEX IF NOT EXISTS idx_ppt_templates_menu      ON ppt_templates(menu_id);
CREATE INDEX IF NOT EXISTS idx_ppt_gen_rules_menu      ON ppt_generation_rules(menu_id);
CREATE INDEX IF NOT EXISTS idx_ppt_elements_template   ON ppt_template_elements(template_id);
CREATE INDEX IF NOT EXISTS idx_ppt_compositions_menu   ON ppt_compositions(menu_id);
CREATE INDEX IF NOT EXISTS idx_ppt_compositions_sort   ON ppt_compositions(proposal_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_ppt_tpl_versions_tpl    ON ppt_template_versions(template_id);

-- ── 19. ppt_presets (전체 목차 스냅샷 프리셋) ──────────────────
CREATE TABLE IF NOT EXISTS ppt_presets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  menu_count  INTEGER NOT NULL DEFAULT 0,
  snapshot    JSONB NOT NULL DEFAULT '[]',   -- 메뉴+규칙+템플릿 전체 스냅샷
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ppt_presets_created ON ppt_presets(created_at DESC);
