/**
 * ============================================================================
 *  [ppt-portal 추가 기능] "첨부PPT 생성" 위젯 — 표지 + 감리원 일정 현황표 +
 *  투입 감리원별 실적 및 경력 + 비상근 감리원 참여 동의서를, 체크·드래그로 원하는
 *  항목과 순서를 고른 뒤 한 번에 합쳐서 pptx 하나로 생성하는 화면 부품입니다.
 * ============================================================================
 *
 * 이 파일이 왜 따로 분리돼 있는가?
 *   이 위젯은 proposal-portal-main(실제 운영 사이트)에는 아직 없는, 이번에 새로
 *   만든 기능입니다. 사업 목록 페이지(src/routes/pages.ts `/ppt-generate`)의
 *   "기존" 부분(사업 목록 테이블, 범용 {{TOKEN}} 템플릿 치환 등 — 이 스테이징
 *   사이트에서 먼저 만들어진 baseline 기능)과 절대 뒤섞이지 않도록, 화면(HTML)과
 *   동작(JS)을 이 파일 하나에 통째로 담아뒀습니다. 그래서:
 *     - pages.ts 쪽 코드를 하나도 안 건드리고 이 파일만 통째로 들어내도
 *       "첨부PPT 생성" 기능 전체가 깨끗하게 빠집니다.
 *     - 반대로, 다른 화면(예: 실제 사이트의 사업 상세 페이지)에 이 기능을
 *       붙이고 싶으면 이 파일만 그대로 복사해서 renderAttachmentBundleWidget()의
 *       반환값(html + script)을 끼워넣기만 하면 됩니다.
 *
 * 실제 사이트(proposal-portal-main)로 이식할 때 참고할 점 (2026-09-02 확인):
 *   1) DB 접근: proposal-portal-main의 src/db/client.ts도 여기와 완전히 동일한
 *      `query<T>(sql, params)` / `queryOne<T>(sql, params)` 시그니처를 쓰므로,
 *      이 위젯이 호출하는 백엔드 라우트들(아래 4번)은 수정 없이 그대로 옮길 수
 *      있습니다.
 *   2) jszip: 이 위젯의 실제 pptx 조립은 서버에서 jszip으로 처리합니다.
 *      proposal-portal-main은 현재 pptxgenjs/jszip을 CDN(브라우저)에서만 쓰고
 *      npm 의존성으로는 없으므로, 이식 시 package.json에 "jszip"만 추가하면
 *      됩니다.
 *   3) 무거운 JS 분리 컨벤션: proposal-portal-main은 무거운 화면 스크립트를
 *      public/static/*.js 정적 파일로 분리해서 <script src="..."> 로 불러오는
 *      방식을 이미 쓰고 있습니다(예: ppt-engine.js, proposal-detail.js). 지금은
 *      이 스테이징 사이트의 정적 파일 서빙(dist/static)이 개발 모드에서 아직
 *      연결돼 있지 않아 아래 script를 인라인 <script> 태그로 끼워 넣는
 *      방식으로 두었지만, 이 문자열을 그대로 public/static/attachment-bundle-
 *      widget.js 같은 파일로 옮기고 <script src="/static/attachment-bundle-
 *      widget.js"></script> 로 바꿔도 100% 동일하게 동작합니다 — 코드 자체가
 *      바깥 스코프에 기대는 게 전혀 없는 순수 전역 스크립트라서 그대로
 *      파일로 떼어내기만 하면 됩니다.
 *   4) 같이 옮겨야 하는 백엔드 라우트(전부 이번에 새로 추가한 파일들 —
 *      기존 파일을 수정한 곳은 없음):
 *        src/routes/ppt-cover.ts             (0. 정성제안서 첨부 표지)
 *        src/routes/ppt-schedule.ts          (1. 감리원 일정 현황표)
 *        src/routes/ppt-career.ts            (2. 투입 감리원별 실적 및 경력)
 *        src/routes/ppt-consent.ts           (3. 비상근 감리원 참여 동의서)
 *        src/routes/ppt-attachment-bundle.ts (표지+선택 항목을 순서대로 합치는 조립 라우트)
 *        src/lib/pptx-*.ts                   (위 라우트들이 공용으로 쓰는 OOXML 조작 유틸)
 *      index.tsx에 import + app.route(...) 한 줄씩만 추가하면 끝입니다
 *      (자세한 건 src/index.tsx의 "[ppt-portal 추가 기능]" 배너 주석 참고).
 *
 * 사용법 — 호출하는 쪽(pages.ts)에서 이렇게 끼워 넣습니다:
 *   import { renderAttachmentBundleWidget } from '../views/attachment-bundle-widget.js'
 *   const bundleWidget = renderAttachmentBundleWidget()
 *   본문 어딘가에 `${bundleWidget.html}` 삽입 (표지/항목 업로드 카드 + 생성 모달)
 *   본문 끝 즈음에 `<script>${bundleWidget.script}</script>` 를 "별도" <script>
 *     태그로 추가 (기존 페이지의 <script>와 절대 하나로 합치지 말 것 — 합치는 순간
 *     "이 파일만 떼어내면 끝"이 아니게 됩니다)
 *   사업 목록 테이블의 각 행에 버튼 하나만 추가해서 이 위젯을 열면 됩니다:
 *     <button onclick="openBundleModal(${p.id}, this)">첨부PPT 생성</button>
 *   (openBundleModal은 위 script가 전역에 등록하는 함수이므로, 페이지의 다른
 *   스크립트에서 문자열로 참조만 하면 되고 import는 필요 없습니다.)
 *
 * 항목 구성(BUNDLE_ITEM_DEFS)은 지금 4개(일정표/실적경력/동의서/표준재무제표)이지만,
 * 나중에 다른 첨부가 추가될 수 있으므로 배열에 한 줄만 추가하면 되도록 설계했습니다 —
 * id는 반드시 백엔드 src/routes/ppt-attachment-bundle.ts의 ATTACHMENT_TYPES
 * 레지스트리 key와 같아야 합니다.
 */

export interface AttachmentBundleWidget {
  /** 표지+항목 템플릿 업로드 카드 + "첨부PPT 생성" 모달의 HTML. 사업 목록 테이블
   *  근처(위 또는 아래)에 그대로 끼워 넣으면 됩니다. */
  html: string
  /** 위 html을 동작시키는 전역 스크립트. 반드시 "별도" <script> 태그로 감싸서
   *  삽입하세요 — 이 파일만 떼어내는 시나리오를 항상 그대로 유지하기 위함입니다. */
  script: string
}

export function renderAttachmentBundleWidget(): AttachmentBundleWidget {
  const html = `
    <!-- ▼▼▼ [ppt-portal 추가 기능] 첨부PPT 템플릿 업로드 (표지 + 항목별) ▼▼▼
         자세한 설명: src/views/attachment-bundle-widget.ts -->
    <div class="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 class="text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
        <i class="fas fa-paperclip text-violet-500"></i> 첨부PPT 템플릿 (표지 + 항목별)
      </h2>
      <p class="text-xs text-slate-400 mb-3">
        클릭하거나 파일을 끌어다 놓아 업로드하세요. 이 파일들은 서버에 저장되지 않고, "첨부PPT 생성" 클릭 시에만
        그 요청 처리 중에 잠깐 사용되고 폐기됩니다.
      </p>
      <div id="bundleTemplateSlots" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
    </div>

    <!-- 첨부PPT 생성 모달: 체크/드래그 가능한 항목 목록 (템플릿 파일은 위쪽에서 업로드) -->
    <div id="bundleModal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="font-bold text-slate-800"><i class="fas fa-paperclip mr-2 text-indigo-500"></i>첨부PPT 생성</h3>
            <p class="text-xs text-slate-400 mt-0.5">표지는 항상 자동 포함되며, 아래 체크·드래그한 순서대로 목차 번호가 매겨집니다.</p>
          </div>
          <button onclick="closeBundleModal()" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>

        <div class="px-6 py-4 overflow-y-auto space-y-4">
          <!-- 항목 목록 (체크 + 실시간 드래그 재정렬) -->
          <div id="bundleItemList" class="space-y-2"></div>

          <!-- 일정표 선택 시에만 나타나는 단계별 추가/정기 선택 -->
          <div id="bundleSchedulePhaseWrap" class="hidden bg-indigo-50 rounded-xl p-3 border border-indigo-200">
            <div class="text-xs font-bold text-indigo-700 mb-1">단계별 감리 구분 선택</div>
            <p class="text-xs text-indigo-400 mb-2">
              검수지원 단계는 자동으로 "검수지원"으로 표시됩니다. <b>추가</b>로 표시할 단계만 체크하세요 (체크 안 하면 "정기").
            </p>
            <div id="bundleSchedulePhaseList" class="space-y-1.5 max-h-40 overflow-y-auto text-xs text-slate-600"></div>
          </div>
        </div>

        <div class="px-6 py-3 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
          <button onclick="closeBundleModal()" class="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">취소</button>
          <button onclick="confirmGenerateBundle()" id="bundleConfirmBtn" class="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">생성</button>
        </div>
      </div>
    </div>
    <!-- ▲▲▲ [ppt-portal 추가 기능] 첨부PPT 위젯 HTML 끝 ▲▲▲ -->
  `

  const script = `
  // ============================================================================
  // [ppt-portal 추가 기능] "첨부PPT 생성" 위젯 스크립트
  // 이 스크립트는 바깥 페이지의 다른 코드에 전혀 의존하지 않는 순수 전역
  // 스크립트입니다 (escapeHtml도 이름 충돌을 피하려고 이 스크립트 전용으로
  // 하나 더 둡니다) — 통째로 다른 페이지에 옮기거나 정적 .js 파일로 분리해도
  // 그대로 동작합니다. 자세한 설명은 src/views/attachment-bundle-widget.ts 참고.
  // ============================================================================
  function _bundleEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
  }

  // 항목 레지스트리 — 나중에 새 첨부가 추가되면 여기에 한 줄만 추가하면 된다
  // (백엔드 src/routes/ppt-attachment-bundle.ts 의 ATTACHMENT_TYPES 와 id를 맞출 것).
  // templateLabel: 업로드 드롭존에 표시할 이름. 일정표/실적경력/동의서처럼 그 항목
  // 전용으로 만든 템플릿은 label을 그대로 쓰고, 표준재무제표처럼 "범용"(placeholder
  // 이미지 하나만 있으면 되는, 내용과 무관하게 재사용 가능한 구조) 템플릿을 쓰는
  // 항목은 templateLabel을 "범용 템플릿"으로 따로 지정한다 — 표지/일정표/실적경력/
  // 동의서를 제외한 대부분의 향후 첨부는 이 "범용" 쪽일 가능성이 높다(2026-09-02
  // 사용자 확인). label(체크박스·표지 목차에 쓰는 실제 항목명)은 항상 그대로 둔다.
  const BUNDLE_ITEM_DEFS = [
    { id: 'schedule',  label: '감리원 일정 현황표', icon: 'fa-calendar-check' },
    { id: 'career',    label: '투입 감리원별 실적 및 경력', icon: 'fa-id-card' },
    { id: 'consent',   label: '비상근 감리원 참여 동의서', icon: 'fa-file-signature' },
    { id: 'financial', label: '표준재무제표', icon: 'fa-file-invoice-dollar', templateLabel: '범용 템플릿' },
  ]
  // 표지는 체크 대상이 아니라 항상 포함되지만, 템플릿 업로드 슬롯은 항목들과 같은 자리에 둔다.
  const TEMPLATE_SLOTS = [
    { id: 'cover', label: '0. 정성제안서 첨부 표지', icon: 'fa-file-alt', required: true },
    ...BUNDLE_ITEM_DEFS.map(d => ({ id: d.id, label: d.templateLabel || d.label, icon: d.icon, required: false })),
  ]

  const bundleFiles = {} // id('cover'|'schedule'|'career'|'consent') -> File — 페이지에 머무는 동안 유지
  const bundleItemChecked = {} // id -> boolean
  let bundleItemOrder = BUNDLE_ITEM_DEFS.map(d => d.id) // 드래그로 바뀌는 현재 순서
  BUNDLE_ITEM_DEFS.forEach(d => { bundleItemChecked[d.id] = true }) // 기본은 전부 체크

  let bundleProjectId = null
  let bundleBtnEl = null
  let bundleDragId = null

  // ── 템플릿 업로드 슬롯 (클릭 또는 드래그앤드롭) ────────────────────
  function renderTemplateSlots() {
    const wrap = document.getElementById('bundleTemplateSlots')
    wrap.innerHTML = TEMPLATE_SLOTS.map(slot => {
      const file = bundleFiles[slot.id]
      return \`
        <div id="dz_\${slot.id}"
             class="border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition select-none
                    \${file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 hover:border-violet-400 hover:bg-violet-50'}"
             onclick="document.getElementById('file_\${slot.id}').click()"
             ondragover="bundleDzOver(event,'\${slot.id}')"
             ondragleave="bundleDzLeave(event,'\${slot.id}')"
             ondrop="bundleDzDrop(event,'\${slot.id}')">
          <i class="fas \${file ? 'fa-check-circle text-emerald-500' : slot.icon + ' text-slate-300'} text-xl mb-1.5"></i>
          <div class="text-xs font-semibold text-slate-700 leading-snug">\${slot.label}\${slot.required ? ' <span class="text-red-400">*</span>' : ''}</div>
          <div class="mt-1 text-xs \${file ? 'text-emerald-600 font-medium truncate' : 'text-slate-400'}">
            \${file ? ('✅ ' + _bundleEscapeHtml(file.name)) : '클릭 / 드래그로 업로드'}
          </div>
          <input type="file" id="file_\${slot.id}" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                 class="hidden" onchange="onBundleFileSelected('\${slot.id}', this.files && this.files[0])">
        </div>\`
    }).join('')
  }

  function onBundleFileSelected(id, file) {
    bundleFiles[id] = file || null
    renderTemplateSlots()
    renderBundleList()
  }

  function bundleDzOver(ev, id) {
    ev.preventDefault()
    document.getElementById('dz_' + id).classList.add('ring-2', 'ring-violet-400')
  }
  function bundleDzLeave(ev, id) {
    document.getElementById('dz_' + id).classList.remove('ring-2', 'ring-violet-400')
  }
  function bundleDzDrop(ev, id) {
    ev.preventDefault()
    document.getElementById('dz_' + id).classList.remove('ring-2', 'ring-violet-400')
    const f = ev.dataTransfer.files && ev.dataTransfer.files[0]
    if (f) onBundleFileSelected(id, f)
  }

  renderTemplateSlots()

  // ── 항목 체크/순서 목록 (모달 안) ──────────────────────────────────
  function renderBundleList() {
    const listEl = document.getElementById('bundleItemList')
    listEl.innerHTML = bundleItemOrder.map(id => {
      const def = BUNDLE_ITEM_DEFS.find(d => d.id === id)
      const checked = bundleItemChecked[id]
      const hasFile = !!bundleFiles[id]
      return \`
        <div class="border rounded-xl px-3 py-2.5 flex items-center gap-2 transition
                    \${checked ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}"
             draggable="true" data-bundle-id="\${id}"
             ondragstart="bundleDragStart(event,'\${id}')"
             ondragover="bundleDragOver(event,'\${id}')"
             ondragend="bundleDragEnd(event)">
          <i class="fas fa-grip-vertical text-slate-300 cursor-grab" title="드래그해서 순서 변경"></i>
          <input type="checkbox" class="w-4 h-4 accent-indigo-600" \${checked ? 'checked' : ''}
                 onchange="toggleBundleItem('\${id}', this.checked)">
          <i class="fas \${def.icon} text-indigo-400 text-xs"></i>
          <span class="text-sm font-medium text-slate-700 flex-1">\${def.label}</span>
          \${hasFile
            ? '<span class="text-xs text-emerald-600 font-medium"><i class="fas fa-check-circle"></i> 템플릿 완료</span>'
            : '<span class="text-xs text-amber-500 font-medium"><i class="fas fa-exclamation-circle"></i> 템플릿 필요</span>'}
        </div>\`
    }).join('')
  }

  function toggleBundleItem(id, checked) {
    bundleItemChecked[id] = checked
    renderBundleList()
    if (id === 'schedule') {
      if (checked) loadBundleSchedulePhases()
      else document.getElementById('bundleSchedulePhaseWrap').classList.add('hidden')
    }
  }

  // 드래그 중에도 실시간으로 순서가 바뀌어 보이도록, drop을 기다리지 않고
  // dragover 시점에 실제 DOM 노드를 바로 옮긴다 (innerHTML로 통째로 다시 그리면
  // 드래그 중인 노드 자체가 사라져서 네이티브 드래그가 끊기므로 insertBefore로 이동만 한다).
  function bundleDragStart(ev, id) {
    bundleDragId = id
    ev.dataTransfer.effectAllowed = 'move'
    ev.target.classList.add('opacity-40')
  }
  function bundleDragOver(ev, targetId) {
    ev.preventDefault()
    if (!bundleDragId || bundleDragId === targetId) return
    const listEl = document.getElementById('bundleItemList')
    const draggedEl = listEl.querySelector('[data-bundle-id="' + bundleDragId + '"]')
    const targetEl = listEl.querySelector('[data-bundle-id="' + targetId + '"]')
    if (!draggedEl || !targetEl) return
    const rect = targetEl.getBoundingClientRect()
    const before = (ev.clientY - rect.top) < rect.height / 2
    listEl.insertBefore(draggedEl, before ? targetEl : targetEl.nextSibling)
    bundleItemOrder = [...listEl.querySelectorAll('[data-bundle-id]')].map(el => el.getAttribute('data-bundle-id'))
  }
  function bundleDragEnd(ev) {
    ev.target.classList.remove('opacity-40')
    bundleDragId = null
  }

  async function loadBundleSchedulePhases() {
    const wrap = document.getElementById('bundleSchedulePhaseWrap')
    const listEl = document.getElementById('bundleSchedulePhaseList')
    wrap.classList.remove('hidden')
    listEl.innerHTML = '<div class="text-slate-400 text-xs">단계 불러오는 중...</div>'
    try {
      const r = await fetch('/api/audit-projects/' + bundleProjectId + '/phases')
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || '단계 조회 실패')
      const phases = j.data || []
      if (!phases.length) {
        listEl.innerHTML = '<div class="text-slate-400 text-xs">이 사업에는 검수지원 외 단계가 없습니다.</div>'
        return
      }
      listEl.innerHTML = phases.map(ph => \`
        <label class="flex items-center gap-2 border border-white bg-white rounded-lg px-3 py-1.5 hover:bg-indigo-100/50 cursor-pointer">
          <input type="checkbox" class="w-4 h-4 accent-indigo-600 bundle-schedule-phase-checkbox" value="\${ph.id}">
          <span>\${_bundleEscapeHtml(ph.phase_name)} <span class="text-slate-400 text-xs">(\${_bundleEscapeHtml(ph.phase_start_date || '')} ~ \${_bundleEscapeHtml(ph.phase_end_date || '')})</span></span>
        </label>\`).join('')
    } catch (e) {
      listEl.innerHTML = '<div class="text-red-500 text-xs">' + _bundleEscapeHtml(e.message) + '</div>'
    }
  }

  // 사업 목록 테이블의 "첨부PPT 생성" 버튼(onclick="openBundleModal(id, this)")에서 호출됨.
  function openBundleModal(id, btnEl) {
    bundleProjectId = id
    bundleBtnEl = btnEl
    document.getElementById('bundleModal').classList.remove('hidden')
    renderBundleList()
    document.getElementById('bundleSchedulePhaseWrap').classList.add('hidden')
    if (bundleItemChecked['schedule']) loadBundleSchedulePhases()
  }

  function closeBundleModal() {
    document.getElementById('bundleModal').classList.add('hidden')
  }

  async function confirmGenerateBundle() {
    const id = bundleProjectId
    const btnEl = bundleBtnEl
    if (!id) return
    if (!bundleFiles['cover']) {
      alert('"0. 정성제안서 첨부 표지" 템플릿을 업로드해주세요.')
      return
    }
    const order = bundleItemOrder.filter(iid => bundleItemChecked[iid])
    if (!order.length) {
      alert('첨부할 항목을 하나 이상 체크해주세요.')
      return
    }
    for (const iid of order) {
      if (!bundleFiles[iid]) {
        const def = BUNDLE_ITEM_DEFS.find(d => d.id === iid)
        alert('"' + (def.templateLabel || def.label) + '" 템플릿(.pptx)을 업로드해주세요.')
        return
      }
    }
    const additionalPhaseIds = order.includes('schedule')
      ? [...document.querySelectorAll('.bundle-schedule-phase-checkbox:checked')].map(el => Number(el.value))
      : []

    closeBundleModal()
    const originalHtml = btnEl.innerHTML
    btnEl.disabled = true
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...'
    try {
      const fd = new FormData()
      fd.append('cover', bundleFiles['cover'])
      fd.append('order', JSON.stringify(order))
      fd.append('additionalPhaseIds', JSON.stringify(additionalPhaseIds))
      order.forEach(iid => fd.append(iid, bundleFiles[iid]))
      const r = await fetch('/api/ppt-attachment-bundle/' + id, { method: 'POST', body: fd })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || ('생성 실패 (' + r.status + ')'))
      }
      const blob = await r.blob()
      const cd = r.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\\*?=["']?(?:UTF-8'')?([^"';]+)/i)
      const filename = m ? decodeURIComponent(m[1]) : ('첨부PPT_' + id + '.pptx')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('첨부PPT 생성 실패: ' + e.message)
    } finally {
      btnEl.disabled = false
      btnEl.innerHTML = originalHtml
    }
  }
  // ============================================================================
  // [ppt-portal 추가 기능] 첨부PPT 생성 위젯 스크립트 끝
  // ============================================================================
  `

  return { html, script }
}
