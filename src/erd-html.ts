const erdHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DB ERD — 인력정보 & 제안작업표</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background:#0f172a; font-family:'Noto Sans KR',sans-serif; }

    /* ── 탭 ── */
    .tab-btn { transition:all .2s; border-bottom:3px solid transparent; }
    .tab-btn.active { border-bottom-color:#3b82f6; color:#fff; }
    .tab-btn:not(.active) { color:#64748b; }
    .tab-btn:not(.active):hover { color:#94a3b8; }
    .panel { display:none; }
    .panel.active { display:block; }

    /* ── ERD 카드 ── */
    .erd-table {
      background:#1e293b;
      border:1px solid #334155;
      border-radius:10px;
      overflow:hidden;
      width:220px;
      flex-shrink:0;
    }
    .erd-table .hd {
      padding:8px 12px;
      font-weight:700;
      font-size:13px;
      display:flex;
      align-items:center;
      gap:6px;
    }
    .erd-table .hd .badge {
      font-size:10px;
      font-weight:400;
      opacity:.75;
      margin-left:auto;
    }
    .erd-col {
      display:flex;
      align-items:center;
      padding:4px 12px;
      font-size:11px;
      gap:6px;
      border-top:1px solid #1e293b;
    }
    .erd-col:nth-child(odd)  { background:#0f172a33; }
    .erd-col .col-name { flex:1; color:#e2e8f0; }
    .erd-col .col-type { color:#34d399; font-size:10px; width:70px; text-align:right; }
    .pk  .col-name { color:#fbbf24; font-weight:700; }
    .fk  .col-name { color:#fb923c; }
    .fkn .col-name { color:#fdba74; }
    .gen .col-name { color:#c084fc; }

    /* ── 관계 화살표 범례 ── */
    .rel-line { display:inline-block; width:40px; height:2px; vertical-align:middle; }

    /* ── 관계도 SVG 컨테이너 ── */
    #svg-container { overflow-x:auto; }
    .rel-svg { min-width:900px; }

    /* ── 컬럼 상세 테이블 ── */
    .detail-table th { background:#1e293b; color:#94a3b8; font-weight:600; font-size:11px; padding:6px 10px; text-align:left; }
    .detail-table td { font-size:11px; padding:5px 10px; color:#cbd5e1; border-top:1px solid #1e293b33; }
    .detail-table tr:nth-child(even) td { background:#0f172a22; }
  </style>
</head>
<body class="min-h-screen p-6 text-slate-200">
<div class="max-w-screen-xl mx-auto">

  <!-- 헤더 -->
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-white">📊 DB ERD</h1>
    <p class="text-slate-400 text-sm mt-1">인력정보 DB (4 tables) &nbsp;·&nbsp; 제안작업표 DB (6 tables) &nbsp;·&nbsp; 키워드 DB (2 tables) &nbsp;·&nbsp; Cloudflare D1 (SQLite)</p>
  </div>

  <!-- 탭 -->
  <div class="flex gap-6 border-b border-slate-700 mb-6">
    <button class="tab-btn active pb-2 text-sm font-semibold" onclick="switchTab('overview',this)">🗺️ 전체 관계도</button>
    <button class="tab-btn pb-2 text-sm font-semibold" onclick="switchTab('personnel',this)">👤 인력정보 DB</button>
    <button class="tab-btn pb-2 text-sm font-semibold" onclick="switchTab('proposal',this)">📋 제안작업표 DB</button>
    <button class="tab-btn pb-2 text-sm font-semibold" onclick="switchTab('columns',this)">📑 컬럼 상세</button>
  </div>

  <!-- ══════════════════════════════════════════════════
       탭 1 : 전체 관계도 (SVG 직접 그리기)
  ══════════════════════════════════════════════════ -->
  <div id="tab-overview" class="panel active">
    <div id="svg-container" class="bg-slate-900 rounded-xl p-4">
      <svg viewBox="0 0 1080 830" class="rel-svg w-full" xmlns="http://www.w3.org/2000/svg" font-family="Noto Sans KR,sans-serif">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#64748b"/>
          </marker>
          <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#3b82f6"/>
          </marker>
          <marker id="arrow-em" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#10b981"/>
          </marker>
        </defs>

        <!-- ── 그룹 배경 ── -->
        <rect x="20"  y="10"  width="460" height="650" rx="14" fill="#1e3a5f22" stroke="#3b82f630" stroke-width="1.5"/>
        <text x="40"  y="34"  fill="#3b82f6" font-size="13" font-weight="700">👤 인력정보 DB</text>

        <rect x="550" y="10"  width="510" height="780" rx="14" fill="#064e3b22" stroke="#10b98130" stroke-width="1.5"/>
        <text x="570" y="34"  fill="#10b981" font-size="13" font-weight="700">📋 제안작업표 DB</text>

        <!-- ────────────────────────────────
             인력정보 테이블들
        ──────────────────────────────── -->

        <!-- personnel (중앙 허브) -->
        <g id="g-personnel">
          <rect x="40" y="50" width="200" height="230" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="2"/>
          <rect x="40" y="50" width="200" height="30"  rx="8" fill="#1d4ed8"/>
          <rect x="40" y="70" width="200" height="10"  fill="#1d4ed8"/>
          <text x="52" y="70" fill="#fff" font-size="12" font-weight="700">personnel</text>
          <text x="195" y="70" fill="#93c5fd" font-size="10" text-anchor="end">기본정보</text>

          <text x="52" y="100" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="190" y="100" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="52" y="118" fill="#e2e8f0" font-size="11">name</text>
          <text x="190" y="118" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="136" fill="#e2e8f0" font-size="11">position</text>
          <text x="190" y="136" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="154" fill="#e2e8f0" font-size="11">auditor_cert_no</text>
          <text x="190" y="154" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="172" fill="#e2e8f0" font-size="11">auditor_grade</text>
          <text x="190" y="172" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="190" fill="#e2e8f0" font-size="11">tech_grade</text>
          <text x="190" y="190" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="208" fill="#e2e8f0" font-size="11">email</text>
          <text x="190" y="208" fill="#34d399" font-size="10" text-anchor="end">TEXT UK</text>
          <text x="52" y="226" fill="#e2e8f0" font-size="11">phone / birthdate</text>
          <text x="190" y="226" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52" y="244" fill="#94a3b8" font-size="10">+ 17 more columns …</text>
          <text x="190" y="264" fill="#475569" font-size="10" text-anchor="end">created/updated_at</text>
        </g>

        <!-- personnel_certifications -->
        <g id="g-certs">
          <rect x="270" y="50" width="195" height="160" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
          <rect x="270" y="50" width="195" height="30"  rx="8" fill="#1e40af"/>
          <rect x="270" y="70" width="195" height="10"  fill="#1e40af"/>
          <text x="282" y="70" fill="#fff" font-size="11" font-weight="700">personnel_certifications</text>
          <text x="458" y="70" fill="#93c5fd" font-size="10" text-anchor="end">자격증</text>
          <text x="282" y="100" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="458" y="100" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="282" y="118" fill="#fb923c" font-size="11">🔗 personnel_id</text>
          <text x="458" y="118" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="282" y="136" fill="#e2e8f0" font-size="11">cert_name</text>
          <text x="458" y="136" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="282" y="154" fill="#e2e8f0" font-size="11">cert_year / issuer</text>
          <text x="458" y="154" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="282" y="172" fill="#e2e8f0" font-size="11">is_national</text>
          <text x="458" y="172" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="282" y="190" fill="#e2e8f0" font-size="11">related_field</text>
          <text x="458" y="190" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
        </g>

        <!-- personnel_audit_history -->
        <g id="g-audit-hist">
          <rect x="40" y="300" width="200" height="195" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
          <rect x="40" y="300" width="200" height="30"  rx="8" fill="#1e40af"/>
          <rect x="40" y="320" width="200" height="10"  fill="#1e40af"/>
          <text x="52"  y="320" fill="#fff" font-size="11" font-weight="700">personnel_audit_history</text>
          <text x="232" y="320" fill="#93c5fd" font-size="10" text-anchor="end">감리실적</text>
          <text x="52"  y="350" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="232" y="350" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="52"  y="368" fill="#fb923c" font-size="11">🔗 personnel_id</text>
          <text x="232" y="368" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="52"  y="386" fill="#e2e8f0" font-size="11">audit_yearmonth</text>
          <text x="232" y="386" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52"  y="404" fill="#e2e8f0" font-size="11">project_name</text>
          <text x="232" y="404" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52"  y="422" fill="#e2e8f0" font-size="11">client_org / sector</text>
          <text x="232" y="422" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52"  y="440" fill="#e2e8f0" font-size="11">domain / role</text>
          <text x="232" y="440" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52"  y="458" fill="#e2e8f0" font-size="11">phase</text>
          <text x="232" y="458" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="52"  y="476" fill="#94a3b8" font-size="10">104건 실적 저장됨</text>
        </g>

        <!-- personnel_it_career -->
        <g id="g-it-career">
          <rect x="270" y="230" width="195" height="185" rx="8" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
          <rect x="270" y="230" width="195" height="30"  rx="8" fill="#1e40af"/>
          <rect x="270" y="250" width="195" height="10"  fill="#1e40af"/>
          <text x="282" y="250" fill="#fff" font-size="11" font-weight="700">personnel_it_career</text>
          <text x="458" y="250" fill="#93c5fd" font-size="10" text-anchor="end">IT경력</text>
          <text x="282" y="280" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="458" y="280" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="282" y="298" fill="#fb923c" font-size="11">🔗 personnel_id</text>
          <text x="458" y="298" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="282" y="316" fill="#e2e8f0" font-size="11">period_start/end</text>
          <text x="458" y="316" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="282" y="334" fill="#e2e8f0" font-size="11">career</text>
          <text x="458" y="334" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="282" y="352" fill="#e2e8f0" font-size="11">duty</text>
          <text x="458" y="352" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="282" y="370" fill="#e2e8f0" font-size="11">basis</text>
          <text x="458" y="370" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
        </g>

        <!-- ────────────────────────────────
             제안작업표 테이블들
        ──────────────────────────────── -->

        <!-- audit_projects -->
        <g id="g-ap">
          <rect x="570" y="50" width="220" height="260" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="2"/>
          <rect x="570" y="50" width="220" height="30"  rx="8" fill="#065f46"/>
          <rect x="570" y="70" width="220" height="10"  fill="#065f46"/>
          <text x="582" y="70" fill="#fff" font-size="12" font-weight="700">audit_projects</text>
          <text x="783" y="70" fill="#6ee7b7" font-size="10" text-anchor="end">감리사업</text>
          <text x="582" y="100" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="782" y="100" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="582" y="118" fill="#e2e8f0" font-size="11">project_name</text>
          <text x="782" y="118" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="136" fill="#e2e8f0" font-size="11">bid_notice_no</text>
          <text x="782" y="136" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="154" fill="#e2e8f0" font-size="11">bid_amount / bid_rate</text>
          <text x="782" y="154" fill="#34d399" font-size="10" text-anchor="end">INT/REAL</text>
          <text x="582" y="172" fill="#e2e8f0" font-size="11">required_md</text>
          <text x="782" y="172" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="582" y="190" fill="#e2e8f0" font-size="11">proposed_md</text>
          <text x="782" y="190" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="582" y="208" fill="#e2e8f0" font-size="11">md_unit_price_incl</text>
          <text x="782" y="208" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="582" y="226" fill="#e2e8f0" font-size="11">proposal_status</text>
          <text x="782" y="226" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="244" fill="#e2e8f0" font-size="11">writer / director</text>
          <text x="782" y="244" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="262" fill="#e2e8f0" font-size="11">eval_method</text>
          <text x="782" y="262" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="280" fill="#94a3b8" font-size="10">+ 23 more columns …</text>
        </g>

        <!-- audit_phases -->
        <g id="g-phases">
          <rect x="820" y="50" width="210" height="215" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
          <rect x="820" y="50" width="210" height="30"  rx="8" fill="#047857"/>
          <rect x="820" y="70" width="210" height="10"  fill="#047857"/>
          <text x="832" y="70" fill="#fff" font-size="12" font-weight="700">audit_phases</text>
          <text x="1023" y="70" fill="#6ee7b7" font-size="10" text-anchor="end">단계일정</text>
          <text x="832" y="100" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="1022" y="100" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="832" y="118" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="1022" y="118" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="832" y="136" fill="#e2e8f0" font-size="11">phase_name</text>
          <text x="1022" y="136" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="832" y="154" fill="#e2e8f0" font-size="11">phase_days</text>
          <text x="1022" y="154" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="832" y="172" fill="#e2e8f0" font-size="11">phase_start/end_date</text>
          <text x="1022" y="172" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="832" y="190" fill="#e2e8f0" font-size="11">pre_survey_md</text>
          <text x="1022" y="190" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="832" y="208" fill="#e2e8f0" font-size="11">audit_md / proposed_md</text>
          <text x="1022" y="208" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="832" y="226" fill="#94a3b8" font-size="10">7단계 저장됨</text>
        </g>

        <!-- audit_phase_assignments -->
        <g id="g-assign">
          <rect x="820" y="290" width="210" height="210" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
          <rect x="820" y="290" width="210" height="30"  rx="8" fill="#047857"/>
          <rect x="820" y="310" width="210" height="10"  fill="#047857"/>
          <text x="832" y="310" fill="#fff" font-size="11" font-weight="700">audit_phase_assignments</text>
          <text x="1023" y="310" fill="#6ee7b7" font-size="10" text-anchor="end">인력배정</text>
          <text x="832" y="340" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="1022" y="340" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="832" y="358" fill="#fb923c" font-size="11">🔗 phase_id</text>
          <text x="1022" y="358" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="832" y="376" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="1022" y="376" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="832" y="394" fill="#fdba74" font-size="11">🔗? personnel_id</text>
          <text x="1022" y="394" fill="#fdba74" font-size="10" text-anchor="end">INT FK?</text>
          <text x="832" y="412" fill="#e2e8f0" font-size="11">person_name</text>
          <text x="1022" y="412" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="832" y="430" fill="#e2e8f0" font-size="11">member_type / domain</text>
          <text x="1022" y="430" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="832" y="448" fill="#e2e8f0" font-size="11">pre_survey/audit_md</text>
          <text x="1022" y="448" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="832" y="466" fill="#c084fc" font-size="11">total_md</text>
          <text x="1022" y="466" fill="#c084fc" font-size="10" text-anchor="end">STORED</text>
        </g>

        <!-- proposal_members -->
        <g id="g-pmem">
          <rect x="570" y="340" width="225" height="215" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
          <rect x="570" y="340" width="225" height="30"  rx="8" fill="#047857"/>
          <rect x="570" y="360" width="225" height="10"  fill="#047857"/>
          <text x="582" y="360" fill="#fff" font-size="12" font-weight="700">proposal_members</text>
          <text x="788" y="360" fill="#6ee7b7" font-size="10" text-anchor="end">제안인력</text>
          <text x="582" y="390" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="787" y="390" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="582" y="408" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="787" y="408" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="582" y="426" fill="#fdba74" font-size="11">🔗? personnel_id</text>
          <text x="787" y="426" fill="#fdba74" font-size="10" text-anchor="end">INT FK?</text>
          <text x="582" y="444" fill="#e2e8f0" font-size="11">person_name</text>
          <text x="787" y="444" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="462" fill="#e2e8f0" font-size="11">member_group/type</text>
          <text x="787" y="462" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="480" fill="#e2e8f0" font-size="11">regular/additional_md</text>
          <text x="787" y="480" fill="#34d399" font-size="10" text-anchor="end">INT</text>
          <text x="582" y="498" fill="#c084fc" font-size="11">total_md</text>
          <text x="787" y="498" fill="#c084fc" font-size="10" text-anchor="end">STORED</text>
          <text x="582" y="516" fill="#e2e8f0" font-size="11">auditor_grade/cert_no</text>
          <text x="787" y="516" fill="#94a3b8" font-size="10" text-anchor="end">스냅샷</text>
          <text x="582" y="534" fill="#94a3b8" font-size="10">27명 저장됨</text>
        </g>

        <!-- proposal_files -->
        <g id="g-pfiles">
          <rect x="570" y="580" width="180" height="80" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
          <rect x="570" y="580" width="180" height="26" rx="8" fill="#047857"/>
          <rect x="570" y="596" width="180" height="10" fill="#047857"/>
          <text x="582" y="596" fill="#fff" font-size="11" font-weight="700">proposal_files</text>
          <text x="743" y="596" fill="#6ee7b7" font-size="10" text-anchor="end">파일</text>
          <text x="582" y="620" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="742" y="620" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="582" y="638" fill="#e2e8f0" font-size="11">file_name / category</text>
          <text x="742" y="638" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
        </g>

        <!-- proposal_attachments_toc -->
        <g id="g-ptoc">
          <rect x="780" y="580" width="205" height="80" rx="8" fill="#1e293b" stroke="#10b981" stroke-width="1.5"/>
          <rect x="780" y="580" width="205" height="26" rx="8" fill="#047857"/>
          <rect x="780" y="596" width="205" height="10" fill="#047857"/>
          <text x="792" y="596" fill="#fff" font-size="11" font-weight="700">proposal_attachments_toc</text>
          <text x="978" y="596" fill="#6ee7b7" font-size="10" text-anchor="end">목차</text>
          <text x="792" y="620" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="977" y="620" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="792" y="638" fill="#e2e8f0" font-size="11">item_order / item_name</text>
          <text x="977" y="638" fill="#34d399" font-size="10" text-anchor="end">INT/TEXT</text>
        </g>

        <!-- keywords -->
        <g id="g-keywords">
          <rect x="570" y="690" width="180" height="100" rx="8" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
          <rect x="570" y="690" width="180" height="26" rx="8" fill="#92400e"/>
          <rect x="570" y="706" width="180" height="10" fill="#92400e"/>
          <text x="582" y="706" fill="#fff" font-size="11" font-weight="700">keywords</text>
          <text x="743" y="706" fill="#fcd34d" font-size="10" text-anchor="end">키워드</text>
          <text x="582" y="732" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="742" y="732" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="582" y="750" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="742" y="750" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="582" y="768" fill="#e2e8f0" font-size="11">keyword</text>
          <text x="742" y="768" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="582" y="782" fill="#e2e8f0" font-size="11">sort_order</text>
          <text x="742" y="782" fill="#34d399" font-size="10" text-anchor="end">INT</text>
        </g>

        <!-- keyword_mappings -->
        <g id="g-kwmap">
          <rect x="780" y="690" width="205" height="115" rx="8" fill="#1e293b" stroke="#f59e0b" stroke-width="1.5"/>
          <rect x="780" y="690" width="205" height="26" rx="8" fill="#92400e"/>
          <rect x="780" y="706" width="205" height="10" fill="#92400e"/>
          <text x="792" y="706" fill="#fff" font-size="11" font-weight="700">keyword_mappings</text>
          <text x="978" y="706" fill="#fcd34d" font-size="10" text-anchor="end">키워드수정</text>
          <text x="792" y="732" fill="#fbbf24" font-size="11" font-weight="700">🔑 id</text>
          <text x="977" y="732" fill="#34d399" font-size="10" text-anchor="end">INT PK</text>
          <text x="792" y="750" fill="#fb923c" font-size="11">🔗 project_id</text>
          <text x="977" y="750" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="792" y="768" fill="#fb923c" font-size="11">🔗 keyword_id</text>
          <text x="977" y="768" fill="#fb923c" font-size="10" text-anchor="end">INT FK</text>
          <text x="792" y="786" fill="#e2e8f0" font-size="11">original_keyword</text>
          <text x="977" y="786" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
          <text x="792" y="798" fill="#e2e8f0" font-size="11">mapped_keyword</text>
          <text x="977" y="798" fill="#34d399" font-size="10" text-anchor="end">TEXT</text>
        </g>

        <!-- ────────────────────────────────
             관계선
        ──────────────────────────────── -->

        <!-- personnel → certifications (1:N) -->
        <line x1="240" y1="160" x2="270" y2="130" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-blue)"/>
        <text x="248" y="148" fill="#3b82f6" font-size="9">1:N</text>

        <!-- personnel → audit_history (1:N) -->
        <line x1="140" y1="280" x2="140" y2="300" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-blue)"/>
        <text x="145" y="293" fill="#3b82f6" font-size="9">1:N</text>

        <!-- personnel → it_career (1:N) -->
        <line x1="240" y1="200" x2="270" y2="310" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-blue)"/>
        <text x="248" y="260" fill="#3b82f6" font-size="9">1:N</text>

        <!-- personnel → phase_assignments (점선, nullable) -->
        <line x1="240" y1="165" x2="820" y2="394" stroke="#64748b" stroke-width="1" stroke-dasharray="4,4" marker-end="url(#arrow)"/>
        <text x="510" y="270" fill="#64748b" font-size="9">nullable FK</text>

        <!-- personnel → proposal_members (점선, nullable) -->
        <line x1="240" y1="185" x2="570" y2="426" stroke="#64748b" stroke-width="1" stroke-dasharray="4,4" marker-end="url(#arrow)"/>

        <!-- audit_projects → phases (1:N) -->
        <line x1="790" y1="150" x2="820" y2="120" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="793" y="138" fill="#10b981" font-size="9">1:N</text>

        <!-- audit_phases → assignments (1:N) -->
        <line x1="925" y1="265" x2="925" y2="290" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="930" y="280" fill="#10b981" font-size="9">1:N</text>

        <!-- audit_projects → proposal_members (1:N) -->
        <line x1="680" y1="310" x2="680" y2="340" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="685" y="328" fill="#10b981" font-size="9">1:N</text>

        <!-- audit_projects → files (1:N) -->
        <line x1="650" y1="310" x2="640" y2="580" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="628" y="450" fill="#10b981" font-size="9">1:N</text>

        <!-- audit_projects → toc (1:N) -->
        <line x1="750" y1="310" x2="880" y2="580" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="820" y="460" fill="#10b981" font-size="9">1:N</text>

        <!-- audit_projects → keywords (1:N) -->
        <line x1="620" y1="310" x2="620" y2="690" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="625" y="510" fill="#f59e0b" font-size="9">1:N</text>

        <!-- keywords → keyword_mappings (1:N) -->
        <line x1="750" y1="740" x2="780" y2="750" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrow-em)"/>
        <text x="752" y="735" fill="#f59e0b" font-size="9">1:N</text>

        <!-- audit_projects → phase_assignments (1:N direct) -->
        <line x1="790" y1="200" x2="820" y2="376" stroke="#10b981" stroke-width="1" stroke-dasharray="3,3" marker-end="url(#arrow-em)"/>

        <!-- 범례 -->
        <rect x="40" y="510" width="420" height="130" rx="8" fill="#0f172a" stroke="#334155" stroke-width="1"/>
        <text x="52" y="530" fill="#94a3b8" font-size="11" font-weight="700">범례</text>
        <rect x="52" y="540" width="12" height="12" fill="#1d4ed8" rx="2"/>
        <text x="68" y="550" fill="#93c5fd" font-size="10">인력정보 DB 테이블</text>
        <rect x="52" y="558" width="12" height="12" fill="#065f46" rx="2"/>
        <text x="68" y="568" fill="#6ee7b7" font-size="10">제안작업표 DB 테이블</text>
        <text x="52" y="586" fill="#fbbf24" font-size="11">🔑</text>
        <text x="68" y="586" fill="#fbbf24" font-size="10">PK (Primary Key)</text>
        <text x="170" y="586" fill="#fb923c" font-size="11">🔗</text>
        <text x="186" y="586" fill="#fb923c" font-size="10">FK (Foreign Key 필수)</text>
        <text x="52" y="602" fill="#fdba74" font-size="10">🔗?  FK nullable (미등록 인력 허용)</text>
        <text x="52" y="618" fill="#c084fc" font-size="10">STORED  자동 계산 컬럼 (total_md)</text>
        <line x1="170" y1="614" x2="200" y2="614" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4,3"/>
        <text x="205" y="618" fill="#64748b" font-size="10">점선: nullable FK 관계</text>
        <rect x="52" y="626" width="12" height="12" fill="#92400e" rx="2"/>
        <text x="68" y="636" fill="#fcd34d" font-size="10">키워드 테이블 (keywords / keyword_mappings)</text>
      </svg>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════
       탭 2 : 인력정보 DB
  ══════════════════════════════════════════════════ -->
  <div id="tab-personnel" class="panel">
    <div class="flex flex-wrap gap-4">
      <!-- personnel -->
      <div class="erd-table">
        <div class="hd bg-blue-700 text-white">👤 personnel<span class="badge">기본정보</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col"><span class="col-name">name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">position</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">is_fulltime</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">company</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">email</span><span class="col-type">TEXT UK</span></div>
        <div class="erd-col"><span class="col-name">phone</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">birthdate</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">auditor_cert_no</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">auditor_grade</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">tech_grade</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">auditor_career_yrs</span><span class="col-type">REAL</span></div>
        <div class="erd-col"><span class="col-name">auditor_start_date</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">school</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">major</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">degree</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">career_summary</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">career_qualif</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">career_project</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">career_expert</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">education_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">education_hours</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">education_org</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">updated_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- personnel_certifications -->
      <div class="erd-table">
        <div class="hd bg-blue-600 text-white">🏆 certifications<span class="badge">자격증</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 personnel_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">cert_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">cert_year</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">issuer</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">is_national</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">related_field</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- personnel_audit_history -->
      <div class="erd-table">
        <div class="hd bg-blue-600 text-white">📝 audit_history<span class="badge">감리실적</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 personnel_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">audit_yearmonth</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">project_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">client_org</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">sector</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">domain</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">role</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">phase</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">participation_rate</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- personnel_it_career -->
      <div class="erd-table">
        <div class="hd bg-blue-600 text-white">💼 it_career<span class="badge">IT경력</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 personnel_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">period_start</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">period_end</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">career</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">duty</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">basis</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>
    </div>

    <!-- 관계 설명 -->
    <div class="mt-6 bg-slate-800 rounded-xl p-4 text-sm text-slate-300">
      <div class="font-bold text-white mb-2">🔗 관계 (Relationships)</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div class="bg-slate-900 rounded p-2"><span class="text-blue-400 font-bold">personnel</span> 1 ──── N <span class="text-blue-400">certifications</span><br/><span class="text-slate-400">1명이 여러 자격증 보유</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-blue-400 font-bold">personnel</span> 1 ──── N <span class="text-blue-400">audit_history</span><br/><span class="text-slate-400">1명의 감리실적 다수 (현재 104건)</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-blue-400 font-bold">personnel</span> 1 ──── N <span class="text-blue-400">it_career</span><br/><span class="text-slate-400">1명의 IT 실무경력 다수</span></div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════
       탭 3 : 제안작업표 DB
  ══════════════════════════════════════════════════ -->
  <div id="tab-proposal" class="panel">
    <div class="flex flex-wrap gap-4">
      <!-- audit_projects -->
      <div class="erd-table" style="width:240px">
        <div class="hd bg-emerald-700 text-white">🏢 audit_projects<span class="badge">감리사업</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col"><span class="col-name">project_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">bid_notice_no</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">client_org</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">registered_yearmonth</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">target_project_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">target_client_org</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">target_contractor</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">target_budget</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">target_period_start/end</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">target_keywords</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">bid_amount</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">bid_amount_excl_vat</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">bid_rate</span><span class="col-type">REAL</span></div>
        <div class="erd-col"><span class="col-name">base_budget</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">bid_deadline</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">bid_open_dt</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">eval_dt</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">travel_cost_per_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">required_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">proposed_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">optimal_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">md_unit_price_incl</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">md_unit_price_excl</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">base_unit_price</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">proposal_allowance</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">proposal_allowance_rate</span><span class="col-type">REAL</span></div>
        <div class="erd-col"><span class="col-name">required_phases</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">required_audit_days</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">eval_method</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">proposal_status</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">writer / director</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">supporters</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">references_cc</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">special_notes</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">remarks</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">proposal_template</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">updated_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- audit_phases -->
      <div class="erd-table">
        <div class="hd bg-emerald-600 text-white">📅 audit_phases<span class="badge">단계일정</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">phase_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">phase_days</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">phase_start_date</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">phase_end_date</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">phase_order</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">total_auditor_cnt</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">total_expert_cnt</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">pre_survey_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">audit_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">action_confirm_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">proposed_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- audit_phase_assignments -->
      <div class="erd-table">
        <div class="hd bg-emerald-600 text-white">👥 phase_assignments<span class="badge">인력배정</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 phase_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col fkn"><span class="col-name">🔗? personnel_id</span><span class="col-type">INT FK?</span></div>
        <div class="erd-col"><span class="col-name">person_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">member_type</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">domain</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">pre_survey_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">audit_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">action_confirm_md</span><span class="col-type">INT</span></div>
        <div class="erd-col gen"><span class="col-name">total_md</span><span class="col-type">STORED</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- proposal_members -->
      <div class="erd-table">
        <div class="hd bg-emerald-600 text-white">🙋 proposal_members<span class="badge">제안인력</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col fkn"><span class="col-name">🔗? personnel_id</span><span class="col-type">INT FK?</span></div>
        <div class="erd-col"><span class="col-name">person_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">member_group</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">member_type</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">domain</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">regular_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">additional_md</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">acceptance_md</span><span class="col-type">INT</span></div>
        <div class="erd-col gen"><span class="col-name">total_md</span><span class="col-type">STORED</span></div>
        <div class="erd-col"><span class="col-name">is_fulltime</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">auditor_grade</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">auditor_cert_no</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">phone</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">education_hours</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- keywords -->
      <div class="erd-table">
        <div class="hd text-white" style="background:#92400e">🏷️ keywords<span class="badge">키워드</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">keyword</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">sort_order</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
        <div style="padding:4px 12px;font-size:10px;color:#fcd34d;background:#451a0320">UNIQUE (project_id, keyword)</div>
      </div>

      <!-- keyword_mappings -->
      <div class="erd-table">
        <div class="hd text-white" style="background:#92400e">🔄 keyword_mappings<span class="badge">키워드수정</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 keyword_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">original_keyword</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">mapped_keyword</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
        <div style="padding:4px 12px;font-size:10px;color:#fcd34d;background:#451a0320">UNIQUE (keyword_id, mapped_keyword)</div>
      </div>

      <!-- proposal_files -->
      <div class="erd-table">
        <div class="hd bg-emerald-600 text-white">📁 proposal_files<span class="badge">파일</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">file_category</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">file_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">file_size_kb</span><span class="col-type">REAL</span></div>
        <div class="erd-col"><span class="col-name">uploaded_at</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">file_type</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>

      <!-- proposal_attachments_toc -->
      <div class="erd-table">
        <div class="hd bg-emerald-600 text-white">📋 attachments_toc<span class="badge">첨부목차</span></div>
        <div class="erd-col pk"><span class="col-name">🔑 id</span><span class="col-type">INT PK</span></div>
        <div class="erd-col fk"><span class="col-name">🔗 project_id</span><span class="col-type">INT FK</span></div>
        <div class="erd-col"><span class="col-name">item_order</span><span class="col-type">INT</span></div>
        <div class="erd-col"><span class="col-name">item_name</span><span class="col-type">TEXT</span></div>
        <div class="erd-col"><span class="col-name">created_at</span><span class="col-type">TEXT</span></div>
      </div>
    </div>

    <div class="mt-6 bg-slate-800 rounded-xl p-4 text-sm text-slate-300">
      <div class="font-bold text-white mb-2">🔗 관계 (Relationships)</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_projects</span> 1 ── N <span class="text-emerald-400">audit_phases</span><br/><span class="text-slate-400">1개 사업에 7단계 일정</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_phases</span> 1 ── N <span class="text-emerald-400">phase_assignments</span><br/><span class="text-slate-400">각 단계별 투입 인력</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_projects</span> 1 ── N <span class="text-emerald-400">proposal_members</span><br/><span class="text-slate-400">제안 인력 27명</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_projects</span> 1 ── N <span class="text-emerald-400">proposal_files</span><br/><span class="text-slate-400">관련 파일 목록</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_projects</span> 1 ── N <span class="text-emerald-400">attachments_toc</span><br/><span class="text-slate-400">첨부 목차 항목</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-emerald-400 font-bold">audit_projects</span> 1 ── N <span style="color:#fcd34d">keywords</span><br/><span class="text-slate-400">사업별 키워드 태그 (32개)</span></div>
        <div class="bg-slate-900 rounded p-2"><span style="color:#fcd34d" class="font-bold">keywords</span> 1 ── N <span style="color:#fcd34d">keyword_mappings</span><br/><span class="text-slate-400">영문 약어 → 한글 매핑 (5개)</span></div>
        <div class="bg-slate-900 rounded p-2"><span class="text-purple-400 font-bold">total_md</span><br/><span class="text-slate-400">pre_survey + audit + action_confirm MD 자동 합산 (STORED)</span></div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════
       탭 4 : 컬럼 상세 (집계 통계)
  ══════════════════════════════════════════════════ -->
  <div id="tab-columns" class="panel">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

      <!-- 인력 DB 통계 -->
      <div class="bg-slate-800 rounded-xl p-5">
        <h3 class="text-blue-400 font-bold text-base mb-4">👤 인력정보 DB 요약</h3>
        <table class="w-full detail-table">
          <thead><tr><th>테이블</th><th>컬럼 수</th><th>현재 데이터</th><th>설명</th></tr></thead>
          <tbody>
            <tr><td class="text-blue-300 font-semibold">personnel</td><td>25</td><td>1명 (강신배)</td><td>기본정보, 감리원등급, 학력, 교육이력</td></tr>
            <tr><td class="text-blue-300 font-semibold">certifications</td><td>8</td><td>4건</td><td>수석감리원, 기술사, PMP, 정보처리기사</td></tr>
            <tr><td class="text-blue-300 font-semibold">audit_history</td><td>11</td><td>104건</td><td>2020~2026년 전체 감리 실적</td></tr>
            <tr><td class="text-blue-300 font-semibold">it_career</td><td>11</td><td>6건</td><td>코스콤 등 IT 실무 경력</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 제안작업표 DB 통계 -->
      <div class="bg-slate-800 rounded-xl p-5">
        <h3 class="text-emerald-400 font-bold text-base mb-4">📋 제안작업표 DB 요약</h3>
        <table class="w-full detail-table">
          <thead><tr><th>테이블</th><th>컬럼 수</th><th>현재 데이터</th><th>설명</th></tr></thead>
          <tbody>
            <tr><td class="text-emerald-300 font-semibold">audit_projects</td><td>39</td><td>1건</td><td>글로컬 O2O 플랫폼 감리용역</td></tr>
            <tr><td class="text-emerald-300 font-semibold">audit_phases</td><td>14</td><td>7건</td><td>요구정의~상시감리 7단계</td></tr>
            <tr><td class="text-emerald-300 font-semibold">phase_assignments</td><td>12</td><td>37건</td><td>단계별 인력 MD 배정</td></tr>
            <tr><td class="text-emerald-300 font-semibold">proposal_members</td><td>17</td><td>27명</td><td>감리원6 + 전문가14 + 테스터7</td></tr>
            <tr><td class="text-emerald-300 font-semibold">proposal_files</td><td>8</td><td>7건</td><td>hwp, pdf, pptx 파일</td></tr>
            <tr><td class="text-emerald-300 font-semibold">attachments_toc</td><td>5</td><td>10건</td><td>제안서 첨부 목차</td></tr>
            <tr><td style="color:#fcd34d" class="font-semibold">keywords</td><td>5</td><td>32개</td><td>사업별 키워드 태그 (엑셀 ERD 추가)</td></tr>
            <tr><td style="color:#fcd34d" class="font-semibold">keyword_mappings</td><td>6</td><td>5개</td><td>영문↔한글 키워드 변환 (엑셀 ERD 추가)</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 인덱스 -->
      <div class="bg-slate-800 rounded-xl p-5 md:col-span-2">
        <h3 class="text-slate-300 font-bold text-base mb-4">🗂️ 인덱스 목록</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_personnel_name<br/><span class="text-slate-500">personnel(name)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_personnel_auditor_grade<br/><span class="text-slate-500">personnel(auditor_grade)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_audit_history_personnel<br/><span class="text-slate-500">audit_history(personnel_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_audit_history_yearmonth<br/><span class="text-slate-500">audit_history(audit_yearmonth)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_it_career_personnel<br/><span class="text-slate-500">it_career(personnel_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_certifications_personnel<br/><span class="text-slate-500">certifications(personnel_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_audit_projects_name<br/><span class="text-slate-500">audit_projects(project_name)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_audit_projects_status<br/><span class="text-slate-500">audit_projects(proposal_status)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_audit_phases_project<br/><span class="text-slate-500">audit_phases(project_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_phase_assignments_phase<br/><span class="text-slate-500">phase_assignments(phase_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_phase_assignments_person<br/><span class="text-slate-500">phase_assignments(personnel_id)</span></div>
          <div class="bg-slate-900 rounded p-2 text-slate-300">idx_proposal_members_project<br/><span class="text-slate-500">proposal_members(project_id)</span></div>
          <div class="bg-slate-900 rounded p-2" style="color:#fcd34d">idx_keywords_project<br/><span class="text-slate-500">keywords(project_id)</span></div>
          <div class="bg-slate-900 rounded p-2" style="color:#fcd34d">idx_keywords_keyword<br/><span class="text-slate-500">keywords(keyword)</span></div>
          <div class="bg-slate-900 rounded p-2" style="color:#fcd34d">idx_kwmap_project<br/><span class="text-slate-500">keyword_mappings(project_id)</span></div>
          <div class="bg-slate-900 rounded p-2" style="color:#fcd34d">idx_kwmap_keyword<br/><span class="text-slate-500">keyword_mappings(keyword_id)</span></div>
        </div>
      </div>
    </div>
  </div>

</div><!-- /max-w -->

<script>
  function switchTab(name, btn) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
</script>
</body>
</html>
`;
export { erdHtml };
export default erdHtml;
