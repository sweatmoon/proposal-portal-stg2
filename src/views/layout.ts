/**
 * 공통 레이아웃 헬퍼
 */
export function layout(title: string, body: string, activePage: string = '') {
  const nav = [
    { href: '/',          icon: 'fa-home',         label: '홈',          key: 'home' },
    { href: '/proposals', icon: 'fa-clipboard-list',label: '제안작업표', key: 'proposals' },
    { href: '/personnel', icon: 'fa-users',          label: '인력정보',  key: 'personnel' },
    { href: '/upload',    icon: 'fa-upload',         label: 'HTML 업로드', key: 'upload' },
    { href: '/ppt-generate', icon: 'fa-file-powerpoint', label: 'PPT 생성', key: 'ppt-generate' },
    { href: '/ppt-templates', icon: 'fa-layer-group', label: 'PPT 관리',  key: 'ppt-templates' },
  ]
  const navHtml = nav.map(n => `
    <a href="${n.href}" class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition
      ${activePage === n.key
        ? 'bg-indigo-600 text-white'
        : 'text-slate-300 hover:bg-slate-700 hover:text-white'}">
      <i class="fas ${n.icon} w-4 text-center"></i>
      <span class="hidden md:inline">${n.label}</span>
    </a>`).join('')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — 제안팀 포털</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
  <style>
    .status-badge { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:600; }
    .status-입력중    { background:#fef3c7; color:#92400e; }
    .status-자동화요청 { background:#dbeafe; color:#1e40af; }
    .status-지원요청   { background:#ede9fe; color:#5b21b6; }
    .status-지원완료   { background:#d1fae5; color:#065f46; }
    .status-default   { background:#f1f5f9; color:#475569; }
    .card-hover { transition: transform .15s, box-shadow .15s; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.1); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f1f5f9; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  </style>
</head>
<body class="bg-slate-100 min-h-screen flex flex-col">

<!-- 사이드바 + 콘텐츠 레이아웃 -->
<div class="flex min-h-screen">

  <!-- 사이드바 -->
  <aside class="w-14 md:w-52 bg-slate-800 flex flex-col flex-shrink-0">
    <!-- 로고 -->
    <div class="px-3 py-4 border-b border-slate-700">
      <a href="/" class="flex items-center gap-2">
        <div class="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <i class="fas fa-building text-white text-sm"></i>
        </div>
        <span class="hidden md:block font-bold text-white text-sm leading-tight">제안팀<br><span class="text-indigo-300 font-normal">포털</span></span>
      </a>
    </div>

    <!-- 네비 -->
    <nav class="flex-1 px-2 py-4 space-y-1">
      ${navHtml}
    </nav>

    <!-- 하단 -->
    <div class="px-2 py-3 border-t border-slate-700">
      <div class="flex items-center gap-2 px-2">
        <div class="w-7 h-7 rounded-full bg-indigo-400 flex items-center justify-center flex-shrink-0">
          <i class="fas fa-user text-white text-xs"></i>
        </div>
        <span class="hidden md:block text-xs text-slate-400">감리사업본부</span>
      </div>
    </div>
  </aside>

  <!-- 메인 콘텐츠 -->
  <main class="flex-1 min-w-0 overflow-auto">
    ${body}
  </main>
</div>

</body>
</html>`
}

export function statusBadge(status: string | null): string {
  const s = status ?? ''
  const cls = ['입력중','자동화요청','지원요청','지원완료'].includes(s)
    ? `status-${s.replace(/\s/g,'')}` : 'status-default'
  return `<span class="status-badge ${cls}">${s || '-'}</span>`
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '-'
  return Number(n).toLocaleString('ko-KR') + '원'
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '-'
  return String(s).replace('T', ' ').substring(0, 16)
}
