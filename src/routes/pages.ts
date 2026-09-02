/**
 * 메인화면 라우트 + 제안작업표 목록/상세 라우트
 */
import { Hono } from 'hono'
import { query, queryOne } from '../db/client.js'
import { layout, statusBadge, fmtMoney, fmtDate } from '../views/layout.js'
// [ppt-portal 추가 기능] "첨부PPT 생성" 위젯 — 자세한 설명/이식 방법은 파일 상단 주석 참고.
import { renderAttachmentBundleWidget } from '../views/attachment-bundle-widget.js'

// ── 감리경력 "n년 n개월" 포맷 헬퍼 ──────────────────────────────
// earliest: "YYYY.MM" 문자열
function fmtCareer(earliest: string | null | undefined): string {
  if (!earliest) return '-'
  const m = String(earliest).match(/^(\d{4})\.(\d{2})$/)
  if (!m) return '-'
  const [, sy, sm] = m
  const now = new Date()
  const totalMonths = (now.getFullYear() - Number(sy)) * 12 + (now.getMonth() + 1 - Number(sm))
  if (totalMonths < 0) return '-'
  const years  = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (years === 0)  return `${months}개월`
  if (months === 0) return `${years}년`
  return `${years}년 ${months}개월`
}

// ── 인력풀 카드 SSR 헬퍼 ─────────────────────────────────────────
// 인력 풀 섹션에서 각 인원 카드를 서버 사이드로 렌더링
function renderPoolPersonSSR(
  name: string,
  fieldMap: Record<string, string>,
  gradeMap: Record<string, {
    grade: string
    group: string
    expertSubGroup: string
    residency: string
    certNo: string
  }>
): string {
  const field     = fieldMap[name] || ''
  const info      = gradeMap[name] || {}
  const rawGrade  = info.grade || ''
  const grade     = rawGrade === '수석감리원' ? '수석감리원'
                  : rawGrade === '감리원'    ? '감리원'
                  : rawGrade === '테스터'    ? '테스터'
                  : '전문가'
  const gradeColor = grade === '수석감리원' ? '#1a2e4a'
                   : grade === '감리원'     ? '#3a6ea8'
                   : grade === '테스터'     ? '#6b21a8'
                   : '#2e7d32'
  const safeName  = name.replace(/"/g, '&quot;')
  const safeField = field.replace(/"/g, '&quot;')
  return `<div class="pool-person" data-name="${safeName}" data-field="${safeField}" ` +
    `style="display:flex;flex-direction:column;gap:3px;padding:6px 10px;border-radius:6px;` +
    `margin-bottom:5px;background:#f8f9fc;border:1px solid #e5e8f0;cursor:pointer;transition:background .15s" ` +
    `onclick="highlightByName('${safeName}')" title="${safeName} 강조">` +
    (field
      ? `<span style="font-size:10px;color:#2e7d32;font-style:italic;background:#e8f5e9;` +
        `border:1px solid #c8e6c9;border-radius:3px;padding:1px 5px;display:inline-block">${field}</span>`
      : '') +
    `<div style="display:flex;align-items:center;gap:6px">` +
    `<span style="background:${gradeColor};color:#fff;border-radius:4px;font-size:11px;` +
    `padding:2px 7px;font-weight:700;flex-shrink:0">${grade}</span>` +
    `<span style="font-size:13px;font-weight:700;color:#1a2e4a">${name}</span>` +
    `</div>` +
    `</div>`
}

const app = new Hono()

// ── 메인 (대시보드) ───────────────────────────────────────────
app.get('/', async (c) => {
  const [totalProjects, totalPersonnel, statusRows, recentProjects] = await Promise.all([
    queryOne<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM audit_projects'),
    queryOne<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM personnel'),
    query<{ proposal_status: string; cnt: string }>(
      'SELECT proposal_status, COUNT(*) AS cnt FROM audit_projects GROUP BY proposal_status ORDER BY cnt DESC'
    ),
    query<Record<string, unknown>>(`
      SELECT id, project_name, client_org, bid_deadline, bid_amount, proposal_status, bid_rate
      FROM audit_projects
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 8
    `),
  ])

  const tProj = Number(totalProjects?.cnt ?? 0)
  const tPers = Number(totalPersonnel?.cnt ?? 0)

  const statusCards = [
    { label: '입력중',    icon: 'fa-pen',         color: 'yellow', key: '입력중' },
    { label: '자동화요청', icon: 'fa-robot',       color: 'blue',   key: '자동화요청' },
    { label: '지원요청',  icon: 'fa-hand-paper',  color: 'purple', key: '지원요청' },
    { label: '지원완료',  icon: 'fa-check-circle', color: 'green',  key: '지원완료' },
  ].map(sc => {
    const cnt = Number(statusRows.find(r => r.proposal_status === sc.key)?.cnt ?? 0)
    const colorMap: Record<string, string> = {
      yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
      blue:   'bg-blue-50 border-blue-200 text-blue-700',
      purple: 'bg-violet-50 border-violet-200 text-violet-700',
      green:  'bg-emerald-50 border-emerald-200 text-emerald-700',
    }
    const iconMap: Record<string, string> = {
      yellow: 'bg-yellow-100 text-yellow-600',
      blue:   'bg-blue-100 text-blue-600',
      purple: 'bg-violet-100 text-violet-600',
      green:  'bg-emerald-100 text-emerald-600',
    }
    return `
    <a href="/proposals?status=${encodeURIComponent(sc.key)}"
       class="bg-white border ${colorMap[sc.color]} rounded-2xl p-5 card-hover flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl ${iconMap[sc.color]} flex items-center justify-center flex-shrink-0">
        <i class="fas ${sc.icon} text-xl"></i>
      </div>
      <div>
        <p class="text-2xl font-bold">${cnt}</p>
        <p class="text-sm font-medium mt-0.5">${sc.label}</p>
      </div>
    </a>`
  }).join('')

  const recentRows = (recentProjects as Record<string, unknown>[]).map(p => `
    <tr class="hover:bg-slate-50 cursor-pointer" onclick="location.href='/proposals/${p.id}'">
      <td class="px-4 py-3 text-sm font-medium text-indigo-700 max-w-xs truncate">${p.project_name}</td>
      <td class="px-4 py-3 text-sm text-slate-600">${p.client_org ?? '-'}</td>
      <td class="px-4 py-3 text-sm text-slate-600">${fmtDate(p.bid_deadline as string)}</td>
      <td class="px-4 py-3 text-sm text-right text-slate-700 font-medium">${fmtMoney(p.bid_amount as number)}</td>
      <td class="px-4 py-3 text-center">${statusBadge(p.proposal_status as string)}</td>
    </tr>`).join('')

  const body = `
  <div class="p-6 md:p-8">
    <!-- 페이지 타이틀 -->
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-slate-800">대시보드</h1>
      <p class="text-slate-500 text-sm mt-1">제안팀 포털 현황</p>
    </div>

    <!-- 상단 KPI 카드 2개 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <a href="/proposals" class="bg-white rounded-2xl p-5 border border-slate-200 card-hover flex items-center gap-4 col-span-2 md:col-span-1">
        <div class="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-clipboard-list text-xl"></i>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">${tProj}</p>
          <p class="text-sm text-slate-500 mt-0.5">전체 제안작업표</p>
        </div>
      </a>
      <a href="/personnel" class="bg-white rounded-2xl p-5 border border-slate-200 card-hover flex items-center gap-4 col-span-2 md:col-span-1">
        <div class="w-12 h-12 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-users text-xl"></i>
        </div>
        <div>
          <p class="text-2xl font-bold text-slate-800">${tPers}</p>
          <p class="text-sm text-slate-500 mt-0.5">등록 인력</p>
        </div>
      </a>
      ${statusCards}
    </div>

    <!-- 최근 제안작업표 -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 class="font-bold text-slate-700"><i class="fas fa-clock mr-2 text-slate-400"></i>최근 제안작업표</h2>
        <a href="/proposals" class="text-sm text-indigo-600 hover:underline">전체보기 →</a>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-slate-50 text-xs text-slate-500 uppercase">
              <th class="px-4 py-3 text-left">사업명</th>
              <th class="px-4 py-3 text-left">발주기관</th>
              <th class="px-4 py-3 text-left">입찰마감</th>
              <th class="px-4 py-3 text-right">입찰금액</th>
              <th class="px-4 py-3 text-center">상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${recentRows || '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">데이터가 없습니다</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`

  return c.html(layout('홈', body, 'home'))
})

// ── 제안작업표 목록 ───────────────────────────────────────────
app.get('/proposals', async (c) => {
  const status = c.req.query('status') || ''
  const search = c.req.query('search') || ''

  let sql = `
    SELECT p.id, p.project_name, p.client_org, p.bid_notice_no,
           p.bid_deadline, p.bid_amount, p.bid_rate,
           p.required_md, p.proposed_md,
           p.proposal_status, p.eval_method,
           p.writer, p.director, p.registered_yearmonth,
           COUNT(DISTINCT pm.id) AS member_count
    FROM audit_projects p
    LEFT JOIN proposal_members pm ON pm.project_id = p.id
    WHERE 1=1
  `
  const params: (string | number)[] = []
  let idx = 1
  if (status) { sql += ` AND p.proposal_status = $${idx++}`; params.push(status) }
  if (search) { sql += ` AND (p.project_name ILIKE $${idx} OR p.client_org ILIKE $${idx})`; params.push(`%${search}%`); idx++ }
  sql += ` GROUP BY p.id ORDER BY p.bid_deadline DESC NULLS LAST, p.id DESC`

  const projects = await query<Record<string, unknown>>(sql, params)

  const statusTabs = ['', '입력중', '자동화요청', '지원요청', '지원완료'].map(s => {
    const active = status === s
    return `<a href="/proposals${s ? '?status='+encodeURIComponent(s) : ''}"
      class="px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap
      ${active ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-300'}">
      ${s || '전체'}</a>`
  }).join('')

  const rows = projects.map((p, i) => `
    <tr class="hover:bg-indigo-50 transition group" onclick="location.href='/proposals/${p.id}'">
      <td class="px-4 py-3 text-center text-sm text-slate-400">${i + 1}</td>
      <td class="px-4 py-3">
        <div class="text-sm font-semibold text-indigo-700 leading-snug line-clamp-2 max-w-xs">${p.project_name}</div>
        ${p.bid_notice_no ? `<div class="text-xs text-slate-400 mt-0.5">${p.bid_notice_no}</div>` : ''}
      </td>
      <td class="px-4 py-3 text-sm text-slate-600">${p.client_org ?? '-'}</td>
      <td class="px-4 py-3 text-sm text-slate-600 text-center">${p.registered_yearmonth ?? '-'}</td>
      <td class="px-4 py-3 text-sm font-medium text-center ${(p.bid_deadline as string)?.includes('2026') ? 'text-red-600' : 'text-slate-600'}">${fmtDate(p.bid_deadline as string)}</td>
      <td class="px-4 py-3 text-sm text-right font-semibold text-slate-700">${fmtMoney(p.bid_amount as number)}</td>
      <td class="px-4 py-3 text-center text-sm text-slate-500">${p.bid_rate != null ? Math.round(Number(p.bid_rate) * 100) + '%' : '-'}</td>
      <td class="px-4 py-3 text-center text-sm text-slate-600">${p.required_md ?? '-'} MD</td>
      <td class="px-4 py-3 text-center text-sm text-slate-600">${p.member_count ?? 0}명</td>
      <td class="px-4 py-3 text-center">${statusBadge(p.proposal_status as string)}</td>
      <td class="px-4 py-3 text-center" onclick="event.stopPropagation()">
        <button onclick="confirmDelete(${p.id}, '${String(p.project_name).replace(/'/g, "\\'")}')"
          class="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-lg text-xs font-medium border border-red-200 hover:border-red-400 flex items-center gap-1 whitespace-nowrap">
          <i class="fas fa-trash-alt"></i> 삭제
        </button>
      </td>
    </tr>`).join('')

  const body = `
  <div class="p-6 md:p-8">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">제안작업표</h1>
      <p class="text-slate-500 text-sm mt-1">총 ${projects.length}건</p>
    </div>

    <!-- 필터 + 검색 -->
    <div class="flex flex-wrap gap-2 mb-4 items-center">
      <div class="flex flex-wrap gap-2">${statusTabs}</div>
      <div class="ml-auto">
        <form method="GET" action="/proposals" class="flex gap-2">
          ${status ? `<input type="hidden" name="status" value="${status}">` : ''}
          <input type="text" name="search" value="${search}"
            placeholder="사업명 / 발주기관 검색..."
            class="border border-slate-200 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
            <i class="fas fa-search"></i>
          </button>
        </form>
      </div>
    </div>

    <!-- 목록 테이블 -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-200">
              <th class="px-4 py-3 text-center w-10">#</th>
              <th class="px-4 py-3 text-left">사업명</th>
              <th class="px-4 py-3 text-left">발주기관</th>
              <th class="px-4 py-3 text-center">등록년월</th>
              <th class="px-4 py-3 text-center">입찰마감</th>
              <th class="px-4 py-3 text-right">입찰금액</th>
              <th class="px-4 py-3 text-center">투찰률</th>
              <th class="px-4 py-3 text-center">요구공수</th>
              <th class="px-4 py-3 text-center">제안인력</th>
              <th class="px-4 py-3 text-center">상태</th>
              <th class="px-4 py-3 text-center w-16"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows || '<tr><td colspan="11" class="px-4 py-12 text-center text-slate-400">데이터가 없습니다.<br><a href="/upload" class="text-indigo-500 underline mt-2 inline-block">HTML 파일을 업로드해주세요</a></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 삭제 확인 모달 -->
  <div id="deleteModal" class="hidden fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="closeDeleteModal()"></div>
    <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-trash-alt text-red-500"></i>
        </div>
        <div>
          <h3 class="font-bold text-slate-800 text-base">제안건 삭제</h3>
          <p class="text-xs text-slate-500 mt-0.5">이 작업은 되돌릴 수 없습니다</p>
        </div>
      </div>
      <div class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
        <p class="text-sm text-red-700 font-medium" id="deleteModalName"></p>
        <p class="text-xs text-red-500 mt-1">감리 단계, 투입 인력, 키워드 등 모든 관련 데이터가 함께 삭제됩니다.</p>
      </div>
      <div class="flex gap-3 justify-end">
        <button onclick="closeDeleteModal()"
          class="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition">
          취소
        </button>
        <button id="deleteConfirmBtn" onclick="executeDelete()"
          class="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition flex items-center gap-2">
          <i class="fas fa-trash-alt"></i> 삭제
        </button>
      </div>
    </div>
  </div>

  <script>
  var _deleteTargetId = null;
  function confirmDelete(id, name) {
    _deleteTargetId = id;
    document.getElementById('deleteModalName').textContent = name;
    document.getElementById('deleteModal').classList.remove('hidden');
  }
  function closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    _deleteTargetId = null;
  }
  async function executeDelete() {
    if (!_deleteTargetId) return;
    var btn = document.getElementById('deleteConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 삭제 중...';
    try {
      var res = await fetch('/api/projects/' + _deleteTargetId, { method: 'DELETE' });
      var json = await res.json();
      if (json.ok) {
        closeDeleteModal();
        location.reload();
      } else {
        alert('삭제 실패: ' + (json.error || '알 수 없는 오류'));
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash-alt"></i> 삭제';
      }
    } catch(e) {
      alert('삭제 중 오류가 발생했습니다: ' + e.message);
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-trash-alt"></i> 삭제';
    }
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDeleteModal();
  });
  </script>`

  return c.html(layout('제안작업표', body, 'proposals'))
})

// ── 제안작업표 상세 ───────────────────────────────────────────
app.get('/proposals/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.redirect('/proposals')

  const project = await queryOne<Record<string, unknown>>(
    'SELECT * FROM audit_projects WHERE id = $1', [id]
  )
  if (!project) return c.html(layout('없음', '<div class="p-8 text-center text-red-500">프로젝트를 찾을 수 없습니다</div>', 'proposals'))

  const [phases, members, keywords, files, toc, kwMappings] = await Promise.all([
    query<Record<string, unknown>>(`
      SELECT ph.*,
        COALESCE(json_agg(
          json_build_object(
            'id', pa.id, 'person_name', pa.person_name, 'member_type', pa.member_type,
            'domain', pa.domain, 'pre_survey_md', pa.pre_survey_md,
            'audit_md', pa.audit_md, 'action_confirm_md', pa.action_confirm_md,
            'total_md', pa.total_md
          ) ORDER BY pa.id
        ) FILTER (WHERE pa.id IS NOT NULL), '[]'::json) AS assignments
      FROM audit_phases ph
      LEFT JOIN audit_phase_assignments pa ON pa.phase_id = ph.id
      WHERE ph.project_id = $1
      GROUP BY ph.id ORDER BY ph.phase_order, ph.id
    `, [id]),
    query<Record<string, unknown>>(`SELECT * FROM proposal_members WHERE project_id = $1 ORDER BY id ASC`, [id]),
    query<Record<string, unknown>>(`SELECT * FROM keywords WHERE project_id = $1 ORDER BY sort_order`, [id]),
    query<Record<string, unknown>>(`SELECT * FROM proposal_files WHERE project_id = $1 ORDER BY id`, [id]),
    query<Record<string, unknown>>(`SELECT * FROM proposal_attachments_toc WHERE project_id = $1 ORDER BY item_order`, [id]),
    query<{ id: number; original_keyword: string; mapped_keyword: string }>(
      `SELECT id, original_keyword, mapped_keyword FROM keyword_mappings WHERE project_id = $1 ORDER BY id ASC`,
      [id]
    ),
  ])

  // 키워드 태그
  const kwTags = keywords.map(k =>
    `<span class="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs">${k.keyword}</span>`
  ).join(' ')

  // ── DB → parsedData 포맷 변환 ────────────────────────────────
  // proposal_members → personFieldMap / personGradeMap / portalOrder
  const personFieldMap: Record<string, string> = {}
  const personGradeMap: Record<string, { grade: string; group: string; expertSubGroup: string; residency: string; certNo: string }> = {}
  const portalOrder: { name: string; group: string; expertSubGroup: string }[] = []

  members.forEach(m => {
    const name = String(m.person_name ?? '')
    if (!name) return
    const rawGroup = String(m.member_group ?? '')
    // member_group 값: "감리팀", "전문가/핵심기술", "전문가/필수기술", "전문가/보안진단", "테스터" 등
    const isExpert = rawGroup.includes('전문가') || rawGroup.includes('테스터')
    const group = rawGroup.includes('테스터') ? '테스터'
                : rawGroup.includes('전문가') ? '전문가'
                : '감리원팀'
    // expertSubGroup: "핵심기술", "필수기술", "보안진단" 등
    const subMatch = rawGroup.match(/(핵심기술|필수기술|보안진단)/)
    const expertSubGroup = subMatch ? subMatch[1] : ''

    personFieldMap[name] = String(m.domain ?? '')
    personGradeMap[name] = {
      grade:          String(m.auditor_grade ?? ''),
      group,
      expertSubGroup,
      residency:      m.is_fulltime ? '상근' : '비상근',
      certNo:         String(m.auditor_cert_no ?? ''),
    }
    if (!portalOrder.find(p => p.name === name)) {
      portalOrder.push({ name, group, expertSubGroup })
    }
  })

  // audit_phases + audit_phase_assignments → stages[]
  interface StageEntry {
    stage: string; date: string; days: number | null
    감리원: { count: number; pre: number; audit: number; post: number; total: number; people: { name: string; pre: number; audit: number; post: number; field: string }[] } | null
    전문가: { count: number; pre: number; audit: number; post: number; total: number; people: { name: string; pre: number; audit: number; post: number; field: string }[] } | null
  }

  const stages: StageEntry[] = phases.map(ph => {
    const rawAssign = ph.assignments
    const assigns: Record<string, unknown>[] =
      typeof rawAssign === 'string' ? JSON.parse(rawAssign) : (rawAssign as Record<string, unknown>[] ?? [])

    const auditors = assigns.filter(a => String(a.member_type ?? '감리원') !== '전문가' && String(a.member_type ?? '') !== '테스터')
    const experts  = assigns.filter(a => String(a.member_type ?? '') === '전문가' || String(a.member_type ?? '') === '테스터')

    const toPeople = (arr: Record<string, unknown>[]) =>
      arr.map(a => ({
        name:  String(a.person_name ?? ''),
        pre:   Number(a.pre_survey_md ?? 0),
        audit: Number(a.audit_md ?? 0),
        post:  Number(a.action_confirm_md ?? 0),
        field: personFieldMap[String(a.person_name ?? '')] ?? String(a.domain ?? ''),
      }))

    const sumMD = (arr: Record<string, unknown>[], key: string) =>
      arr.reduce((s, a) => s + Number(a[key] ?? 0), 0)

    const aPeople = toPeople(auditors)
    const ePeople = toPeople(experts)

    return {
      stage: String(ph.phase_name ?? ''),
      date:  `${ph.phase_start_date ?? ''} ~ ${ph.phase_end_date ?? ''}`,
      days:  ph.phase_days != null ? Number(ph.phase_days) : null,
      감리원: aPeople.length ? {
        count: aPeople.length,
        pre:   sumMD(auditors, 'pre_survey_md'),
        audit: sumMD(auditors, 'audit_md'),
        post:  sumMD(auditors, 'action_confirm_md'),
        total: Number(ph.proposed_md ?? 0),
        people: aPeople,
      } : null,
      전문가: ePeople.length ? {
        count: ePeople.length,
        pre:   sumMD(experts, 'pre_survey_md'),
        audit: sumMD(experts, 'audit_md'),
        post:  sumMD(experts, 'action_confirm_md'),
        total: sumMD(experts, 'pre_survey_md') + sumMD(experts, 'audit_md') + sumMD(experts, 'action_confirm_md'),
        people: ePeople,
      } : null,
    }
  })

  // 요약 계산
  let totalAuditMD = 0, totalExpertMD = 0, totalTesterMD = 0
  stages.forEach(s => {
    if (s.감리원) totalAuditMD += s.감리원.total
    if (s.전문가) s.전문가.people.forEach(p => {
      const grp = (personGradeMap[p.name] || {}).group || ''
      const md = p.pre + p.audit + p.post
      if (grp === '테스터') totalTesterMD += md
      else totalExpertMD += md
    })
  })
  const totalAllMD = totalAuditMD + totalExpertMD + totalTesterMD

  // 인력 그룹 분류
  const auditNames: string[] = []
  const coreNames: string[] = [], requiredNames: string[] = [], securityNames: string[] = [], testerNames: string[] = []
  portalOrder.forEach(({ name, group, expertSubGroup }) => {
    if (group === '테스터') { testerNames.push(name); return }
    if (group === '전문가') {
      if (expertSubGroup.includes('보안'))      securityNames.push(name)
      else if (expertSubGroup.includes('필수')) requiredNames.push(name)
      else                                     coreNames.push(name)
      return
    }
    auditNames.push(name)
  })

  // personnelIdMap: 이름 → personnel_id (photo-profile API 호출용)
  const personnelIdMap: Record<string, number> = {}
  members.forEach(m => {
    const name = String(m.person_name ?? '')
    const pid  = m.personnel_id ? Number(m.personnel_id) : 0
    if (name && pid) personnelIdMap[name] = pid
  })

  // JSON 직렬화 (클라이언트에 전달)
  // </script> 문자열이 JSON 값 안에 있으면 브라우저가 스크립트 태그를 조기 종료하므로
  // 반드시 <\/script> 로 이스케이프 처리해야 함
  const safeJSON = (v: unknown) =>
    JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>').replace(/<!--/g, '<\\!--')

  const stagesJSON = safeJSON(stages)
  const personFieldMapJSON = safeJSON(personFieldMap)
  const personGradeMapJSON = safeJSON(personGradeMap)
  const portalOrderJSON = safeJSON(portalOrder)
  const personnelIdMapJSON = safeJSON(personnelIdMap)
  const projectDataJSON = safeJSON({
    projectTitle: String(project.project_name ?? ''),
    requestMD: 0, requestStageCount: 0, requestAuditDays: 0,
    clientOrg: String(project.client_org ?? ''),
    pmName: String(project.director ?? ''),
  })

  // ── 감리 단계 스케줄 테이블 (새 통합 버전) ──────────────────
  const scheduleSection = phases.length > 0 ? `
  <div id="schedule-section" style="font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif">
    <!-- 요약 카드바 -->
    <div id="summary-bar" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:700;color:#1a2e4a">${stages.length}</div><div style="font-size:12px;color:#666;margin-top:2px">총 단계</div>
      </div>
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:700;color:#1a2e4a">${totalAuditMD}</div><div style="font-size:12px;color:#666;margin-top:2px">감리원 MD</div>
      </div>
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:700;color:#1b5e20">${totalExpertMD}</div><div style="font-size:12px;color:#666;margin-top:2px">전문가 MD</div>
      </div>
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:700;color:#6a1b9a">${totalTesterMD}</div><div style="font-size:12px;color:#666;margin-top:2px">테스터 MD</div>
      </div>
      <div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 16px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:700;color:#e65100">${totalAllMD}</div><div style="font-size:12px;color:#666;margin-top:2px">총 제안 MD</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
        <button onclick="clearHighlights()" style="background:#e0e0e0;color:#333;border:none;border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">🧹 강조 초기화</button>
        <button onclick="highlightCorrections('pre')" style="background:#e65100;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">🔎 예비조사</button>
        <button onclick="highlightCorrections('audit')" style="background:#6a1b9a;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">🔔 감리</button>
        <button onclick="highlightCorrections('post')" style="background:#c62828;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">🚨 조치확인</button>
        <button onclick="openAutoModal()" style="background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;border:none;border-radius:7px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(67,56,202,.4)">🛠️ 자동화 PPT</button>
      </div>
    </div>

    <!-- 범례 -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:#444">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;display:inline-block;background:#fff9c4;border:1px solid #f9a825"></span>이름 강조</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;display:inline-block;background:#e8f5e9;border:1px solid #43a047"></span>분야 강조</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;display:inline-block;background:#eef4ff;border:1px solid #1565c0"></span>예비조사&gt;0</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;display:inline-block;background:#f5eefc;border:1px solid #6a1b9a"></span>감리&gt;0</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:2px;display:inline-block;background:#ffcdd2;border:1px solid #c62828"></span>조치확인&gt;0</span>
    </div>

    <!-- 스케줄 테이블 -->
    <div style="overflow-x:auto;border-radius:8px;margin-bottom:20px">
      <table id="schedule-table" style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);font-size:13px">
        <thead>
          <tr>
            <th rowspan="2" style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:90px;white-space:nowrap">단계 구분</th>
            <th rowspan="2" style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:70px">감리원<br>MD</th>
            <th rowspan="2" style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:70px">전문가<br>MD</th>
            <th rowspan="2" style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:60px">총 MD</th>
            <th style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:280px">감리원 투입 인력</th>
            <th style="background:#1a2e4a;color:#fff;padding:8px 10px;text-align:center;font-size:12px;font-weight:600;border:1px solid #2b4a78;min-width:280px">전문가 투입 인력</th>
          </tr>
          <tr>
            <th style="background:#1a2e4a;color:#a8c4e0;padding:6px 10px;text-align:center;font-size:11px;border:1px solid #2b4a78">투입 MD 합계</th>
            <th style="background:#1a2e4a;color:#a8c4e0;padding:6px 10px;text-align:center;font-size:11px;border:1px solid #2b4a78">투입 MD 합계</th>
          </tr>
        </thead>
        <tbody id="schedule-tbody">
          ${stages.map((s, si) => {
            const ae = s.감리원 ?? { total: 0, people: [], count: 0 }
            const ee = s.전문가 ?? { total: 0, people: [], count: 0 }
            const tot = ae.total + ee.total
            const auditPeople = ae.people.map((p: { name: string; pre: number; audit: number; post: number; field: string }) =>
              `<span class="person-chip" data-name="${p.name}" data-field="${(p.field||'').replace(/"/g,'&quot;')}" data-stage="${si}" data-pre="${p.pre}" data-audit="${p.audit}" data-post="${p.post}" style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;border-radius:3px;padding:2px 6px;border:1px solid transparent;margin:2px;white-space:nowrap;transition:all .15s">
                <span class="chip-name" style="font-weight:700;color:#1a2e4a;font-size:12px">${p.name}</span>
                <span class="chip-mds" style="color:#666;font-size:11px">
                  <span class="mds-num" data-k="pre">${p.pre}</span>:<span class="mds-num" data-k="audit">${p.audit}</span>:<span class="mds-num" data-k="post">${p.post}</span>
                </span>
              </span>`
            ).join('')
            const expertPeople = ee.people.map((p: { name: string; pre: number; audit: number; post: number; field: string }) =>
              `<span class="person-chip" data-name="${p.name}" data-field="${(p.field||'').replace(/"/g,'&quot;')}" data-stage="${si}" data-pre="${p.pre}" data-audit="${p.audit}" data-post="${p.post}" style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;border-radius:3px;padding:2px 6px;border:1px solid transparent;margin:2px;white-space:nowrap;transition:all .15s">
                <span class="chip-name" style="font-weight:700;color:#1a2e4a;font-size:12px">${p.name}</span>
                <span class="chip-mds" style="color:#666;font-size:11px">
                  <span class="mds-num" data-k="pre">${p.pre}</span>:<span class="mds-num" data-k="audit">${p.audit}</span>:<span class="mds-num" data-k="post">${p.post}</span>
                </span>
  
              </span>`
            ).join('')
            return `<tr data-stage="${si}">
              <td style="padding:8px 10px;border:1px solid #ddd;background:#e8edf5;font-weight:700;text-align:center;white-space:nowrap;font-size:14px">
                <div>${s.stage}</div>
                ${s.date && s.date.trim() !== ' ~ ' ? `<div style="font-size:11px;color:#444;margin-top:2px;font-weight:400">${s.date}</div>` : ''}
                ${s.days ? `<div style="font-size:12px;color:#3a6ea8;font-weight:600;margin-top:2px">(${s.days}일)</div>` : ''}
              </td>
              <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:700;font-size:14px;background:#fff9e8;vertical-align:middle">
                <div>${ae.total}</div><div style="font-size:10px;color:#888;font-weight:400">(${ae.count || ae.people.length}명)</div>
              </td>
              <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:700;font-size:14px;background:#fff9e8;vertical-align:middle">
                <div>${ee.total}</div><div style="font-size:10px;color:#888;font-weight:400">(${ee.count || ee.people.length}명)</div>
              </td>
              <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;font-weight:700;font-size:14px;background:#e8f5e9;color:#1b5e20;vertical-align:middle">${tot}</td>
              <td class="people-cell" data-ci="people-audit-${si}" style="padding:6px 8px;border:1px solid #ddd;vertical-align:top;line-height:1.8">
                ${auditPeople || '<span style="color:#bbb;font-size:12px">없음</span>'}
              </td>
              <td class="people-cell" data-ci="people-expert-${si}" style="padding:6px 8px;border:1px solid #ddd;vertical-align:top;line-height:1.8">
                ${expertPeople || '<span style="color:#bbb;font-size:12px">없음</span>'}
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- 인력 모음 풀 -->
    <div id="personnel-pool" style="margin-top:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h3 style="font-size:15px;font-weight:700;color:#1a2e4a;margin:0">👥 인력 모음</h3>
        <button onclick="copyPersonnelTable()" style="background:#1a2e4a;color:#fff;border:none;border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">📋 표로 복사</button>
      </div>
      <div id="pool-row" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div id="pool-audit-group" class="pool-group" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:#1a2e4a;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e0e8f5">🔵 감리원 (${auditNames.length}명)</div>
          <div id="pool-audit-list">${auditNames.map(n => renderPoolPersonSSR(n, personFieldMap, personGradeMap)).join('')}</div>
        </div>
        <div id="pool-core-group" class="pool-group" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:#1a2e4a;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e0e8f5">🟢 핵심기술 (${coreNames.length}명)</div>
          <div id="pool-core-list">${coreNames.map(n => renderPoolPersonSSR(n, personFieldMap, personGradeMap)).join('')}</div>
        </div>
        <div id="pool-required-group" class="pool-group" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:#1a2e4a;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e0e8f5">🟩 필수기술 (${requiredNames.length}명)</div>
          <div id="pool-required-list">${requiredNames.map(n => renderPoolPersonSSR(n, personFieldMap, personGradeMap)).join('')}</div>
        </div>
        <div id="pool-security-group" class="pool-group" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:#1a2e4a;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e0e8f5">🔴 보안진단 (${securityNames.length}명)</div>
          <div id="pool-security-list">${securityNames.map(n => renderPoolPersonSSR(n, personFieldMap, personGradeMap)).join('')}</div>
        </div>
        <div id="pool-tester-group" class="pool-group" style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:#1a2e4a;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e0e8f5">🟣 테스터 (${testerNames.length}명)</div>
          <div id="pool-tester-list">${testerNames.map(n => renderPoolPersonSSR(n, personFieldMap, personGradeMap)).join('')}</div>
        </div>
      </div>
    </div>
  </div>` : ''

  // ── 제안 인력 테이블 ──────────────────────────────────────────
  const memberRows = members.map(m => {
    const pid = m.personnel_id
    const nameCell = pid
      ? `<span class="cursor-pointer text-indigo-700 font-semibold hover:underline" onclick="openPersonModal(${pid})">${m.person_name}</span><span class="text-xs text-teal-600 font-bold cursor-pointer hover:text-teal-800 ml-0.5" onclick="openKModal(${pid},${id},'${String(m.person_name).replace(/'/g,"\\'")}')"> (K)</span>`
      : `<span class="font-medium text-slate-700">${m.person_name}</span>`
    return `
    <tr class="hover:bg-slate-50 text-sm border-t border-slate-100">
      <td class="px-4 py-2.5 text-slate-500 text-xs">${m.member_group ?? '-'}</td>
      <td class="px-4 py-2.5">${nameCell}</td>
      <td class="px-4 py-2.5 text-slate-600 text-xs">${m.member_type ?? '-'}</td>
      <td class="px-4 py-2.5 text-slate-600 text-xs">${m.domain ?? '-'}</td>
      <td class="px-4 py-2.5 text-center">${m.total_md ?? 0} MD</td>
      <td class="px-4 py-2.5 text-center text-xs text-slate-500">${m.is_fulltime ? '상근' : '비상근'}</td>
      <td class="px-4 py-2.5 text-slate-600 text-xs">${m.auditor_grade ?? '-'}</td>
      <td class="px-4 py-2.5 text-slate-500 text-xs">${m.phone ?? '-'}</td>
    </tr>`
  }).join('')

  // 파일 목록
  const fileRows = files.map(f => `
    <tr class="text-xs border-t border-slate-100">
      <td class="px-4 py-2 text-slate-500">${f.file_category ?? '-'}</td>
      <td class="px-4 py-2 font-medium text-slate-700">${f.file_name}</td>
      <td class="px-4 py-2 text-right text-slate-500">${f.file_size_kb != null ? Number(f.file_size_kb).toFixed(1) + ' KB' : '-'}</td>
      <td class="px-4 py-2 text-slate-500">${f.uploaded_at ?? '-'}</td>
    </tr>`).join('')

  // TOC
  const tocItems = toc.map(t =>
    `<li class="text-sm text-slate-600 flex gap-2"><span class="text-slate-400 w-5 text-right flex-shrink-0">${t.item_order}.</span>${t.item_name}</li>`
  ).join('')

  const infoRow = (label: string, value: string, span = false) =>
    `<tr>
      <th class="px-4 py-2.5 text-left text-xs font-medium text-slate-500 bg-slate-50 w-28 whitespace-nowrap">${label}</th>
      <td class="px-4 py-2.5 text-sm text-slate-800 ${span ? 'colspan=\"3\"' : ''}">${value}</td>
    </tr>`

  const body = `
  <div class="p-6 md:p-8">
    <!-- 뒤로가기 + 제목 -->
    <div class="mb-6 flex items-start gap-4">
      <a href="/proposals" class="mt-1 text-slate-400 hover:text-slate-600 transition">
        <i class="fas fa-arrow-left text-lg"></i>
      </a>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-3 flex-wrap mb-1">
          ${statusBadge(project.proposal_status as string)}
          <span class="text-xs text-slate-400">${project.registered_yearmonth ?? ''}</span>
        </div>
        <h1 class="text-xl font-bold text-slate-800 leading-snug">${project.project_name}</h1>
        <p class="text-slate-500 text-sm mt-1">${project.client_org ?? ''}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <!-- 왼쪽 메인 -->
      <div class="xl:col-span-2 space-y-6">

        <!-- 기본 정보 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-slate-700 text-white font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-info-circle"></i> 기본 정보
          </div>
          <table class="w-full divide-y divide-slate-100">
            <tbody>
              ${infoRow('사업명', String(project.project_name ?? '-'))}
              ${infoRow('발주기관', String(project.client_org ?? '-'))}
              ${infoRow('입찰공고번호', project.bid_notice_no
                ? `<a href="https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${project.bid_notice_no}" target="_blank" class="text-indigo-600 hover:underline">${project.bid_notice_no}</a>`
                : '-')}
              ${infoRow('입찰마감일시', `<span class="${String(project.bid_deadline ?? '').includes('2026') ? 'text-red-600 font-semibold' : ''}">${fmtDate(project.bid_deadline as string)}</span>`)}
              ${infoRow('평가일시', fmtDate(project.eval_dt as string))}
              ${infoRow('제안평가방식', String(project.eval_method ?? '-'))}
              ${infoRow('제안작업상태', statusBadge(project.proposal_status as string))}
            </tbody>
          </table>
        </div>

        <!-- 금액 정보 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-indigo-700 text-white font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-won-sign"></i> 금액 정보
          </div>
          <div class="grid grid-cols-2 md:grid-cols-3 divide-x divide-y divide-slate-100">
            ${[
              ['사업금액', fmtMoney(project.base_budget as number)],
              ['배정예산', fmtMoney(project.target_budget as number)],
              ['입찰금액(VAT포함)', `<span class="text-indigo-700 font-bold text-base">${fmtMoney(project.bid_amount as number)}</span>`],
              ['입찰금액(VAT제외)', fmtMoney(project.bid_amount_excl_vat as number)],
              ['투찰률', project.bid_rate != null ? `<span class="font-semibold">${Math.round(Number(project.bid_rate) * 100)}%</span>` : '-'],
              ['1MD단가(VAT제외)', fmtMoney(project.md_unit_price_excl as number)],
              ['요구투입공수', `<span class="font-semibold">${project.required_md ?? '-'} MD</span>`],
              ['제안투입공수', `<span class="font-semibold text-indigo-700">${project.proposed_md ?? '-'} MD</span>`],
              ['제안수당', project.proposal_allowance ? `${fmtMoney(project.proposal_allowance as number)} (${project.proposal_allowance_rate != null ? Number(project.proposal_allowance_rate).toFixed(2) + '%' : ''})` : '-'],
            ].map(([k, v]) => `
              <div class="px-4 py-3">
                <p class="text-xs text-slate-500 mb-1">${k}</p>
                <p class="text-sm">${v}</p>
              </div>`).join('')}
          </div>
        </div>

        <!-- 감리 단계별 인력 배정 (통합 뷰어) -->
        ${phases.length > 0 ? `
        <div>
          <h2 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <i class="fas fa-tasks text-slate-400"></i> 감리 단계별 인력 배정
          </h2>
          ${scheduleSection}
        </div>` : ''}

        <!-- 제안 인력 -->
        ${members.length > 0 ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-teal-700 text-white font-semibold text-sm flex items-center gap-2">
            <i class="fas fa-users"></i> 제안 인력 (${members.length}명)
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead><tr class="bg-slate-50 text-xs text-slate-500 border-b">
                <th class="px-4 py-2 text-left">그룹</th>
                <th class="px-4 py-2 text-left">성명</th>
                <th class="px-4 py-2 text-center">구분</th>
                <th class="px-4 py-2 text-center">분야</th>
                <th class="px-4 py-2 text-center">공수</th>
                <th class="px-4 py-2 text-center">상근</th>
                <th class="px-4 py-2 text-center">등급</th>
                <th class="px-4 py-2 text-center">연락처</th>
              </tr></thead>
              <tbody class="divide-y divide-slate-100">${memberRows}</tbody>
            </table>
          </div>
        </div>` : ''}

      </div>

      <!-- 오른쪽 사이드 -->
      <div class="space-y-6">

        <!-- 제안 관련자 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-user-tie mr-2 text-slate-400"></i>제안 관련자</h3>
          <div class="space-y-2 text-sm">
            ${project.writer ? `<div class="flex gap-2"><span class="text-slate-400 w-14">작성자</span><span class="font-medium">${project.writer}</span></div>` : ''}
            ${project.director ? `<div class="flex gap-2"><span class="text-slate-400 w-14">총괄</span><span class="font-medium">${project.director}</span></div>` : ''}
            ${project.supporters ? `<div class="flex gap-2"><span class="text-slate-400 w-14">지원</span><span class="text-slate-600">${project.supporters}</span></div>` : ''}
            ${project.references_cc ? `<div class="flex gap-2"><span class="text-slate-400 w-14">참조</span><span class="text-slate-600 text-xs leading-relaxed">${project.references_cc}</span></div>` : ''}
          </div>
        </div>

        <!-- 키워드 -->
        ${keywords.length > 0 ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-tags mr-2 text-slate-400"></i>키워드 (${keywords.length}개)</h3>
          <div class="flex flex-wrap gap-1.5 mb-4">${kwTags}</div>

          <!-- 키워드 치환 규칙 -->
          <div class="border-t border-slate-100 pt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-slate-600"><i class="fas fa-exchange-alt mr-1 text-teal-500"></i>키워드 치환 규칙</span>
              <span class="text-xs text-slate-400">검색된 키워드를 장표에 표시할 다른 이름으로 변환</span>
            </div>
            <!-- 기존 규칙 목록 -->
            <div id="kwMappingList" class="space-y-1 mb-3">
              ${kwMappings.length === 0
                ? `<p class="text-xs text-slate-400 py-1">등록된 치환 규칙이 없습니다.</p>`
                : kwMappings.map(m => `
                  <div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5" data-mapping-id="${m.id}">
                    <span class="text-xs text-slate-500 line-through">${m.original_keyword}</span>
                    <i class="fas fa-arrow-right text-teal-400 text-xs"></i>
                    <span class="text-xs font-semibold text-teal-700">${m.mapped_keyword}</span>
                    <button onclick="deleteKwMapping(${id}, ${m.id})" class="ml-auto text-slate-300 hover:text-red-400 transition text-xs" title="삭제"><i class="fas fa-times"></i></button>
                  </div>`).join('')
              }
            </div>
            <!-- 새 규칙 입력 -->
            <div class="flex gap-2 items-start">
              <div class="flex-1">
                <input id="kwMapOrig" type="text" placeholder="원본 키워드 (쉼표로 여러 개)"
                  class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300 placeholder-slate-300" />
              </div>
              <i class="fas fa-arrow-right text-teal-400 text-xs mt-2.5"></i>
              <div class="flex-1">
                <input id="kwMapMapped" type="text" placeholder="변환할 이름"
                  class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300 placeholder-slate-300" />
              </div>
              <button onclick="addKwMapping(${id})"
                class="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg transition whitespace-nowrap">
                <i class="fas fa-plus mr-1"></i>추가
              </button>
            </div>
            <div class="mt-2 text-xs text-slate-400 leading-relaxed">
              <span class="font-semibold text-slate-500">예시)</span>
              한국공항공사 → 주관기관 &nbsp;·&nbsp;
              환경부, 환경측정 → 환경 &nbsp;·&nbsp;
              지방계약, 계약관리 → 계약/이행평가
            </div>
          </div>
        </div>` : ''}

        <!-- 감리 일정 -->
        ${project.special_notes ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-calendar-alt mr-2 text-slate-400"></i>감리 일정</h3>
          <p class="text-xs text-slate-600 whitespace-pre-line leading-relaxed">${project.special_notes}</p>
        </div>` : ''}

        <!-- 첨부 목차 -->
        ${toc.length > 0 ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-list mr-2 text-slate-400"></i>첨부 목차 (${toc.length}건)</h3>
          <ol class="space-y-1">${tocItems}</ol>
        </div>` : ''}

        <!-- 제안 파일 -->
        ${files.length > 0 ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <h3 class="font-bold text-amber-700 text-sm"><i class="fas fa-paperclip mr-2"></i>제안 파일 (${files.length}건)</h3>
          </div>
          <table class="w-full">
            <thead><tr class="bg-slate-50 text-xs text-slate-500 border-b">
              <th class="px-4 py-2 text-left">분류</th>
              <th class="px-4 py-2 text-left">파일명</th>
              <th class="px-4 py-2 text-right">크기</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${fileRows}</tbody>
          </table>
        </div>` : ''}

        <!-- 비고 -->
        ${project.remarks ? `
        <div class="bg-amber-50 rounded-2xl border border-amber-200 p-5">
          <h3 class="font-bold text-amber-700 mb-2 text-sm"><i class="fas fa-sticky-note mr-2"></i>비고</h3>
          <p class="text-sm text-amber-800 whitespace-pre-line leading-relaxed">${project.remarks}</p>
        </div>` : ''}

      </div>
    </div>
  </div>

  <!-- ── 인원 상세 모달 ─────────────────────────────── -->
  <div id="personModal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="closePersonModal()"></div>
    <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
      <div class="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
        <h2 class="font-bold text-slate-800 text-lg" id="personModalTitle">인원 정보</h2>
        <button onclick="closePersonModal()" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div id="personModalBody" class="p-6">
        <div class="flex justify-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div></div>
      </div>
    </div>
  </div>

  <!-- ── K 감리이력 매칭 모달 ──────────────────────────── -->
  <div id="kModal" class="fixed inset-0 z-50 hidden flex items-center justify-center p-4">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick="closeKModal()"></div>
    <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
      <div class="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
        <h2 class="font-bold text-slate-800 text-lg" id="kModalTitle">감리이력 키워드 매칭</h2>
        <button onclick="closeKModal()" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div id="kModalBody" class="p-6">
        <div class="flex justify-center py-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div></div>
      </div>
    </div>
  </div>

  <!-- ── 자동화 PPT 모달 ───────────────────────────────── -->
  <div id="autoModal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:center;justify-content:center;padding:20px">
    <div style="background:#fff;border-radius:12px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;position:relative;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif">
      <button onclick="closeAutoModal()" style="position:absolute;top:14px;right:16px;background:#e0e0e0;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
      <h3 style="font-size:16px;font-weight:700;margin:0 0 6px;color:#1a2e4a">🛠️ 자동화 PPT 생성</h3>
      <p style="font-size:13px;color:#666;margin:0 0 16px">세부감리일정(1,2) → 표장표 → 사진장표 → 요약표 순서로 하나의 PPT로 합쳐서 내려받습니다.</p>
      <div id="autoModalAlertBox" style="display:none;margin-bottom:12px;padding:10px 14px;border-radius:7px;font-size:13px;font-weight:600"></div>
      <div style="margin-bottom:16px;background:#f7f8fa;border-radius:8px;padding:12px">
        <b style="font-size:13px;color:#333">추가 제안 단계</b>
        <div style="font-size:12px;color:#666;margin-top:4px">RFP 최소 요건 이상으로 추가 제안한 단계를 선택하세요 (요약표에 반영됩니다)</div>
        <div id="extra-stage-boxes" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">
          ${stages.map(s => `<label style="display:flex;align-items:center;gap:4px;font-size:13px;color:#333;cursor:pointer"><input type="checkbox" class="st-extra-stage-cb" value="${s.stage}"> ${s.stage}</label>`).join('')}
        </div>
        <div style="font-size:12px;color:#777;margin-top:8px">
          요청공수: <b>${project.required_md != null ? project.required_md + ' MD' : '(없음)'}</b> · 
          주관기관: <b>${project.client_org ?? '(없음)'}</b> · 
          총괄감리원: <b>${project.director ?? '(없음)'}</b>
        </div>
      </div>
      <!-- ── 사진장표용 분류 체크리스트 ── -->
      <div style="margin-bottom:16px;border:1px solid #e8eaf0;border-radius:8px;padding:12px">
        <b style="font-size:13px;color:#333">🖼️ 사진장표용 분류 체크리스트</b>
        <div id="photo-assign-rows" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          <span style="color:#aaa;font-size:13px">인력 데이터를 불러오는 중...</span>
        </div>
      </div>
      <button onclick="downloadAllPptx(this)" style="width:100%;padding:14px 0;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#7c3aed,#4338ca);border:none;border-radius:9px;cursor:pointer;box-shadow:0 3px 10px rgba(67,56,202,.4);font-family:inherit;margin-bottom:16px">
        🚀 자동화 생성 (전체 합본)
      </button>
      <details style="margin-top:4px">
        <summary style="cursor:pointer;color:#555;font-size:13px;font-weight:600;padding:4px 0">🔧 개별 생성</summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <button onclick="downloadDetailSchedule1Pptx(this)" style="background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">📅 세부 감리 일정 (1, 2) 생성</button>
          <button onclick="downloadAssignPptx(this)" style="background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">📋 표장표 생성</button>
          <button onclick="downloadPhotoAssignPptx(this)" style="background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">🖼️ 사진장표 생성</button>
          <button onclick="downloadSummaryTablePptx(this)" style="background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left">📊 요약표 생성</button>
        </div>
      </details>
    </div>
  </div>

  <!-- ── 인력 모음 표 복사 모달 ─────────────────────────── -->
  <div id="personnelTableModal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:center;justify-content:center;padding:20px">
    <div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:22px;position:relative;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif">
      <button onclick="closePersonnelTableModal()" style="position:absolute;top:14px;right:16px;background:#e0e0e0;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
      <h3 style="font-size:16px;font-weight:700;margin:0 0 4px">👥 인력 모음 표</h3>
      <div style="font-size:12px;color:#888;margin-bottom:14px">역할 · 분야 · 이름(음절마다 띄어쓰기). 셀을 드래그해 선택 후 Ctrl+C 복사, 또는 전체 복사 버튼을 사용하세요.</div>
      <div id="personnel-table-wrap" style="overflow-x:auto;margin-top:4px"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="copyPersonnelSummaryTable()" style="flex:1;background:#2e7d32;color:#fff;border:none;border-radius:6px;padding:9px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">📋 전체 복사</button>
        <button onclick="closePersonnelTableModal()" style="flex:1;background:#e0e0e0;color:#333;border:none;border-radius:6px;padding:9px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">닫기</button>
      </div>
    </div>
  </div>

  <!-- ── 전문가 분류별 Breakdown 모달 ─────────────────────── -->
  <div id="expertBreakdownModal" style="display:none;position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.5);align-items:center;justify-content:center;padding:20px" onclick="if(event.target===this)closeExpertBreakdown()">
    <div style="background:#fff;border-radius:10px;max-width:440px;width:100%;max-height:80vh;overflow-y:auto;padding:22px;position:relative;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif">
      <button onclick="closeExpertBreakdown()" style="position:absolute;top:14px;right:16px;background:#e0e0e0;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:14px">✕</button>
      <h3 id="ebTitle" style="font-size:16px;font-weight:700;margin:0 0 2px">전문가 분류별 인력</h3>
      <div id="ebSub" style="font-size:12px;color:#888;margin-bottom:14px"></div>
      <div id="ebBody"></div>
    </div>
  </div>

  <!-- pptxgenjs + jszip + 사진장표 PPTX 템플릿 (base64) -->
  <script src="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <script src="/static/photo-template.b64.js"></script>
  <script src="/static/ppt-engine.js"></script>

  <script>
  // ══════════════════════════════════════════════════════════
  // 데이터 주입 (서버에서 렌더링된 JSON) — 함수는 외부 JS로 분리
  // ══════════════════════════════════════════════════════════
  var parsedData = {
    proposalId:    ${id},
    projectTitle:  ${projectDataJSON}.projectTitle,
    requestMD:     ${project.required_md ?? 0},
    requestStageCount: 0,
    requestAuditDays:  0,
    clientOrg:     ${projectDataJSON}.clientOrg,
    pmName:        ${projectDataJSON}.pmName,
    stages:        ${stagesJSON},
    personFieldMap:${personFieldMapJSON},
    personGradeMap:${personGradeMapJSON},
    portalOrder:   ${portalOrderJSON},
    personnelIdMap:${personnelIdMapJSON},
  }
  var activeHL = null
  var correctionMode = null
  var gradeOverrides = {}

  </script>
  <script src="/static/proposal-detail.js"></script>`

  return c.html(layout(String(project.project_name), body, 'proposals'))
})

// ── 인력정보 목록 ─────────────────────────────────────────────
app.get('/personnel', async (c) => {
  const search = c.req.query('search') || ''
  const grade  = c.req.query('grade')  || ''

  let sql = `
    SELECT p.id, p.name, p.position, p.company, p.is_fulltime,
           p.auditor_grade, p.auditor_cert_no, p.phone,
           COUNT(DISTINCT pc.id) AS cert_count,
           COUNT(DISTINCT ph.id) AS audit_count,
           MIN(ph.audit_yearmonth) AS earliest_audit
    FROM personnel p
    LEFT JOIN personnel_certifications pc ON pc.personnel_id = p.id
    LEFT JOIN personnel_audit_history  ph ON ph.personnel_id = p.id
    WHERE 1=1
  `
  const params: string[] = []
  let idx = 1
  if (search) { sql += ` AND (p.name ILIKE $${idx} OR p.company ILIKE $${idx})`; params.push(`%${search}%`); idx++ }
  if (grade)  { sql += ` AND p.auditor_grade = $${idx++}`; params.push(grade) }
  sql += ` GROUP BY p.id ORDER BY TRIM(p.name) COLLATE "C" ASC`

  const list = await query<Record<string, unknown>>(sql, params)

  const gradeOptions = ['', '특급', '고급', '중급', '초급'].map(g =>
    `<option value="${g}" ${grade === g ? 'selected' : ''}>${g || '전체 등급'}</option>`
  ).join('')

  const rows = list.map((p, i) => `
    <tr class="hover:bg-indigo-50 cursor-pointer transition" onclick="location.href='/personnel/${p.id}'">
      <td class="px-4 py-3 text-center text-sm text-slate-400">${i + 1}</td>
      <td class="px-4 py-3 font-semibold text-indigo-700">${p.name}</td>
      <td class="px-4 py-3 text-sm text-slate-600">${p.position ?? '-'}</td>
      <td class="px-4 py-3 text-sm text-slate-600">${p.company ?? '-'}</td>
      <td class="px-4 py-3 text-center">
        <span class="status-badge ${p.is_fulltime ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}">
          ${p.is_fulltime ? '상근' : '비상근'}
        </span>
      </td>
      <td class="px-4 py-3 text-center text-sm">${p.auditor_grade ?? '-'}</td>
      <td class="px-4 py-3 text-center text-sm text-slate-500">${p.auditor_cert_no ?? '-'}</td>
      <td class="px-4 py-3 text-center text-sm">${fmtCareer(p.earliest_audit as string)}</td>
      <td class="px-4 py-3 text-center text-sm text-slate-500">${p.cert_count ?? 0}개</td>
      <td class="px-4 py-3 text-center text-sm text-slate-500">${p.audit_count ?? 0}건</td>
      <td class="px-4 py-3 text-sm text-slate-500">${p.phone ?? '-'}</td>
    </tr>`).join('')

  const body = `
  <div class="p-6 md:p-8">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">인력정보</h1>
      <p class="text-slate-500 text-sm mt-1">총 ${list.length}명</p>
    </div>

    <div class="flex flex-wrap gap-2 mb-4 items-center">
      <form method="GET" action="/personnel" class="flex gap-2 flex-wrap">
        <input type="text" name="search" value="${search}"
          placeholder="이름 / 회사 검색..."
          class="border border-slate-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-300">
        <select name="grade" class="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
          ${gradeOptions}
        </select>
        <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
          <i class="fas fa-search mr-1"></i>검색
        </button>
      </form>
    </div>

    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-200">
              <th class="px-4 py-3 text-center w-10">#</th>
              <th class="px-4 py-3 text-left">이름</th>
              <th class="px-4 py-3 text-left">직위</th>
              <th class="px-4 py-3 text-left">소속</th>
              <th class="px-4 py-3 text-center">상근여부</th>
              <th class="px-4 py-3 text-center">감리등급</th>
              <th class="px-4 py-3 text-center">자격번호</th>
              <th class="px-4 py-3 text-center">감리경력</th>
              <th class="px-4 py-3 text-center">자격증</th>
              <th class="px-4 py-3 text-center">감리실적</th>
              <th class="px-4 py-3 text-left">연락처</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows || '<tr><td colspan="11" class="px-4 py-12 text-center text-slate-400">데이터가 없습니다.<br><a href="/upload" class="text-indigo-500 underline mt-2 inline-block">HTML 파일을 업로드해주세요</a></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>`

  return c.html(layout('인력정보', body, 'personnel'))
})

// ── 인력 상세 ─────────────────────────────────────────────────
app.get('/personnel/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.redirect('/personnel')

  const person = await queryOne<Record<string, unknown>>(
    'SELECT * FROM personnel WHERE id = $1', [id]
  )
  if (!person) return c.html(layout('없음', '<div class="p-8 text-center text-red-500">인력 정보를 찾을 수 없습니다</div>', 'personnel'))

  const [certs, auditHistory, itCareer] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM personnel_certifications WHERE personnel_id = $1 ORDER BY cert_year DESC', [id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM personnel_audit_history WHERE personnel_id = $1 ORDER BY audit_yearmonth ASC', [id]
    ),
    query<Record<string, unknown>>(
      'SELECT * FROM personnel_it_career WHERE personnel_id = $1 ORDER BY period_start DESC', [id]
    ),
  ])

  // 감리 실적 표시용 정렬: 최신순(DESC)
  const auditHistoryDesc = [...auditHistory].reverse()

  // 감리경력 동적 계산: audit_history 최솟값 → fmtCareer로 n년 n개월
  const toSortableYM = (ym: string): string => {
    const m = String(ym).match(/(\d{4})[.\s년](\d{1,2})/)
    return m ? `${m[1]}.${m[2].padStart(2, '0')}` : String(ym)
  }
  const sortedYM = auditHistory
    .map(h => toSortableYM(String(h.audit_yearmonth ?? '')))
    .filter(s => /^\d{4}\.\d{2}$/.test(s))
    .sort()
  const dynamicStartDate: string | null = sortedYM[0] ?? null

  // 자격증 목록
  const certRows = certs.map(cert => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-2.5 text-sm font-medium text-slate-800">${cert.cert_name}</td>
      <td class="px-4 py-2.5 text-sm text-slate-600 text-center">${cert.cert_year ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-600">${cert.issuer ?? '-'}</td>
      <td class="px-4 py-2.5 text-center">
        <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cert.is_national ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}">
          ${cert.is_national ? '국가자격' : '민간자격'}
        </span>
      </td>
      <td class="px-4 py-2.5 text-sm text-slate-500">${cert.related_field ?? '-'}</td>
    </tr>`).join('')

  // 감리 실적 목록
  const auditRows = auditHistoryDesc.map(h => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-2.5 text-sm text-slate-600 text-center whitespace-nowrap">${h.audit_yearmonth ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm font-medium text-slate-800 max-w-xs">
        <div class="line-clamp-2">${h.project_name}</div>
      </td>
      <td class="px-4 py-2.5 text-sm text-slate-600">${h.client_org ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${h.sector ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${h.domain ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${h.role ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${h.phase ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${h.participation_rate != null ? h.participation_rate + '%' : '-'}</td>
    </tr>`).join('')

  // IT 경력 목록
  const careerRows = itCareer.map(c2 => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">${c2.period_start ?? ''} ~ ${c2.period_end ?? ''}</td>
      <td class="px-4 py-2.5 text-sm font-medium text-slate-800 max-w-xs">
        <div class="line-clamp-2">${c2.project_name}</div>
      </td>
      <td class="px-4 py-2.5 text-sm text-slate-600">${c2.client_org ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${c2.domain ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500 text-center">${c2.role ?? '-'}</td>
      <td class="px-4 py-2.5 text-sm text-slate-500">${c2.company ?? '-'}</td>
      <td class="px-4 py-2.5 text-xs text-slate-400">${c2.remarks ?? '-'}</td>
    </tr>`).join('')

  // 기본 정보 항목 헬퍼
  const infoItem = (label: string, value: string) =>
    `<div class="flex gap-2 py-2 border-b border-slate-100 last:border-0">
      <span class="text-slate-400 text-xs w-24 flex-shrink-0 mt-0.5">${label}</span>
      <span class="text-sm text-slate-800 flex-1">${value || '-'}</span>
    </div>`

  const gradeBadge = (grade: string | null) => {
    const map: Record<string, string> = {
      '특급': 'bg-purple-100 text-purple-700',
      '고급': 'bg-blue-100 text-blue-700',
      '중급': 'bg-teal-100 text-teal-700',
      '초급': 'bg-slate-100 text-slate-600',
    }
    const cls = map[grade as string] ?? 'bg-slate-100 text-slate-500'
    return `<span class="inline-block px-3 py-1 rounded-full text-sm font-bold ${cls}">${grade ?? '-'}</span>`
  }

  const body = `
  <div class="p-6 md:p-8">
    <!-- 뒤로가기 + 헤더 -->
    <div class="mb-6 flex items-start gap-4">
      <a href="/personnel" class="mt-1 text-slate-400 hover:text-slate-600 transition">
        <i class="fas fa-arrow-left text-lg"></i>
      </a>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-3 flex-wrap mb-2">
          ${gradeBadge(person.auditor_grade as string)}
          <span class="inline-block px-2 py-1 rounded-full text-xs font-medium ${person.is_fulltime ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}">
            ${person.is_fulltime ? '상근' : '비상근'}
          </span>
          ${person.tech_grade ? `<span class="inline-block px-2 py-1 rounded-full text-xs bg-green-50 text-green-700">기술등급: ${person.tech_grade}</span>` : ''}
        </div>
        <h1 class="text-2xl font-bold text-slate-800">${person.name}</h1>
        <p class="text-slate-500 text-sm mt-1">${person.position ?? ''} ${person.company ? '· ' + person.company : ''}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <!-- 왼쪽 메인 -->
      <div class="xl:col-span-2 space-y-6">

        <!-- 감리 실적 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-slate-700 text-white font-semibold text-sm flex items-center justify-between">
            <span><i class="fas fa-history mr-2"></i>감리 실적 (${auditHistoryDesc.length}건)</span>
          </div>
          ${auditHistory.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <th class="px-4 py-2.5 text-center whitespace-nowrap">년월</th>
                  <th class="px-4 py-2.5 text-left">사업명</th>
                  <th class="px-4 py-2.5 text-left">발주기관</th>
                  <th class="px-4 py-2.5 text-center">사업분야</th>
                  <th class="px-4 py-2.5 text-center">감리분야</th>
                  <th class="px-4 py-2.5 text-center">역할</th>
                  <th class="px-4 py-2.5 text-center">단계</th>
                  <th class="px-4 py-2.5 text-center">참여율</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">${auditRows}</tbody>
            </table>
          </div>` : `
          <div class="px-4 py-8 text-center text-slate-400 text-sm">감리 실적이 없습니다</div>`}
        </div>

        <!-- IT 경력 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-5 py-3 bg-indigo-700 text-white font-semibold text-sm">
            <i class="fas fa-laptop-code mr-2"></i>IT 경력 (${itCareer.length}건)
          </div>
          ${itCareer.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <th class="px-4 py-2.5 text-center">기간</th>
                  <th class="px-4 py-2.5 text-left">사업명</th>
                  <th class="px-4 py-2.5 text-left">발주기관</th>
                  <th class="px-4 py-2.5 text-center">분야</th>
                  <th class="px-4 py-2.5 text-center">역할</th>
                  <th class="px-4 py-2.5 text-left">수행사</th>
                  <th class="px-4 py-2.5 text-left">비고</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">${careerRows}</tbody>
            </table>
          </div>` : `
          <div class="px-4 py-8 text-center text-slate-400 text-sm">IT 경력이 없습니다</div>`}
        </div>

        <!-- 경력 요약 (career_summary가 있을 경우) -->
        ${person.career_summary ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-align-left mr-2 text-slate-400"></i>경력 요약</h3>
          <p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">${person.career_summary}</p>
        </div>` : ''}

      </div>

      <!-- 오른쪽 사이드 -->
      <div class="space-y-6">

        <!-- 기본 정보 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-id-card mr-2 text-slate-400"></i>기본 정보</h3>
          <div>
            ${infoItem('감리자격번호', String(person.auditor_cert_no ?? '-'))}
            ${infoItem('감리등급', String(person.auditor_grade ?? '-'))}
            ${infoItem('기술등급', String(person.tech_grade ?? '-'))}
            ${infoItem('감리경력', fmtCareer(dynamicStartDate ?? String(person.auditor_start_date ?? '')))}
            ${infoItem('감리시작일', dynamicStartDate ?? String(person.auditor_start_date ?? '-'))}
            ${infoItem('이메일', String(person.email ?? '-'))}
            ${infoItem('연락처', String(person.phone ?? '-'))}
            ${infoItem('생년월일', String(person.birthdate ?? '-'))}
          </div>
        </div>

        <!-- 학력 -->
        ${(person.school || person.major || person.degree) ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-graduation-cap mr-2 text-slate-400"></i>학력</h3>
          <div>
            ${infoItem('학교', String(person.school ?? '-'))}
            ${infoItem('전공', String(person.major ?? '-'))}
            ${infoItem('학위', String(person.degree ?? '-'))}
          </div>
        </div>` : ''}

        <!-- 자격증 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div class="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <h3 class="font-bold text-amber-700 text-sm"><i class="fas fa-certificate mr-2"></i>자격증 (${certs.length}개)</h3>
          </div>
          ${certs.length > 0 ? `
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="bg-slate-50 text-xs text-slate-500 border-b">
                  <th class="px-4 py-2 text-left">자격증명</th>
                  <th class="px-4 py-2 text-center">취득연도</th>
                  <th class="px-4 py-2 text-left">발급기관</th>
                  <th class="px-4 py-2 text-center">구분</th>
                  <th class="px-4 py-2 text-left">분야</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">${certRows}</tbody>
            </table>
          </div>` : `
          <div class="px-4 py-6 text-center text-slate-400 text-sm">등록된 자격증이 없습니다</div>`}
        </div>

        <!-- 교육 이력 -->
        ${(person.education_name || person.education_org) ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 class="font-bold text-slate-700 mb-3 text-sm"><i class="fas fa-chalkboard-teacher mr-2 text-slate-400"></i>교육 이력</h3>
          <div>
            ${infoItem('교육명', String(person.education_name ?? '-'))}
            ${infoItem('교육기관', String(person.education_org ?? '-'))}
            ${infoItem('교육시간', person.education_hours != null ? person.education_hours + '시간' : '-')}
          </div>
        </div>` : ''}

        <!-- 전문 역량 -->
        ${person.career_qualif ? `
        <div class="bg-teal-50 rounded-2xl border border-teal-200 p-5">
          <h3 class="font-bold text-teal-700 mb-2 text-sm"><i class="fas fa-star mr-2"></i>주요 경력 및 자격</h3>
          <p class="text-xs text-teal-800 whitespace-pre-line leading-relaxed">${person.career_qualif}</p>
        </div>` : ''}

        ${person.career_project ? `
        <div class="bg-orange-50 rounded-2xl border border-orange-200 p-5">
          <h3 class="font-bold text-orange-700 mb-2 text-sm"><i class="fas fa-code mr-2"></i>시스템 개발 / 프로젝트 실무 경력</h3>
          <p class="text-xs text-orange-800 whitespace-pre-line leading-relaxed">${person.career_project}</p>
        </div>` : ''}

        ${person.career_expert ? `
        <div class="bg-violet-50 rounded-2xl border border-violet-200 p-5">
          <h3 class="font-bold text-violet-700 mb-2 text-sm"><i class="fas fa-lightbulb mr-2"></i>주요 이력 (전문가용)</h3>
          <p class="text-xs text-violet-800 whitespace-pre-line leading-relaxed">${person.career_expert}</p>
        </div>` : ''}

      </div>
    </div>
  </div>`

  return c.html(layout(String(person.name), body, 'personnel'))
})

// ── HTML 파일 업로드 페이지 ───────────────────────────────────
app.get('/upload', (c) => {
  const body = `
  <div class="p-6 md:p-8">
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-slate-800">HTML 파일 업로드</h1>
      <p class="text-slate-500 text-sm mt-1">인력 프로파일 또는 사업 제안작업표 HTML을 업로드하면 자동으로 파싱하여 DB에 적재합니다.</p>
      <p class="text-amber-600 text-xs mt-1 font-medium">
        <i class="fas fa-exclamation-triangle mr-1"></i>동일한 이름(인력명/사업명)이 이미 존재하면 덮어씁니다.
        <span class="ml-2 text-slate-400">· 1회 최대 <strong class="text-indigo-600">10개</strong> 파일 병렬 처리</span>
      </p>
    </div>

    <style>
      .drop-zone { border: 2px dashed #94a3b8; transition: border-color .2s, background .2s; }
      .drop-zone.dragover { border-color: #6366f1; background: #eef2ff; }
      .log-line { font-family: monospace; font-size: 13px; }
      .log-ok   { color: #4ade80; }
      .log-err  { color: #f87171; }
      .log-info { color: #60a5fa; }
    </style>

    <div class="grid md:grid-cols-2 gap-6 mb-8">

      <!-- 인력 업로드 카드 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <i class="fas fa-user text-blue-600"></i>
          </div>
          <div>
            <h2 class="font-bold text-slate-800">인력 프로파일</h2>
            <p class="text-xs text-slate-400">프로파일(성명).html · 최대 10개</p>
          </div>
        </div>
        <div id="drop-personnel"
             class="drop-zone rounded-xl p-6 text-center cursor-pointer mb-3"
             onclick="document.getElementById('file-personnel').click()">
          <i class="fas fa-cloud-upload-alt text-3xl text-slate-300 mb-2 block"></i>
          <p class="text-sm text-slate-500">파일을 여기에 드래그하거나 클릭하여 선택</p>
          <p id="fname-personnel" class="text-xs text-indigo-600 mt-1 font-medium"></p>
        </div>
        <input type="file" id="file-personnel" accept=".html" multiple class="hidden">
        <ul id="filelist-personnel" class="mb-3 space-y-1 max-h-32 overflow-y-auto hidden"></ul>
        <button id="btn-personnel" onclick="uploadFiles('personnel')"
                class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition disabled:opacity-40"
                disabled>
          <i class="fas fa-upload mr-2"></i>인력 DB 적재
        </button>
        <div id="progress-personnel" class="mt-3 hidden">
          <div class="flex justify-between text-xs text-slate-500 mb-1">
            <span>처리 중...</span><span id="progress-personnel-text">0 / 0</span>
          </div>
          <div class="w-full bg-slate-200 rounded-full h-2">
            <div id="progress-personnel-bar" class="bg-blue-500 h-2 rounded-full transition-all" style="width:0%"></div>
          </div>
        </div>
        <div id="result-personnel" class="mt-4 hidden">
          <div class="bg-slate-50 rounded-xl p-4 text-sm space-y-1" id="result-personnel-inner"></div>
        </div>
      </div>

      <!-- 사업 업로드 카드 -->
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <i class="fas fa-briefcase text-emerald-600"></i>
          </div>
          <div>
            <h2 class="font-bold text-slate-800">사업 제안작업표</h2>
            <p class="text-xs text-slate-400">[사업명] 감리 용역.html · 최대 10개</p>
          </div>
        </div>
        <div id="drop-project"
             class="drop-zone rounded-xl p-6 text-center cursor-pointer mb-3"
             onclick="document.getElementById('file-project').click()">
          <i class="fas fa-cloud-upload-alt text-3xl text-slate-300 mb-2 block"></i>
          <p class="text-sm text-slate-500">파일을 여기에 드래그하거나 클릭하여 선택</p>
          <p id="fname-project" class="text-xs text-emerald-600 mt-1 font-medium"></p>
        </div>
        <input type="file" id="file-project" accept=".html" multiple class="hidden">
        <ul id="filelist-project" class="mb-3 space-y-1 max-h-32 overflow-y-auto hidden"></ul>
        <button id="btn-project" onclick="uploadFiles('project')"
                class="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition disabled:opacity-40"
                disabled>
          <i class="fas fa-upload mr-2"></i>사업 DB 적재
        </button>
        <div id="progress-project" class="mt-3 hidden">
          <div class="flex justify-between text-xs text-slate-500 mb-1">
            <span>처리 중...</span><span id="progress-project-text">0 / 0</span>
          </div>
          <div class="w-full bg-slate-200 rounded-full h-2">
            <div id="progress-project-bar" class="bg-emerald-500 h-2 rounded-full transition-all" style="width:0%"></div>
          </div>
        </div>
        <div id="result-project" class="mt-4 hidden">
          <div class="bg-slate-50 rounded-xl p-4 text-sm space-y-1" id="result-project-inner"></div>
        </div>
      </div>
    </div>

    <!-- 처리 로그 -->
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-700 text-sm"><i class="fas fa-terminal mr-2 text-slate-400"></i>처리 로그</h3>
        <button onclick="clearLog()" class="text-xs text-slate-400 hover:text-slate-600 transition">초기화</button>
      </div>
      <div id="log" class="min-h-16 max-h-64 overflow-y-auto space-y-0.5 bg-slate-900 rounded-xl p-4">
        <p class="log-line log-info">대기 중... HTML 파일을 선택해주세요.</p>
      </div>
    </div>
  </div>

  <script>
  const MAX_FILES = 10
  const state = { personnel: [], project: [] }

  // ── 알럿 (카드 하단 인라인) ──────────────────────────────────
  function showAlert(type, msg) {
    const id = 'alert-' + type
    let el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.className = 'mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2 items-start'
      // 카드 내부 drop-zone 위쪽에 삽입
      const card = document.getElementById('drop-' + type).closest('.bg-white')
      card.appendChild(el)
    }
    el.innerHTML = \`<i class="fas fa-exclamation-circle mt-0.5 flex-shrink-0"></i><span class="whitespace-pre-line">\${msg}</span>
      <button onclick="document.getElementById('\${id}').remove()" class="ml-auto text-red-400 hover:text-red-600 flex-shrink-0"><i class="fas fa-times"></i></button>\`
  }

  function renderFileList(type) {
    const files = state[type]
    const ul = document.getElementById('filelist-' + type)
    const nameEl = document.getElementById('fname-' + type)
    const btn = document.getElementById('btn-' + type)
    if (files.length === 0) {
      ul.classList.add('hidden'); nameEl.textContent = ''; btn.disabled = true; return
    }
    ul.classList.remove('hidden')
    ul.innerHTML = files.map((f, i) =>
      \`<li class="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-1.5">
        <span class="text-slate-700 truncate max-w-[180px]"><i class="fas fa-file-code mr-1 text-slate-400"></i>\${f.name}</span>
        <button onclick="removeFile('\${type}', \${i})" class="text-slate-300 hover:text-red-500 ml-2"><i class="fas fa-times"></i></button>
      </li>\`
    ).join('')
    nameEl.textContent = files.length + '개 파일 선택됨'
    btn.disabled = false
  }

  function removeFile(type, idx) { state[type].splice(idx, 1); renderFileList(type) }

  function setupDrop(type) {
    const zone = document.getElementById('drop-' + type)
    const input = document.getElementById('file-' + type)
    input.addEventListener('change', () => { handleFiles(type, Array.from(input.files)); input.value = '' })
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover') })
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'))
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleFiles(type, Array.from(e.dataTransfer.files)) })
  }

  function handleFiles(type, newFiles) {
    const htmlFiles = newFiles.filter(f => f.name.endsWith('.html'))
    const nonHtml = newFiles.length - htmlFiles.length
    if (nonHtml > 0) addLog('err', nonHtml + '개 파일은 HTML이 아니어서 제외됨')

    const merged = [...state[type], ...htmlFiles]

    // 10개 초과 시 알럿 + 추가 자체 차단
    if (merged.length > MAX_FILES) {
      const over = merged.length - MAX_FILES
      showAlert(type,
        \`파일은 최대 \${MAX_FILES}개까지만 업로드할 수 있습니다.\\n현재 \${state[type].length}개 선택됨 + 새 파일 \${htmlFiles.length}개 = \${merged.length}개 (초과: \${over}개)\\n\\n먼저 기존 파일을 제거하거나, 파일을 \${MAX_FILES - state[type].length}개 이하로 선택해 주세요.\`
      )
      addLog('err', \`❌ 파일 추가 불가: 최대 \${MAX_FILES}개 초과 (선택 \${merged.length}개)\`)
      return  // 추가하지 않고 즉시 종료
    }

    state[type] = merged
    if (htmlFiles.length > 0) addLog('info', htmlFiles.length + '개 파일 추가됨 (총 ' + state[type].length + '개)')
    renderFileList(type)
  }

  setupDrop('personnel')
  setupDrop('project')

  async function uploadFiles(type) {
    const files = state[type]
    if (files.length === 0) return
    const btn = document.getElementById('btn-' + type)
    const progressEl = document.getElementById('progress-' + type)
    const progressBar = document.getElementById('progress-' + type + '-bar')
    const progressText = document.getElementById('progress-' + type + '-text')
    const resultEl = document.getElementById('result-' + type)

    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>처리 중...'
    progressEl.classList.remove('hidden')
    resultEl.classList.add('hidden')

    const total = files.length
    let done = 0
    const results = []
    addLog('info', \`[\${type}] \${total}개 파일 병렬 업로드 시작\`)
    const endpoint = type === 'personnel' ? '/api/upload/personnel' : '/api/upload/project'

    await Promise.all(files.map(async (file) => {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const res = await fetch(endpoint, { method: 'POST', body: formData })
        const json = await res.json()
        done++
        progressBar.style.width = (done / total * 100) + '%'
        progressText.textContent = done + ' / ' + total
        if (json.ok) { addLog('ok', '✅ ' + file.name + ' → ' + (json.message || '완료')); results.push({ ok: true, file: file.name, data: json.data }) }
        else          { addLog('err', '❌ ' + file.name + ' → ' + (json.error || '오류')); results.push({ ok: false, file: file.name, error: json.error }) }
      } catch (e) {
        done++
        progressBar.style.width = (done / total * 100) + '%'
        progressText.textContent = done + ' / ' + total
        addLog('err', '❌ ' + file.name + ' → 네트워크 오류: ' + e.message)
        results.push({ ok: false, file: file.name, error: e.message })
      }
    }))

    const okCount = results.filter(r => r.ok).length
    const errCount = results.length - okCount
    addLog(errCount === 0 ? 'ok' : 'err', \`[\${type}] 완료 — 성공: \${okCount}개 / 실패: \${errCount}개\`)
    showBatchResult(type, results)
    btn.innerHTML = '<i class="fas fa-check mr-2"></i>완료 (재업로드 가능)'
    btn.disabled = false
    progressEl.classList.add('hidden')
    state[type] = state[type].filter((f, i) => !results[i]?.ok)
    renderFileList(type)
    if (state[type].length > 0) addLog('info', '실패한 ' + state[type].length + '개 파일이 목록에 남아있습니다.')
  }

  function showBatchResult(type, results) {
    const el = document.getElementById('result-' + type)
    const inner = document.getElementById('result-' + type + '-inner')
    el.classList.remove('hidden')
    const okList = results.filter(r => r.ok)
    const errList = results.filter(r => !r.ok)
    let html = ''
    if (okList.length > 0) {
      html += \`<p class="text-green-600 font-semibold mb-2"><i class="fas fa-check-circle mr-1"></i>성공 \${okList.length}개</p>\`
      html += okList.map(r => {
        const d = r.data
        return type === 'personnel'
          ? \`<div class="text-xs bg-white rounded-lg px-3 py-2 mb-1 border border-slate-100"><span class="font-medium text-slate-700">\${d.name}</span><span class="text-slate-400 ml-2">자격증 \${d.certifications}건 · 감리실적 \${d.audit_history}건 · IT경력 \${d.it_career}건</span></div>\`
          : \`<div class="text-xs bg-white rounded-lg px-3 py-2 mb-1 border border-slate-100"><span class="font-medium text-slate-700">\${d.project_name}</span><span class="text-slate-400 ml-2">키워드 \${d.keywords}개 · 단계 \${d.phases} · 인력 \${d.proposal_members}명</span></div>\`
      }).join('')
    }
    if (errList.length > 0) {
      html += \`<p class="text-red-600 font-semibold mt-2 mb-1"><i class="fas fa-times-circle mr-1"></i>실패 \${errList.length}개</p>\`
      html += errList.map(r => \`<div class="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1.5 mb-1">\${r.file}: \${r.error}</div>\`).join('')
    }
    inner.innerHTML = html
  }

  function addLog(type, msg) {
    const log = document.getElementById('log')
    const p = document.createElement('p')
    const ts = new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})
    p.className = 'log-line log-' + type
    p.textContent = '[' + ts + '] ' + msg
    log.appendChild(p)
    log.scrollTop = log.scrollHeight
  }

  function clearLog() { document.getElementById('log').innerHTML = '<p class="log-line log-info">로그 초기화됨</p>' }
  </script>`

  return c.html(layout('HTML 업로드', body, 'upload'))
})

// ── 사업별 PPT 생성 페이지 ───────────────────────────────────────
app.get('/ppt-generate', (c) => {
  // [ppt-portal 추가 기능] "첨부PPT 생성" 위젯 준비 — html/script를 아래 body/스크립트
  // 안의 표시된 지점에 그대로 끼워 넣는다. 위젯 자체의 내용은 전부
  // src/views/attachment-bundle-widget.ts 에 있고, 여기서는 "어디에 꽂는지"만 정한다.
  const bundleWidget = renderAttachmentBundleWidget()
  const body = `
  <div class="p-6 md:p-8 max-w-5xl" id="pptGenRoot">
    <h1 class="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-1">
      <i class="fas fa-file-powerpoint text-indigo-500"></i> 사업별 PPT 생성
    </h1>
    <p class="text-sm text-slate-500 mb-6">
      DB에 적재된 사업 목록입니다. 아래에서 첨부 템플릿을 먼저 업로드한 뒤,
      원하는 사업의 "PPT 생성" 버튼을 누르면 템플릿의 플레이스홀더가 해당 사업 데이터로
      치환된 pptx 파일이 바로 다운로드됩니다.
    </p>

    <!-- 첨부 템플릿 업로드 -->
    <div class="bg-white rounded-xl border border-slate-200 p-5 mb-6 space-y-5">
      <div>
        <h2 class="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
          <i class="fas fa-paperclip text-amber-500"></i> 첨부 템플릿 (범용 — {{TOKEN}} 방식)
        </h2>
        <p class="text-xs text-slate-400 mb-3">
          이 파일은 서버에 저장되지 않고, "PPT 생성" 클릭 시에만 그 요청 처리 중에 잠깐 사용되고 폐기됩니다.
        </p>
        <input id="tplFileInput" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
               class="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4
                      file:rounded-lg file:border-0 file:text-sm file:font-semibold
                      file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" />
        <div id="tplStatus" class="mt-2 text-xs font-medium text-slate-400">선택된 템플릿 없음</div>

        <details class="mt-4">
          <summary class="text-xs text-indigo-600 cursor-pointer font-medium">지원되는 플레이스홀더 보기</summary>
          <div class="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed font-mono">
            {{PROJECT_NAME}} {{CLIENT_ORG}} {{BID_NOTICE_NO}} {{REGISTERED_YM}} {{BID_DEADLINE}}<br>
            {{BID_AMOUNT}} {{REQUIRED_MD}} {{PROPOSED_MD}} {{WRITER}} {{DIRECTOR}}<br>
            {{TARGET_PROJECT_NAME}} {{TARGET_CLIENT_ORG}} {{TARGET_CONTRACTOR}}<br>
            {{TARGET_PERIOD_START}} {{TARGET_PERIOD_END}}
          </div>
        </details>
      </div>

    </div>

    ${bundleWidget.html}

    <!-- 검색 -->
    <div class="mb-3">
      <input id="searchInput" type="text" placeholder="사업명 / 발주처 검색"
             class="w-full md:w-80 px-3 py-2 border border-slate-200 rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-300" />
    </div>

    <!-- 사업 목록 -->
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="px-4 py-3 text-left font-semibold text-slate-500">사업명</th>
            <th class="px-4 py-3 text-left font-semibold text-slate-500">발주처</th>
            <th class="px-4 py-3 text-center font-semibold text-slate-500">등록연월</th>
            <th class="px-4 py-3 text-center font-semibold text-slate-500">마감일</th>
            <th class="px-4 py-3 text-center font-semibold text-slate-500">상태</th>
            <th class="px-4 py-3 text-center font-semibold text-slate-500">PPT</th>
            <!-- [ppt-portal 추가 기능] 열 하나 -->
            <th class="px-4 py-3 text-center font-semibold text-slate-500">첨부PPT</th>
          </tr>
        </thead>
        <tbody id="projectListBody">
          <tr><td colspan="7" class="px-4 py-10 text-center text-slate-400">불러오는 중...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
  let templateFile = null

  const tplInput  = document.getElementById('tplFileInput')
  const tplStatus = document.getElementById('tplStatus')
  tplInput.addEventListener('change', () => {
    templateFile = tplInput.files && tplInput.files[0] ? tplInput.files[0] : null
    tplStatus.textContent = templateFile
      ? '✅ 선택됨: ' + templateFile.name + ' (' + Math.round(templateFile.size / 1024) + 'KB) — 이 세션 동안만 메모리에 보관됩니다'
      : '선택된 템플릿 없음'
    tplStatus.className = templateFile ? 'mt-2 text-xs font-medium text-emerald-600' : 'mt-2 text-xs font-medium text-slate-400'
  })

  // [ppt-portal 추가 기능] "첨부PPT 생성" 위젯의 JS(BUNDLE_ITEM_DEFS, openBundleModal,
  // confirmGenerateBundle 등)는 여기 없습니다 — 이 <script> 태그와 절대 안 섞이도록
  // src/views/attachment-bundle-widget.ts 안에서 "별도의" <script> 태그로 아래쪽에
  // 따로 렌더링됩니다(파일 끝의 \` + '<script>' + bundleWidget.script + ... \` 부분 참고).
  // loadProjects()가 만드는 "첨부PPT 생성" 버튼의 onclick="openBundleModal(...)"이
  // 그 스크립트가 전역에 등록해두는 함수를 이름으로 호출하는 것뿐이라, 여기서
  // import하거나 신경 쓸 게 없습니다.

  async function loadProjects(search) {
    const tbody = document.getElementById('projectListBody')
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-400">불러오는 중...</td></tr>'
    try {
      const url = '/api/audit-projects' + (search ? '?search=' + encodeURIComponent(search) : '')
      const r = await fetch(url)
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || '조회 실패')
      const rows = j.data || []
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-slate-400">등록된 사업이 없습니다</td></tr>'
        return
      }
      tbody.innerHTML = rows.map(p => \`
        <tr class="hover:bg-indigo-50 transition border-b border-slate-100 last:border-0">
          <td class="px-4 py-3 font-medium text-slate-700">\${escapeHtml(p.project_name || '-')}</td>
          <td class="px-4 py-3 text-slate-600">\${escapeHtml(p.client_org || '-')}</td>
          <td class="px-4 py-3 text-center text-slate-600">\${escapeHtml(p.registered_yearmonth || '-')}</td>
          <td class="px-4 py-3 text-center text-slate-600">\${escapeHtml(p.bid_deadline || '-')}</td>
          <td class="px-4 py-3 text-center">
            <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">\${escapeHtml(p.proposal_status || '-')}</span>
          </td>
          <td class="px-4 py-3 text-center">
            <button onclick="generatePpt(\${p.id}, this)"
              class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              <i class="fas fa-download"></i> PPT 생성
            </button>
          </td>
          <!-- ▼ [ppt-portal 추가 기능] 여기 버튼 셀 하나만 이 테이블의 유일한 추가 지점입니다.
               openBundleModal()은 attachment-bundle-widget.ts의 별도 스크립트가 전역에 등록합니다. -->
          <td class="px-4 py-3 text-center">
            <button onclick="openBundleModal(\${p.id}, this)"
              class="bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              <i class="fas fa-paperclip"></i> 첨부PPT 생성
            </button>
          </td>
          <!-- ▲ [ppt-portal 추가 기능] 끝 -->
        </tr>\`).join('')
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-red-500">' + escapeHtml(e.message) + '</td></tr>'
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
  }

  async function generatePpt(id, btnEl) {
    if (!templateFile) {
      alert('먼저 첨부 템플릿(.pptx)을 업로드해주세요.')
      return
    }
    const originalHtml = btnEl.innerHTML
    btnEl.disabled = true
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...'
    try {
      const fd = new FormData()
      fd.append('template', templateFile)
      const r = await fetch('/api/ppt-generate/' + id, { method: 'POST', body: fd })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || ('생성 실패 (' + r.status + ')'))
      }
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\\*?=["']?(?:UTF-8'')?([^"';]+)/i)
      const filename = m ? decodeURIComponent(m[1]) : ('proposal_' + id + '.pptx')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('PPT 생성 실패: ' + e.message)
    } finally {
      btnEl.disabled = false
      btnEl.innerHTML = originalHtml
    }
  }

  let searchTimer
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => loadProjects(e.target.value), 300)
  })

  loadProjects('')
  </script>

  <!-- ▼ [ppt-portal 추가 기능] 첨부PPT 위젯 전용 스크립트 — 위 <script>와 일부러 분리했습니다.
       이 화면에서 "첨부PPT 생성" 기능만 떼어낼 때, 위 <script> 블록은 그대로 두고
       이 <script> 태그와 위쪽의 bundleWidget.html 부분만 들어내면 됩니다. -->
  <script>${bundleWidget.script}</script>
  <!-- ▲ [ppt-portal 추가 기능] 끝 -->
  `
  return c.html(layout('사업별 PPT 생성', body, 'ppt-generate'))
})

// ── PPT 템플릿 관리 페이지 ─────────────────────────────────────
app.get('/ppt-templates', async (c) => {
  const body = `
  <div class="p-6 md:p-8" id="pptMgrRoot">

    <div class="mb-6 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <i class="fas fa-layer-group text-indigo-500"></i> PPT 목차/메뉴 관리
        </h1>
        <p class="text-slate-500 text-sm mt-1">각 목차 메뉴별 생성 규칙·템플릿을 설정합니다.</p>
      </div>
      <div class="flex gap-2">
        <button onclick="runMigrate()" class="px-3 py-1.5 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition">
          <i class="fas fa-database mr-1"></i>테이블 생성
        </button>
        <button onclick="runSeed()" class="px-3 py-1.5 text-xs rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 transition">
          <i class="fas fa-seedling mr-1"></i>기본 메뉴 시드
        </button>
        <button onclick="openMasterModal()" class="px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition">
          <i class="fas fa-layer-group mr-1"></i>마스터 템플릿
        </button>
      </div>
    </div>

    <div id="pptAlert" class="hidden mb-4 p-3 rounded-lg text-sm font-medium"></div>

    <!-- 2-panel layout -->
    <div class="flex gap-5" style="min-height:600px">

      <!-- LEFT: 메뉴 트리 -->
      <div class="w-72 flex-shrink-0">
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div class="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span class="text-sm font-semibold text-slate-700"><i class="fas fa-sitemap mr-2 text-indigo-400"></i>목차 메뉴</span>
            <button onclick="loadTree()" class="text-xs text-slate-400 hover:text-indigo-500"><i class="fas fa-sync-alt"></i></button>
          </div>
          <div id="menuTree" class="p-2 overflow-y-auto" style="max-height:560px">
            <div class="text-center text-slate-400 text-sm py-6"><i class="fas fa-spinner fa-spin mr-1"></i>로딩 중...</div>
          </div>
        </div>
      </div>

      <!-- RIGHT: 상세 설정 패널 -->
      <div class="flex-1 min-w-0">
        <div id="detailPanel" class="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex items-center justify-center text-slate-400">
          <div class="text-center">
            <i class="fas fa-mouse-pointer text-4xl mb-3 opacity-30"></i>
            <p class="text-sm">왼쪽 트리에서 메뉴를 선택하세요</p>
          </div>
        </div>
      </div>

    </div>

    <!-- 마스터 템플릿 모달 -->
    <div id="masterModal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <!-- 헤더 -->
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="font-bold text-slate-800 text-base"><i class="fas fa-layer-group mr-2 text-violet-500"></i>마스터 템플릿 관리</h3>
            <p class="text-xs text-slate-400 mt-0.5">PPT 생성 시 활성화된 마스터의 슬라이드 마스터·테마·레이아웃이 전체 슬라이드에 적용됩니다</p>
          </div>
          <button onclick="closeMasterModal()" class="text-slate-400 hover:text-slate-700 ml-4"><i class="fas fa-times text-lg"></i></button>
        </div>

        <div class="flex flex-1 min-h-0">
          <!-- LEFT: 업로드 폼 -->
          <div class="w-64 flex-shrink-0 border-r border-slate-100 px-5 py-4 space-y-3 overflow-y-auto">
            <div class="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-2"><i class="fas fa-upload mr-1"></i>새 마스터 추가</div>
            <div>
              <label class="text-xs text-slate-500 mb-1 block">이름 <span class="text-red-400">*</span></label>
              <input id="masterNameInput" type="text" placeholder="예: 2026 표준 마스터"
                class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300">
            </div>
            <div>
              <label class="text-xs text-slate-500 mb-1 block">설명 (선택)</label>
              <input id="masterDescInput" type="text" placeholder="예: 파란 헤더 + 회사 로고"
                class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300">
            </div>
            <div>
              <label class="text-xs text-slate-500 mb-1 block">PPTX 파일 <span class="text-red-400">*</span></label>
              <input id="masterFileInput" type="file" accept=".pptx"
                class="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 cursor-pointer">
            </div>
            <div class="flex items-center gap-2">
              <input id="masterSetActive" type="checkbox" checked class="w-3.5 h-3.5 accent-violet-600">
              <label class="text-xs text-slate-600">업로드 후 바로 활성화</label>
            </div>
            <button id="masterUploadBtn" onclick="uploadMasterTemplate()"
              class="w-full py-2 text-xs rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium transition">
              <i class="fas fa-cloud-upload-alt mr-1"></i>업로드
            </button>
            <div id="masterUploadInfo" class="hidden text-xs text-violet-700 bg-violet-50 rounded-lg p-2 space-y-1">
              <div class="font-semibold">추출된 레이아웃:</div>
              <div id="masterUploadLayouts" class="text-slate-600"></div>
            </div>
          </div>

          <!-- RIGHT: 저장된 마스터 목록 -->
          <div class="flex-1 px-5 py-4 overflow-y-auto">
            <div class="flex items-center justify-between mb-3">
              <div class="text-xs font-semibold text-slate-700"><i class="fas fa-layer-group mr-1 text-violet-400"></i>저장된 마스터 템플릿</div>
              <button onclick="loadMasterList()" class="text-xs text-slate-400 hover:text-violet-500"><i class="fas fa-sync-alt"></i></button>
            </div>
            <div id="masterList" class="space-y-2">
              <div class="text-center text-slate-400 text-xs py-6"><i class="fas fa-spinner fa-spin mr-1"></i>로딩 중...</div>
            </div>
          </div>
        </div>

        <div class="px-6 py-3 border-t border-slate-100 flex justify-end flex-shrink-0">
          <button onclick="closeMasterModal()" class="px-4 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">닫기</button>
        </div>
      </div>
    </div>

    <!-- 프리셋 저장/불러오기 모달 -->
    <div id="presetModal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 class="font-bold text-slate-800"><i class="fas fa-bookmark mr-2 text-emerald-500"></i>규칙 설정 프리셋</h3>
          <button onclick="closePresetModal()" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>
        <div class="px-6 py-4">
          <!-- 현재 설정 저장 -->
          <div class="mb-4 bg-emerald-50 rounded-xl p-4 border border-emerald-200">
            <div class="text-xs font-semibold text-emerald-700 mb-2"><i class="fas fa-save mr-1"></i>현재 규칙 설정 저장</div>
            <div class="text-xs text-slate-500 mb-3">현재 선택된 메뉴의 규칙 설정값을 이름을 붙여 저장합니다.</div>
            <div class="flex gap-2">
              <input id="presetNameInput" type="text" placeholder="프리셋 이름 (예: 표준 사진장표 규칙)" class="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300">
              <button id="presetSaveBtn" onclick="savePreset()" class="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                <i class="fas fa-save mr-1"></i>저장
              </button>
            </div>
          </div>
          <!-- 저장된 프리셋 목록 -->
          <div>
            <div class="text-xs font-semibold text-slate-700 mb-2"><i class="fas fa-list mr-1"></i>저장된 프리셋</div>
            <div id="presetList" class="space-y-2 max-h-72 overflow-y-auto">
              <div class="text-center text-slate-400 text-xs py-4">저장된 프리셋이 없습니다</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 팝오버 요소 (툴팁) -->
    <div id="tipPopover" class="hidden fixed z-[100] bg-slate-800 text-white text-xs rounded-xl shadow-2xl p-4 w-72 pointer-events-none">
      <div id="tipTitle" class="font-bold text-sm mb-1 text-emerald-300"></div>
      <div id="tipDesc" class="text-slate-200 leading-relaxed mb-2"></div>
      <div id="tipExample" class="bg-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs"></div>
    </div>

    <!-- 메뉴 추가/수정 모달 -->
    <div id="menuModal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 class="font-bold text-slate-800" id="menuModalTitle">메뉴 추가</h3>
          <button onclick="closeMenuModal()" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>
        <div class="px-6 py-4 space-y-3">
          <input type="hidden" id="modalMenuId">
          <div>
            <label class="text-xs text-slate-500 font-medium mb-1 block">상위 메뉴 ID (선택)</label>
            <input id="modalParentId" type="number" placeholder="없으면 비워두기" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
          </div>
          <div>
            <label class="text-xs text-slate-500 font-medium mb-1 block">메뉴 코드 <span class="text-red-500">*</span></label>
            <input id="modalMenuCode" type="text" placeholder="예: DETAIL_SCHEDULE" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
          </div>
          <div>
            <label class="text-xs text-slate-500 font-medium mb-1 block">메뉴명 <span class="text-red-500">*</span></label>
            <input id="modalMenuName" type="text" placeholder="예: 세부 감리 일정" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-slate-500 font-medium mb-1 block">목차 번호</label>
              <input id="modalMenuNumber" type="text" placeholder="예: 다-2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            </div>
            <div>
              <label class="text-xs text-slate-500 font-medium mb-1 block">정렬 순서</label>
              <input id="modalSortOrder" type="number" value="100" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            </div>
          </div>
          <div class="flex items-center gap-2">
            <input id="modalIsEnabled" type="checkbox" checked class="w-4 h-4 accent-indigo-600">
            <label class="text-sm text-slate-600">사용 여부</label>
          </div>
        </div>
        <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onclick="closeMenuModal()" class="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">취소</button>
          <button onclick="saveMenu()" class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">저장</button>
        </div>
      </div>
    </div>

  </div>

  <script>
  // ── 상태 ──────────────────────────────────────────────────────
  let _selectedMenuId = null
  let _treeData = []

  // ── 알림 ──────────────────────────────────────────────────────
  function showAlert(msg, ok) {
    const el = document.getElementById('pptAlert')
    el.className = 'mb-4 p-3 rounded-lg text-sm font-medium ' + (ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')
    el.textContent = msg
    el.classList.remove('hidden')
    setTimeout(() => el.classList.add('hidden'), 4000)
  }

  // ── 마이그레이션 / 시드 ────────────────────────────────────────
  async function runMigrate() {
    const r = await fetch('/api/ppt-menus/migrate', { method: 'POST' })
    const j = await r.json()
    showAlert(j.ok ? '✅ ' + j.message : '❌ ' + j.error, j.ok)
  }

  async function runSeed() {
    const r = await fetch('/api/ppt-menus/seed', { method: 'POST' })
    const j = await r.json()
    showAlert(j.ok ? '✅ ' + j.message : '❌ ' + j.error, j.ok)
    if (j.ok) loadTree()
  }

  // ── 트리 로드 ─────────────────────────────────────────────────
  async function loadTree() {
    document.getElementById('menuTree').innerHTML =
      '<div class="text-center text-slate-400 text-sm py-6"><i class="fas fa-spinner fa-spin mr-1"></i>로딩 중...</div>'
    try {
      const r = await fetch('/api/ppt-menus')
      const j = await r.json()
      if (!j.ok) throw new Error(j.error)
      _treeData = j.data
      renderTree(j.data)
    } catch (e) {
      document.getElementById('menuTree').innerHTML =
        '<div class="text-center text-red-400 text-xs py-6">' + e.message + '</div>'
    }
  }

  function renderTree(nodes, depth = 0) {
    if (depth === 0) document.getElementById('menuTree').innerHTML = ''
    const container = depth === 0 ? document.getElementById('menuTree') : null
    let html = ''
    nodes.forEach(n => {
      const isSection = !n.parent_id
      const hasRule = !!n.rule
      const badgeColor = n.is_enabled ? (hasRule ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-600') : 'bg-slate-100 text-slate-400'
      const badge = hasRule ? '규칙' : (isSection ? '섹션' : '미설정')
      html += \`
        <div class="menu-item rounded-lg mb-0.5 \${_selectedMenuId === n.id ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'} cursor-pointer transition-all"
             style="padding-left:\${depth * 14 + 8}px"
             onclick="selectMenu(\${n.id})">
          <div class="flex items-center gap-1.5 py-1.5 pr-2">
            <i class="fas \${isSection ? 'fa-folder text-amber-400' : (hasRule ? 'fa-file-powerpoint text-indigo-400' : 'fa-file text-slate-300')} text-xs flex-shrink-0"></i>
            <span class="text-xs \${n.is_enabled ? 'text-slate-700' : 'text-slate-400 line-through'} flex-1 min-w-0 truncate" title="\${n.menu_name}">
              \${n.menu_number ? '<span class=\\"text-slate-400\\">' + n.menu_number + '</span> ' : ''}\${n.menu_name}
            </span>
            <span class="text-xs px-1.5 py-0.5 rounded-full font-medium \${badgeColor} flex-shrink-0">\${badge}</span>
          </div>
        </div>
        \${n.children && n.children.length ? renderTreeChildren(n.children, depth + 1) : ''}
      \`
    })
    if (container) container.innerHTML = html
    return html
  }

  function renderTreeChildren(nodes, depth) {
    let html = ''
    nodes.forEach(n => {
      const hasRule = !!n.rule
      const badgeColor = n.is_enabled ? (hasRule ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-600') : 'bg-slate-100 text-slate-400'
      const badge = hasRule ? '규칙' : '미설정'
      html += \`
        <div class="menu-item rounded-lg mb-0.5 \${_selectedMenuId === n.id ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'} cursor-pointer transition-all"
             style="padding-left:\${depth * 14 + 8}px"
             onclick="selectMenu(\${n.id})">
          <div class="flex items-center gap-1.5 py-1.5 pr-2">
            <i class="fas \${hasRule ? 'fa-file-powerpoint text-indigo-400' : 'fa-file text-slate-300'} text-xs flex-shrink-0"></i>
            <span class="text-xs \${n.is_enabled ? 'text-slate-700' : 'text-slate-400 line-through'} flex-1 min-w-0 truncate" title="\${n.menu_name}">
              \${n.menu_number ? '<span class=\\"text-slate-400\\">' + n.menu_number + '</span> ' : ''}\${n.menu_name}
            </span>
            <span class="text-xs px-1.5 py-0.5 rounded-full font-medium \${badgeColor} flex-shrink-0">\${badge}</span>
          </div>
        </div>
        \${n.children && n.children.length ? renderTreeChildren(n.children, depth + 1) : ''}
      \`
    })
    return html
  }

  // ── 메뉴 선택 → 상세 패널 ─────────────────────────────────────
  function findMenuById(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n
      if (n.children) { const f = findMenuById(n.children, id); if (f) return f }
    }
    return null
  }

  async function selectMenu(id) {
    _selectedMenuId = id
    renderTree(_treeData)  // 선택 상태 갱신
    const menu = findMenuById(_treeData, id)
    if (!menu) return

    // 템플릿 목록 로드
    let templates = []
    try {
      const r = await fetch('/api/ppt-menus/' + id + '/templates')
      const j = await r.json()
      if (j.ok) templates = j.data
    } catch (_) {}

    renderDetail(menu, templates)
  }

  function renderDetail(menu, templates) {
    const rule = menu.rule || {}
    const isSection = !menu.parent_id

    // 섹션(대분류)이면 간단히 표시
    if (isSection) {
      document.getElementById('detailPanel').innerHTML = \`
        <div class="p-6 h-full flex items-center justify-center text-slate-400">
          <div class="text-center">
            <i class="fas fa-folder-open text-4xl mb-3 text-amber-300"></i>
            <p class="text-sm font-medium text-slate-600">\${menu.menu_number} \${menu.menu_name}</p>
            <p class="text-xs mt-1">하위 메뉴를 선택하세요</p>
          </div>
        </div>
      \`
      return
    }

    // variant별로 슬롯 고정 여부 판단 (PERSON_N 패턴이 있으면 슬롯별 개별 업로드)
    const PERSON_SLOT_RE = new RegExp('^PERSON_[0-9]+$', 'i')
    const hasVariantSlots = templates.some(t => PERSON_SLOT_RE.test(t.variant_code))

    // 템플릿 목록
    const tplCards = templates.map(t => {
      const hasFile  = !!t.pptx_b64_key
      const fileName = t.pptx_file_path || (hasFile ? '업로드됨' : null)
      const isSlot   = PERSON_SLOT_RE.test(t.variant_code)
      const fileInputId = 'tplFile_' + t.variant_code
      const fileLabelId = 'tplLabel_' + t.variant_code
      return \`
        <div class="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
          <div class="flex items-center gap-2">
            <i class="fas fa-file-powerpoint \${hasFile ? 'text-emerald-500' : 'text-slate-300'} flex-shrink-0"></i>
            <span class="text-xs truncate flex-1 \${hasFile ? 'text-slate-700 font-medium' : 'text-slate-400'}">
              \${hasFile ? (fileName || '파일 업로드됨') : '파일 없음'}
            </span>
            \${t.variant_code !== 'DEFAULT' ? '<span class="text-xs font-mono bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded flex-shrink-0">' + t.variant_code + '</span>' : ''}
            \${isSlot ? \`
              <input id="\${fileInputId}" type="file" accept=".pptx" class="hidden"
                onchange="onSlotFileChange('\${t.variant_code}', this)">
              <span id="\${fileLabelId}" class="text-xs text-slate-400 truncate max-w-[90px] flex-shrink-0"></span>
              <button onclick="document.getElementById('\${fileInputId}').click()"
                class="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 border border-slate-200 transition flex-shrink-0">
                <i class="fas fa-folder-open"></i>
              </button>
              <button onclick="uploadSlotTemplate(\${menu.id}, '\${t.variant_code}')"
                class="text-xs px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium transition flex-shrink-0">
                <i class="fas fa-upload"></i>
              </button>
            \` : ''}
            \${hasFile ? \`
              <button onclick="deleteTplConfirm(\${t.id}, \${menu.id})"
                class="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 border border-red-200 transition flex-shrink-0" title="파일 삭제">
                <i class="fas fa-trash"></i>
              </button>
            \` : ''}
          </div>
        </div>
      \`
    }).join('')

    document.getElementById('detailPanel').innerHTML = \`
      <div class="p-5 h-full overflow-y-auto">

        <!-- 헤더 -->
        <div class="flex items-start justify-between mb-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              \${menu.menu_number ? '<span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">' + menu.menu_number + '</span>' : ''}
              <h2 class="text-base font-bold text-slate-800">\${menu.menu_name}</h2>
            </div>
            <code class="text-xs bg-indigo-50 text-indigo-400 px-2 py-0.5 rounded">\${menu.menu_code}</code>
          </div>

        </div>

        <!-- 켜고/끄기 -->
        <div class="mb-4 flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
          <div>
            <div class="text-sm font-semibold text-slate-700">장표 사용 여부</div>
            <div class="text-xs text-slate-400 mt-0.5">제안서 생성 시 이 장표를 포함할지 설정합니다</div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="toggleEnabled" \${menu.is_enabled ? 'checked' : ''}
              onchange="toggleMenuEnabled(\${menu.id}, this.checked)"
              class="sr-only peer">
            <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer
              peer-checked:after:translate-x-full peer-checked:after:border-white
              after:content-[''] after:absolute after:top-[2px] after:left-[2px]
              after:bg-white after:border-gray-300 after:border after:rounded-full
              after:h-5 after:w-5 after:transition-all
              peer-checked:bg-emerald-500"></div>
          </label>
        </div>

        <!-- 템플릿 파일 -->
        <div class="mb-4">
          <div class="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
            <i class="fas fa-file-powerpoint text-amber-400"></i>템플릿 파일
            <span class="text-xs font-normal text-slate-400">(총 \${templates.length}개)</span>
          </div>

          \${templates.length > 0 ? \`
            <div class="space-y-1.5 mb-3">\${tplCards}</div>
          \` : \`
            <div class="mb-3 text-xs text-slate-400 bg-slate-50 rounded-lg px-4 py-3 border border-slate-200">
              <i class="fas fa-info-circle mr-1"></i>업로드된 템플릿 파일이 없습니다
            </div>
          \`}

          <!-- 업로드 폼: PERSON 슬롯이 없는 일반 메뉴에만 표시 -->
          \${!hasVariantSlots ? \`
          <div class="bg-amber-50 rounded-xl p-3 border border-amber-200">
            <label class="block">
              <div id="tplFileDropZone"
                class="flex items-center gap-3 border-2 border-dashed border-amber-300 rounded-lg px-4 py-3 cursor-pointer hover:border-amber-500 hover:bg-amber-100 transition"
                onclick="document.getElementById('newTplFile').click()">
                <i class="fas fa-file-powerpoint text-amber-400 text-xl flex-shrink-0"></i>
                <span id="tplFileLabel" class="text-xs text-slate-500 truncate">
                  클릭하거나 파일을 여기에 끌어다 놓으세요 (.pptx)
                </span>
              </div>
              <input id="newTplFile" type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                class="hidden" onchange="onTplFileChange(this)">
            </label>
            <input type="hidden" id="newTplName" value="">
            <input type="hidden" id="newTplVariant" value="DEFAULT">
            <input type="hidden" id="newTplCapacity" value="">
            <button onclick="addTemplate(\${menu.id})"
              class="mt-2 w-full py-1.5 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600 font-medium transition">
              <i class="fas fa-upload mr-1"></i>업로드 & 추가
            </button>
          </div>
          \` : ''}
        </div>

      </div>
    \`
  }

  // ── mode 변경 시 관련 필드 활성/비활성 처리 ───────────────────
  function onRuleModeChange(mode) {
    // CLONE_SLIDE: 템플릿만 그대로 사용 → 계산/렌더/분할/후처리 불필요
    // REPLACE: 변수치환만 → 렌더 함수 불필요
    // BUILD_TABLE / BUILD_OBJECTS / HYBRID: 모두 활성
    const isTemplateOnly = (mode === 'CLONE_SLIDE')
    const isReplace      = (mode === 'REPLACE')

    function setWrap(id, disabled) {
      const el = document.getElementById(id)
      if (!el) return
      el.style.opacity   = disabled ? '0.38' : '1'
      el.style.pointerEvents = disabled ? 'none' : ''
      const inp = el.querySelector('input,select,textarea')
      if (inp) inp.disabled = disabled
    }

    setWrap('wrap-ruleCalc',       isTemplateOnly)
    setWrap('wrap-ruleRenderer',   isTemplateOnly || isReplace)
    setWrap('wrap-rulePagination', isTemplateOnly)
    setWrap('wrap-rulePostprocess',isTemplateOnly)
  }

  // ── 규칙 저장 ──────────────────────────────────────────────────
  async function saveRule(menuId) {
    const body = {
      generation_mode:   document.getElementById('ruleMode').value,
      template_strategy: document.getElementById('ruleStrategy').value,
      calculator_code:   document.getElementById('ruleCalc').value,
      renderer_code:     document.getElementById('ruleRenderer').value,
      pagination_mode:   document.getElementById('rulePagination').value,
      postprocess_mode:  document.getElementById('rulePostprocess').value,
      merge_strategy:    document.getElementById('ruleMerge').value,
      rule_config:       document.getElementById('ruleConfig').value,
    }
    const r = await fetch('/api/ppt-menus/' + menuId + '/rule', { method: 'PUT', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    const j = await r.json()
    showAlert(j.ok ? '✅ 규칙 저장 완료' : '❌ ' + j.error, j.ok)
    if (j.ok) { await loadTree(); selectMenu(menuId) }
  }

  // ── 템플릿 파일 선택 핸들러 ───────────────────────────────────
  function onTplFileChange(input) {
    const label = document.getElementById('tplFileLabel')
    if (input.files && input.files[0]) {
      label.textContent = input.files[0].name
      label.classList.add('text-amber-700', 'font-semibold')
      // 이름 자동 채우기
      const nameEl = document.getElementById('newTplName')
      if (nameEl) nameEl.value = input.files[0].name.replace(/\.pptx$/i, '')
    } else {
      label.textContent = '클릭하거나 파일을 여기에 끌어다 놓으세요 (.pptx)'
      label.classList.remove('text-amber-700', 'font-semibold')
    }
  }

  // ── 켜고/끄기 토글 ────────────────────────────────────────────
  async function toggleMenuEnabled(menuId, enabled) {
    const r = await fetch('/api/ppt-menus/' + menuId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: enabled ? 1 : 0 })
    })
    const j = await r.json()
    if (!j.ok) {
      showAlert('❌ ' + j.error, false)
      // 실패 시 토글 원복
      document.getElementById('toggleEnabled').checked = !enabled
    } else {
      await loadTree()
      _selectedMenuId = menuId
      renderTree(_treeData)
    }
  }

  // ── 템플릿 추가 (파일 업로드) ────────────────────────────────
  // ── 슬롯별 파일 선택 표시 ────────────────────────────────────
  function onSlotFileChange(variantCode, input) {
    const labelEl = document.getElementById('tplLabel_' + variantCode)
    if (!labelEl) return
    labelEl.textContent = input.files && input.files[0] ? input.files[0].name : '파일 선택...'
  }

  // ── 슬롯별 템플릿 업로드 (기존 레코드 덮어쓰기) ───────────────
  async function uploadSlotTemplate(menuId, variantCode) {
    const fileEl = document.getElementById('tplFile_' + variantCode)
    const file   = fileEl && fileEl.files && fileEl.files[0]
    if (!file) { showAlert('파일을 먼저 선택하세요', false); return }

    const formData = new FormData()
    formData.append('template_name', variantCode)
    formData.append('variant_code',  variantCode)
    formData.append('pptx_file',     file)

    const r = await fetch('/api/ppt-menus/' + menuId + '/templates', { method: 'POST', body: formData })
    const j = await r.json()
    if (j.ok) {
      showAlert('✅ ' + variantCode + ' 업로드 완료', true)
      if (fileEl) fileEl.value = ''
      const labelEl = document.getElementById('tplLabel_' + variantCode)
      if (labelEl) labelEl.textContent = '파일 선택...'
      selectMenu(menuId)
    } else {
      showAlert('❌ ' + j.error, false)
    }
  }

  async function addTemplate(menuId) {
    const name     = document.getElementById('newTplName').value.trim()
    const variant  = document.getElementById('newTplVariant').value.trim() || 'DEFAULT'
    const capacity = document.getElementById('newTplCapacity').value
    const fileEl   = document.getElementById('newTplFile')
    const file     = fileEl && fileEl.files && fileEl.files[0]

    if (!name) { showAlert('템플릿 이름을 입력하세요', false); return }

    const formData = new FormData()
    formData.append('template_name', name)
    formData.append('variant_code',  variant)
    if (capacity) formData.append('capacity', capacity)
    if (file)     formData.append('pptx_file', file)

    const r = await fetch('/api/ppt-menus/' + menuId + '/templates', { method: 'POST', body: formData })
    const j = await r.json()
    if (j.ok) {
      showAlert('✅ 템플릿 추가 완료' + (j.file_name ? ' — ' + j.file_name : ''), true)
      // 폼 초기화
      document.getElementById('newTplName').value = ''
      document.getElementById('newTplVariant').value = 'DEFAULT'
      document.getElementById('newTplCapacity').value = ''
      if (fileEl) fileEl.value = ''
      const label = document.getElementById('tplFileLabel')
      if (label) { label.textContent = '클릭하거나 파일을 여기에 끌어다 놓으세요 (.pptx)'; label.classList.remove('text-amber-700','font-semibold') }
      selectMenu(menuId)
    } else {
      showAlert('❌ ' + j.error, false)
    }
  }

  // ── 템플릿 파일 삭제 (pptx_b64_key만 지움, 슬롯 레코드 유지) ──
  async function deleteTplConfirm(tid, menuId) {
    if (!confirm('업로드된 파일을 삭제하시겠습니까?\\n(슬롯은 유지됩니다)')) return
    const r = await fetch('/api/ppt-menus/templates/' + tid + '/file', { method: 'DELETE' })
    const j = await r.json()
    showAlert(j.ok ? '✅ 파일 삭제 완료' : '❌ ' + j.error, j.ok)
    if (j.ok) selectMenu(menuId)
  }

  // ── 템플릿 삭제 ────────────────────────────────────────────────
  async function deleteTpl(tid) {
    if (!confirm('템플릿을 삭제하시겠습니까?')) return
    const r = await fetch('/api/ppt-menus/templates/' + tid, { method: 'DELETE' })
    const j = await r.json()
    showAlert(j.ok ? '✅ 삭제 완료' : '❌ ' + j.error, j.ok)
    if (j.ok && _selectedMenuId) selectMenu(_selectedMenuId)
  }

  // ── 메뉴 추가/편집 모달 ────────────────────────────────────────
  function openAddMenu() {
    document.getElementById('menuModalTitle').textContent = '메뉴 추가'
    document.getElementById('modalMenuId').value = ''
    document.getElementById('modalParentId').value = ''
    document.getElementById('modalMenuCode').value = ''
    document.getElementById('modalMenuName').value = ''
    document.getElementById('modalMenuNumber').value = ''
    document.getElementById('modalSortOrder').value = '100'
    document.getElementById('modalIsEnabled').checked = true
    document.getElementById('menuModal').classList.remove('hidden')
  }

  function openEditMenu(id) {
    const menu = findMenuById(_treeData, id)
    if (!menu) return
    document.getElementById('menuModalTitle').textContent = '메뉴 편집'
    document.getElementById('modalMenuId').value = id
    document.getElementById('modalParentId').value = menu.parent_id || ''
    document.getElementById('modalMenuCode').value = menu.menu_code
    document.getElementById('modalMenuName').value = menu.menu_name
    document.getElementById('modalMenuNumber').value = menu.menu_number || ''
    document.getElementById('modalSortOrder').value = menu.sort_order
    document.getElementById('modalIsEnabled').checked = !!menu.is_enabled
    document.getElementById('menuModal').classList.remove('hidden')
  }

  function closeMenuModal() { document.getElementById('menuModal').classList.add('hidden') }

  async function saveMenu() {
    const id   = document.getElementById('modalMenuId').value
    const body = {
      parent_id:   parseInt(document.getElementById('modalParentId').value) || null,
      menu_code:   document.getElementById('modalMenuCode').value,
      menu_name:   document.getElementById('modalMenuName').value,
      menu_number: document.getElementById('modalMenuNumber').value || null,
      sort_order:  parseInt(document.getElementById('modalSortOrder').value) || 0,
      is_enabled:  document.getElementById('modalIsEnabled').checked ? 1 : 0,
    }
    if (!body.menu_code || !body.menu_name) { showAlert('메뉴 코드와 이름은 필수입니다', false); return }
    const url    = id ? '/api/ppt-menus/' + id : '/api/ppt-menus'
    const method = id ? 'PUT' : 'POST'
    const r = await fetch(url, { method, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) })
    const j = await r.json()
    showAlert(j.ok ? '✅ 저장 완료' : '❌ ' + j.error, j.ok)
    if (j.ok) { closeMenuModal(); loadTree() }
  }

  // ── 메뉴 삭제 ─────────────────────────────────────────────────
  async function deleteMenu(id) {
    if (!confirm('메뉴를 삭제하면 하위 템플릿/규칙도 모두 삭제됩니다. 계속하시겠습니까?')) return
    const r = await fetch('/api/ppt-menus/' + id, { method: 'DELETE' })
    const j = await r.json()
    showAlert(j.ok ? '✅ 삭제 완료' : '❌ ' + j.error, j.ok)
    if (j.ok) {
      _selectedMenuId = null
      document.getElementById('detailPanel').innerHTML =
        '<div class="flex items-center justify-center h-full text-slate-400"><div class="text-center"><i class="fas fa-mouse-pointer text-4xl mb-3 opacity-30"></i><p class="text-sm">왼쪽 트리에서 메뉴를 선택하세요</p></div></div>'
      loadTree()
    }
  }

  // ── 마스터 템플릿 관리 ───────────────────────────────────────
  async function openMasterModal() {
    document.getElementById('masterModal').classList.remove('hidden')
    await loadMasterList()
  }
  function closeMasterModal() {
    document.getElementById('masterModal').classList.add('hidden')
  }

  async function loadMasterList() {
    const el = document.getElementById('masterList')
    el.innerHTML = '<div class="text-center text-slate-400 text-xs py-6"><i class="fas fa-spinner fa-spin mr-1"></i>로딩 중...</div>'
    try {
      const r = await fetch('/api/ppt-menus/master-templates')
      const j = await r.json()
      if (!j.ok) throw new Error(j.error)
      if (!j.data.length) {
        el.innerHTML = '<div class="text-center text-slate-400 text-xs py-8"><i class="fas fa-inbox text-2xl mb-2 block opacity-30"></i>저장된 마스터가 없습니다<br><span class="text-slate-300">왼쪽에서 PPTX를 업로드하세요</span></div>'
        return
      }
      el.innerHTML = j.data.map(m => {
        const layouts = Array.isArray(m.layouts) ? m.layouts : (typeof m.layouts === 'string' ? JSON.parse(m.layouts || '[]') : [])
        const isActive = m.is_active == 1
        const createdAt = new Date(m.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        return \`
        <div data-master-id="\${m.id}" class="rounded-xl border-2 \${isActive ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white'} p-3 transition-all">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-0.5">
                \${isActive ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-600 text-white text-xs font-bold"><i class="fas fa-check mr-1"></i>활성</span>' : ''}
                <span class="text-sm font-semibold text-slate-800 truncate">\${m.name}</span>
              </div>
              \${m.description ? \`<div class="text-xs text-slate-400 mb-1">\${m.description}</div>\` : ''}
              <div class="text-xs text-slate-300">\${createdAt}</div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              \${!isActive ? \`<button onclick="activateMaster(\${m.id})" class="px-2.5 py-1 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition"><i class="fas fa-play mr-1"></i>활성화</button>\` : ''}
              <button onclick="deleteMaster(\${m.id})" class="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
          \${layouts.length ? \`
          <div class="mt-2 pt-2 border-t border-slate-100">
            <div class="text-xs text-slate-400 mb-1"><i class="fas fa-th-list mr-1"></i>레이아웃 \${layouts.length}개</div>
            <div class="flex flex-wrap gap-1">
              \${layouts.map(l => \`<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs">\${l}</span>\`).join('')}
            </div>
          </div>\` : ''}
        </div>\`
      }).join('')
    } catch (e) {
      el.innerHTML = \`<div class="text-red-400 text-xs text-center py-4"><i class="fas fa-exclamation-circle mr-1"></i>로드 실패: \${e.message}</div>\`
    }
  }

  async function uploadMasterTemplate() {
    const name = document.getElementById('masterNameInput').value.trim()
    const desc = document.getElementById('masterDescInput').value.trim()
    const fileInput = document.getElementById('masterFileInput')
    const setActive = document.getElementById('masterSetActive').checked
    if (!name) { alert('이름을 입력하세요'); return }
    if (!fileInput.files?.length) { alert('PPTX 파일을 선택하세요'); return }

    const fd = new FormData()
    fd.append('file', fileInput.files[0])
    fd.append('name', name)
    fd.append('description', desc)
    fd.append('set_active', setActive ? '1' : '0')

    const btn = document.getElementById('masterUploadBtn')
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>업로드 중...'
    document.getElementById('masterUploadInfo').classList.add('hidden')
    try {
      const r = await fetch('/api/ppt-menus/master-templates', { method: 'POST', body: fd })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error)

      // 업로드 성공 — 레이아웃 표시
      const layouts = Array.isArray(j.layouts) ? j.layouts : []
      if (layouts.length) {
        document.getElementById('masterUploadLayouts').textContent = layouts.join(' · ')
        document.getElementById('masterUploadInfo').classList.remove('hidden')
      }

      showAlert('✅ "' + name + '" 업로드 완료' + (layouts.length ? ' (' + layouts.length + '개 레이아웃 추출)' : ''), true)
      document.getElementById('masterNameInput').value = ''
      document.getElementById('masterDescInput').value = ''
      fileInput.value = ''
      await loadMasterList()
    } catch (e) {
      showAlert('❌ 업로드 실패: ' + e.message, false)
    } finally {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-1"></i>업로드'
    }
  }

  async function activateMaster(id) {
    const r = await fetch('/api/ppt-menus/master-templates/' + id + '/activate', { method: 'PUT' })
    const j = await r.json()
    if (j.ok) {
      showAlert('✅ 마스터 템플릿이 활성화되었습니다', true)
      await loadMasterList()
    } else showAlert('❌ 활성화 실패: ' + j.error, false)
  }

  async function deleteMaster(id) {
    const row = document.querySelector('[data-master-id="' + id + '"]')
    const name = row?.querySelector('.font-semibold')?.textContent?.trim() || '이 마스터'
    if (!confirm('"' + name + '"을 삭제하시겠습니까?')) return
    const r = await fetch('/api/ppt-menus/master-templates/' + id, { method: 'DELETE' })
    const j = await r.json()
    if (j.ok) { showAlert('✅ 삭제 완료', true); await loadMasterList() }
    else showAlert('❌ 삭제 실패: ' + j.error, false)
  }

  // ── 프리셋 저장/불러오기 (DB 기반) ──────────────────────────

  function savePresets(_list) {}  // 하위호환 stub (사용 안 함)

  async function openPresetModal() {
    document.getElementById('presetNameInput').value = ''
    document.getElementById('presetModal').classList.remove('hidden')
    await renderPresetList()
  }

  function closePresetModal() {
    document.getElementById('presetModal').classList.add('hidden')
  }

  // ── 전체 목차 스냅샷 저장 (DB) ──────────────────────────────
  async function savePreset() {
    const name = document.getElementById('presetNameInput').value.trim()
    if (!name) { alert('프리셋 이름을 입력하세요'); return }

    const btn = document.getElementById('presetSaveBtn')
    btn.disabled = true
    btn.textContent = '저장 중...'
    try {
      // 1) 전체 메뉴 트리 (rules 포함) 조회
      const r = await fetch('/api/ppt-menus')
      const j = await r.json()
      if (!j.ok) throw new Error(j.error)

      // 2) 트리 평탄화
      const snapshot = []
      function flattenTree(nodes) {
        nodes.forEach(n => {
          snapshot.push({
            menu_id:     n.id,
            parent_id:   n.parent_id ?? null,
            menu_code:   n.menu_code,
            menu_name:   n.menu_name,
            menu_number: n.menu_number ?? null,
            sort_order:  n.sort_order ?? 0,
            is_enabled:  n.is_enabled ?? 1,
            rule: n.rule ? {
              generation_mode:   n.rule.generation_mode,
              template_strategy: n.rule.template_strategy,
              pagination_mode:   n.rule.pagination_mode,
              merge_strategy:    n.rule.merge_strategy,
              calculator_code:   n.rule.calculator_code,
              renderer_code:     n.rule.renderer_code,
              postprocess_mode:  n.rule.postprocess_mode,
              rule_config:       n.rule.rule_config,
            } : null,
            templates: []
          })
          if (n.children && n.children.length) flattenTree(n.children)
        })
      }
      flattenTree(j.data)

      // 3) 각 메뉴의 템플릿 목록 병렬 조회 (pptx_b64_key 포함)
      await Promise.all(snapshot.map(async (item) => {
        try {
          const tr = await fetch('/api/ppt-menus/' + item.menu_id + '/templates')
          const tj = await tr.json()
          if (tj.ok && Array.isArray(tj.data)) {
            item.templates = tj.data.map(t => ({
              template_name: t.template_name,
              variant_code:  t.variant_code,
              capacity:      t.capacity ?? null,
              is_default:    t.is_default ?? 0,
              is_active:     t.is_active ?? 1,
              pptx_b64_key:  t.pptx_b64_key ?? null,
              pptx_file_path: t.pptx_file_path ?? null,
            }))
          }
        } catch(_) {}
      }))

      // 4) DB에 저장
      const sr = await fetch('/api/ppt-menus/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, snapshot })
      })
      const sj = await sr.json()
      if (!sj.ok) throw new Error(sj.error)

      document.getElementById('presetNameInput').value = ''
      await renderPresetList()
      const tplCount = snapshot.reduce((s, m) => s + (m.templates ? m.templates.length : 0), 0)
      showAlert('✅ 프리셋 "' + name + '" 저장 완료 (메뉴 ' + snapshot.length + '개, 템플릿 ' + tplCount + '개)', true)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    } finally {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-save mr-1"></i>저장'
    }
  }

  // ── 전체 목차 스냅샷 적용 (완전 덮어쓰기, DB) ───────────────
  async function applyPreset(presetId) {
    // 프리셋 snapshot 전체 조회
    const pr = await fetch('/api/ppt-menus/presets/' + presetId)
    const pj = await pr.json()
    if (!pj.ok) { alert('프리셋을 찾을 수 없습니다'); return }
    const preset = pj.data

    if (!confirm('"' + preset.name + '" 프리셋을 적용하시겠습니까?\\n\\n· 스냅샷의 ' + preset.menu_count + '개 메뉴로 완전히 덮어씁니다\\n· 이후 추가된 메뉴는 삭제됩니다\\n· 이 작업은 되돌릴 수 없습니다')) return

    closePresetModal()
    showAlert('⏳ 프리셋 복원 중...', true)

    try {
      const snapshot = Array.isArray(preset.snapshot) ? preset.snapshot : JSON.parse(preset.snapshot)

      // 1) 현재 전체 메뉴 id 목록 조회
      const curR = await fetch('/api/ppt-menus')
      const curJ = await curR.json()
      const curIds = new Set()
      function collectIds(nodes) {
        nodes.forEach(n => { curIds.add(n.id); if (n.children) collectIds(n.children) })
      }
      collectIds(curJ.data || [])

      const snapIds = new Set(snapshot.map(item => item.menu_id))

      // 2) 스냅샷에 없는 메뉴 삭제
      const toDelete = [...curIds].filter(id => !snapIds.has(id))
      for (const id of toDelete) {
        await fetch('/api/ppt-menus/' + id, { method: 'DELETE' })
      }

      // 3) 스냅샷 메뉴+룰 upsert (부모 먼저)
      const sorted = [...snapshot].sort((a, b) => {
        if (!a.parent_id && b.parent_id) return -1
        if (a.parent_id && !b.parent_id) return 1
        return 0
      })
      let ok = 0, fail = 0
      for (const item of sorted) {
        try {
          const r = await fetch('/api/ppt-menus/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id:          item.menu_id,
              parent_id:   item.parent_id ?? null,
              menu_code:   item.menu_code,
              menu_name:   item.menu_name,
              menu_number: item.menu_number ?? null,
              sort_order:  item.sort_order ?? 0,
              is_enabled:  item.is_enabled ?? 1,
              rule:        item.rule ?? null,
            })
          })
          const rj = await r.json()
          if (rj.ok) ok++; else fail++
        } catch(_) { fail++ }
      }

      // 4) 템플릿 복원 — 메뉴별 기존 템플릿 전부 삭제 후 재삽입
      let tplOk = 0, tplFail = 0
      for (const item of snapshot) {
        if (!item.templates || !item.templates.length) continue
        try {
          // 기존 템플릿 삭제 (메뉴 단위)
          const existing = await fetch('/api/ppt-menus/' + item.menu_id + '/templates')
          const ej = await existing.json()
          if (ej.ok && Array.isArray(ej.data)) {
            for (const t of ej.data) {
              await fetch('/api/ppt-menus/templates/' + t.id, { method: 'DELETE' })
            }
          }
          // 스냅샷 템플릿 재삽입
          for (const t of item.templates) {
            const tr = await fetch('/api/ppt-menus/' + item.menu_id + '/templates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(t)
            })
            const tj = await tr.json()
            if (tj.ok) tplOk++; else tplFail++
          }
        } catch(_) { tplFail++ }
      }

      await loadTree()
      if (_selectedMenuId && snapIds.has(_selectedMenuId)) {
        selectMenu(_selectedMenuId)
      } else {
        _selectedMenuId = null
      }

      const delNote = toDelete.length ? ', 불필요 메뉴 ' + toDelete.length + '개 삭제' : ''
      const tplNote = (tplOk + tplFail) > 0 ? ', 템플릿 ' + tplOk + '개 복원' : ''
      const failNote = (fail + tplFail) ? ' (실패 ' + (fail + tplFail) + '개)' : ''
      showAlert('✅ 프리셋 "' + preset.name + '" 복원 완료 — 메뉴 ' + ok + '개' + tplNote + delNote + failNote, (fail + tplFail) === 0)
    } catch(e) {
      showAlert('❌ 복원 중 오류: ' + e.message, false)
    }
  }

  async function deletePreset(presetId) {
    const name = document.querySelector('[data-preset-id="' + presetId + '"] .preset-name')?.textContent || '이 프리셋'
    if (!confirm('"' + name + '" 프리셋을 삭제하시겠습니까?')) return
    const r = await fetch('/api/ppt-menus/presets/' + presetId, { method: 'DELETE' })
    const j = await r.json()
    if (j.ok) await renderPresetList()
    else alert('삭제 실패: ' + j.error)
  }

  async function renderPresetList() {
    const container = document.getElementById('presetList')
    container.innerHTML = '<div class="text-center text-slate-400 text-xs py-4"><i class="fas fa-spinner fa-spin mr-1"></i>불러오는 중...</div>'
    try {
      const r = await fetch('/api/ppt-menus/presets')
      const j = await r.json()
      const list = j.data || []
      if (!list.length) {
        container.innerHTML = '<div class="text-center text-slate-400 text-xs py-4">저장된 프리셋이 없습니다</div>'
        return
      }
      container.innerHTML = list.map(p => {
        const dt = new Date(p.created_at)
        const dtStr = dt.getFullYear() + '.' + String(dt.getMonth()+1).padStart(2,'0') + '.' + String(dt.getDate()).padStart(2,'0') + ' ' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0')
        return '<div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200" data-preset-id="' + p.id + '">' +
          '<div class="flex-1 min-w-0">' +
            '<div class="text-xs font-semibold text-slate-800 truncate preset-name">' + p.name + '</div>' +
            '<div class="text-xs text-slate-400 mt-0.5">메뉴 ' + p.menu_count + '개 · ' + dtStr + '</div>' +
          '</div>' +
          '<button onclick="applyPreset(' + p.id + ')" class="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"><i class="fas fa-check mr-1"></i>적용</button>' +
          '<button onclick="deletePreset(' + p.id + ')" class="px-2 py-1 text-xs rounded bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 whitespace-nowrap"><i class="fas fa-trash"></i></button>' +
        '</div>'
      }).join('')
    } catch(e) {
      container.innerHTML = '<div class="text-center text-red-400 text-xs py-4">불러오기 실패: ' + e.message + '</div>'
    }
  }

  // ── 툴팁 팝오버 ──────────────────────────────────────────────────
  const TIP_DATA = {
    mode: {
      title: '슬라이드 생성 방식 (Generation Mode)',
      desc: '데이터를 슬라이드로 변환하는 핵심 알고리즘을 선택합니다. 장표 유형에 따라 적합한 방식이 다릅니다.',
      example: ['BUILD_TABLE: 인원 배정표, 감리 일정', 'BUILD_OBJECTS: 사진/프로필 장표', 'CLONE_SLIDE: 반복 구조 장표', 'REPLACE: 표지/고정 양식', 'HYBRID: 표+사진 복합'].join(' | '),
    },
    strategy: {
      title: '템플릿 종류 (Template Strategy)',
      desc: '슬라이드 생성 시 사용하는 템플릿 파일/구조의 종류입니다.',
      example: ['PPTX_TEMPLATE: .pptx 파일을 직접 사용', 'PPTX_XML_TEMPLATE: XML 조각 조합', 'FRAME_TEMPLATE: 프레임 레이아웃 기반', 'VARIANT_TEMPLATE: 인원수별 변형 템플릿'].join(' | '),
    },
    pagination: {
      title: '페이지 분할 방식 (Pagination Mode)',
      desc: '데이터가 많아 슬라이드를 여러 장으로 나눠야 할 때 분할 기준을 지정합니다.',
      example: 'NONE: 분할없음 | ROW_LIMIT: 행수기준(maxRowsPerSlide) | SECTION: 섹션단위 | CUSTOM: 커스텀함수',
    },
    merge: {
      title: '합본(병합) 방식 (Merge Strategy)',
      desc: '여러 장표를 하나의 PPTX 파일로 합칠 때 사용하는 방식입니다.',
      example: 'STANDARD: 현재 파일에 슬라이드 추가 | FOREIGN_TEMPLATE: 외부 템플릿 파일에 슬라이드를 복사하여 병합',
    },
    calc: {
      title: '데이터 계산 함수명 (Calculator Code)',
      desc: '슬라이드에 들어갈 데이터를 준비/가공하는 JS 함수명입니다. ppt-engine.js 또는 proposal-detail.js에 정의된 함수명을 입력합니다.',
      example: 'computeAssignRows | computeScheduleRows | computeComplianceRows (없으면 빈칸)',
    },
    renderer: {
      title: '슬라이드 렌더 함수명 (Renderer Code)',
      desc: '계산된 데이터를 PPTX 슬라이드 XML로 변환하는 JS 함수명입니다.',
      example: 'renderAssignTable | renderPhotoSlide | renderScheduleTable (없으면 빈칸)',
    },
    postprocess: {
      title: '후처리 방식 (Postprocess Mode)',
      desc: '슬라이드 생성 완료 후 추가로 수행하는 처리 단계를 지정합니다.',
      example: 'NONE: 없음 | WATERMARK: 워터마크 | COMPRESS: 이미지압축 | SIGN: 전자서명 | CUSTOM: 커스텀',
    },
    config: {
      title: '추가 설정값 (Rule Config)',
      desc: '위 설정으로 표현할 수 없는 세부 동작을 JSON 형식으로 지정합니다.',
      example: '{"maxRowsPerSlide":15} | {"variants":[2,4,6,9]} | {"photoSize":"large","nameFontSize":14}',
    },
  }

  let _activeTipKey = null
  const tipEl = document.getElementById('tipPopover')

  document.addEventListener('click', function(e) {
    const icon = e.target.closest('.tip-icon')
    if (icon) {
      e.stopPropagation()
      const key = icon.dataset.tip
      if (_activeTipKey === key) {
        tipEl.classList.add('hidden')
        _activeTipKey = null
        return
      }
      const data = TIP_DATA[key]
      if (!data) return
      document.getElementById('tipTitle').textContent = data.title
      document.getElementById('tipDesc').textContent = data.desc
      document.getElementById('tipExample').textContent = data.example
      const rect = icon.getBoundingClientRect()
      const scrollY = window.scrollY || document.documentElement.scrollTop
      const scrollX = window.scrollX || document.documentElement.scrollLeft
      tipEl.classList.remove('hidden')
      tipEl.style.pointerEvents = 'none'
      const tipW = 288
      const tipH = tipEl.offsetHeight || 200
      let left = rect.right + scrollX + 8
      let top  = rect.top  + scrollY
      if (left + tipW > window.innerWidth + scrollX - 10) left = rect.left + scrollX - tipW - 8
      if (top + tipH > window.innerHeight + scrollY - 10) top = window.innerHeight + scrollY - tipH - 10
      if (top < scrollY) top = scrollY + 8
      tipEl.style.left = left + 'px'
      tipEl.style.top  = top  + 'px'
      _activeTipKey = key
      return
    }
    if (!e.target.closest('#tipPopover')) {
      tipEl.classList.add('hidden')
      _activeTipKey = null
    }
  })

  // ── 드래그앤드롭 파일 업로드 ──────────────────────────────────
  document.addEventListener('dragover', function(e) {
    const zone = e.target.closest('#tplFileDropZone')
    if (zone) { e.preventDefault(); zone.classList.add('border-amber-500','bg-amber-100') }
  })
  document.addEventListener('dragleave', function(e) {
    const zone = e.target.closest('#tplFileDropZone')
    if (zone) { zone.classList.remove('border-amber-500','bg-amber-100') }
  })
  document.addEventListener('drop', function(e) {
    const zone = e.target.closest('#tplFileDropZone')
    if (!zone) return
    e.preventDefault()
    zone.classList.remove('border-amber-500','bg-amber-100')
    const files = e.dataTransfer && e.dataTransfer.files
    if (!files || !files.length) return
    const fileEl = document.getElementById('newTplFile')
    if (!fileEl) return
    // DataTransfer로 파일 세팅
    try {
      const dt = new DataTransfer()
      dt.items.add(files[0])
      fileEl.files = dt.files
      onTplFileChange(fileEl)
    } catch (_) {}
  })

  // ── 초기 로드 ─────────────────────────────────────────────────
  loadTree()
  </script>`

  return c.html(layout('PPT 템플릿 관리', body, 'ppt-templates'))
})

export default app
