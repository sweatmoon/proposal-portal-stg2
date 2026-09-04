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
 *        src/routes/ppt-cover.ts                  (0. 정성제안서 첨부 표지)
 *        src/routes/ppt-schedule.ts               (1. 감리원 일정 현황표)
 *        src/routes/ppt-career.ts                 (2. 투입 감리원별 실적 및 경력)
 *        src/routes/ppt-consent.ts                (3. 비상근 감리원 참여 동의서)
 *        src/routes/ppt-financial-statement.ts    (4. 표준재무제표)
 *        src/routes/ppt-business-registration.ts  (5. 사업자등록증)
 *        src/routes/ppt-tax-certificate.ts        (6. 국세 납세증명서)
 *        src/routes/ppt-local-tax-certificate.ts  (7. 지방세 납세증명서)
 *        src/routes/ppt-corporate-registry.ts     (8. 법인등기부등본)
 *        src/routes/ppt-attachment-bundle.ts      (표지+선택 항목을 순서대로 합치는 조립 라우트)
 *        src/lib/pptx-*.ts, src/lib/nas-client.ts (위 라우트들이 공용으로 쓰는 유틸)
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
 * 항목 구성(BUNDLE_ITEM_DEFS)은 지금 5개(일정표/실적경력/동의서/표준재무제표/사업자등록증)
 * 이지만, 나중에 다른 첨부가 추가될 수 있으므로 배열에 한 줄만 추가하면 되도록 설계했습니다 —
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
    <div id="bundleModal" class="hidden fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 gap-4">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg h-[640px] flex flex-col">
        <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="font-bold text-slate-800"><i class="fas fa-paperclip mr-2 text-indigo-500"></i>첨부PPT 생성</h3>
            <p class="text-xs text-slate-400 mt-0.5">표지는 항상 자동 포함되며, 아래 체크·드래그한 순서대로 목차 번호가 매겨집니다.</p>
          </div>
          <button onclick="closeBundleModal()" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>

        <!-- flex-1 min-h-0 + overflow-y-auto: 단계별 선택/도장 선택 칸이 나타나거나 사라져도
             모달 전체 크기는 고정된 채 이 영역만 내부 스크롤되게 한다(2026-09-04 사용자 확인 —
             "체크가 있든 없든 똑같은 크기를 유지... 계속 크기가 바뀌니까 헷갈림"). -->
        <div class="px-6 py-4 overflow-y-auto space-y-4 flex-1 min-h-0">
          <!-- 항목 목록 (체크 + 실시간 드래그 재정렬). 기본 3종(일정표/실적경력/동의서) 외의
               항목은 여기 바로 안 보이고 "추가서류" 패널에서 드래그해 넣어야 나타난다
               (2026-09-04 사용자 확인 — 첨부 종류가 계속 늘어날 걸 대비한 UX). -->
          <div id="bundleItemList" class="space-y-2"
               ondragover="event.preventDefault()" ondrop="bundleListDrop(event)"></div>

          <!-- 추가서류 패널 열기/닫기 토글 -->
          <button type="button" onclick="toggleExtraPanel()"
                  class="w-full text-xs font-semibold text-indigo-600 border border-dashed border-indigo-300 rounded-lg py-2 hover:bg-indigo-50 flex items-center justify-center gap-1.5">
            <i class="fas fa-layer-group"></i> 추가서류
            <i id="bundleExtraToggleIcon" class="fas fa-chevron-right text-[10px]"></i>
          </button>

          <!-- 일정표 선택 시에만 나타나는 단계별 추가/정기 선택 -->
          <div id="bundleSchedulePhaseWrap" class="hidden bg-indigo-50 rounded-xl p-3 border border-indigo-200">
            <div class="text-xs font-bold text-indigo-700 mb-1">단계별 감리 구분 선택</div>
            <p class="text-xs text-indigo-400 mb-2">
              검수지원 단계는 자동으로 "검수지원"으로 표시됩니다. <b>추가</b>로 표시할 단계만 체크하세요 (체크 안 하면 "정기").
            </p>
            <div id="bundleSchedulePhaseList" class="space-y-1.5 max-h-40 overflow-y-auto text-xs text-slate-600"></div>
          </div>

          <!-- 사업자등록증/국세·지방세 납세증명서/법인등기부등본 중 하나라도 선택 시 나타나는
               도장 종류 선택 — 이 항목들은 전부 "범용 템플릿(도장O)"를 공유하므로 도장도
               한 번만 골라서 전체에 일괄 적용한다(2026-09-03 사용자 확인). -->
          <div id="bundleStampWrap" class="hidden bg-amber-50 rounded-xl p-3 border border-amber-200">
            <div class="text-xs font-bold text-amber-700 mb-2">찍을 도장 선택 (사업자등록증·납세증명서·법인등기부등본에 공통 적용)</div>
            <div class="flex gap-4 text-sm text-slate-700">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="bundleStamp" value="원본대조필" class="accent-amber-600" onchange="onStampChange(this.value)">
                원본대조필
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="bundleStamp" value="사실과상위없음" class="accent-amber-600" onchange="onStampChange(this.value)">
                사실과상위없음
              </label>
            </div>
          </div>

          <!-- 법인등기부등본 선택 시에만 나타나는 말소사항 포함 여부 선택 -->
          <div id="bundleCorpRegistryWrap" class="hidden bg-sky-50 rounded-xl p-3 border border-sky-200">
            <div class="text-xs font-bold text-sky-700 mb-2">법인등기부등본 말소사항 포함 여부</div>
            <div class="flex gap-4 text-sm text-slate-700">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="bundleCorpRegistryCancelled" value="true" class="accent-sky-600" onchange="onCorpRegistryCancelledChange(this.value)">
                말소사항포함
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="bundleCorpRegistryCancelled" value="false" class="accent-sky-600" onchange="onCorpRegistryCancelledChange(this.value)">
                말소사항미포함
              </label>
            </div>
          </div>
        </div>

        <div class="px-6 py-3 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
          <button onclick="closeBundleModal()" class="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">취소</button>
          <button onclick="confirmGenerateBundle()" id="bundleConfirmBtn" class="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">생성</button>
        </div>
      </div>

      <!-- 추가서류 패널 — "추가서류" 버튼을 누르면 본 모달 오른쪽에 나타난다. 여기 카드를
           왼쪽 항목 목록으로 드래그하면 그 항목이 목록에 추가되고 자동으로 체크되며,
           반대로 왼쪽 목록의 항목을 이 패널로 드래그하면 목록에서 빠진다(2026-09-04
           사용자 확인 — "왼쪽에서 오른쪽으로도 드래그가 되게"). 크기는 왼쪽 모달과
           맞춰 큼지막한 고정 크기로 두고(항목 수에 따라 커지거나 작아지지 않음),
           카드는 가나다순으로 정렬한다. -->
      <div id="bundleExtraPanel" class="hidden bg-white rounded-2xl shadow-xl w-96 h-[640px] flex flex-col"
           ondragover="event.preventDefault()" ondrop="bundleExtraPanelDrop(event)">
        <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h4 class="font-bold text-slate-700 text-sm"><i class="fas fa-layer-group mr-1.5 text-indigo-400"></i>추가서류</h4>
          <button onclick="toggleExtraPanel()" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
        </div>
        <p class="px-4 pt-3 text-xs text-slate-400 flex-shrink-0">왼쪽 목록과 이 패널 사이로 서로 드래그해서 넣고 뺄 수 있습니다.</p>
        <div id="bundleExtraList" class="p-3 space-y-2 overflow-y-auto flex-1 min-h-0"></div>
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
  // templateLabel: 업로드 드롭존에 표시할 이름(그 항목 전용 템플릿일 때만). templateGroup:
  // 여러 항목이 "완전히 같은 템플릿 파일 하나"를 공유할 때 쓰는 묶음 키 — 사업자등록증/
  // 국세·지방세 납세증명서/법인등기부등본은 전부 "범용 템플릿(도장O)" 한 장만 올리면
  // 되므로(2026-09-03 사용자 확인 — "전부 범용(도장o) 쓸 거임") 같은 templateGroup을
  // 준다. templateGroup이 있으면 templateLabel은 무시되고 TEMPLATE_GROUPS의 label을 쓴다.
  // label(체크박스·표지 목차에 쓰는 실제 항목명)은 항상 항목별로 따로 둔다.
  const BUNDLE_ITEM_DEFS = [
    { id: 'schedule',      label: '감리원 일정 현황표', icon: 'fa-calendar-check' },
    { id: 'career',        label: '투입 감리원별 실적 및 경력', icon: 'fa-id-card' },
    { id: 'consent',       label: '비상근 감리원 참여 동의서', icon: 'fa-file-signature' },
    { id: 'financial',     label: '표준재무제표', icon: 'fa-file-invoice-dollar', templateLabel: '범용 템플릿(도장X)' },
    { id: 'bizreg',        label: '사업자등록증', icon: 'fa-id-badge', templateGroup: 'stamped' },
    { id: 'taxcert',       label: '국세 납세증명서', icon: 'fa-file-invoice', templateGroup: 'stamped' },
    { id: 'localtaxcert',  label: '지방세 납세증명서', icon: 'fa-file-invoice', templateGroup: 'stamped' },
    { id: 'corpregistry',  label: '법인등기부등본', icon: 'fa-building', templateGroup: 'stamped' },
    { id: 'insurance',     label: '4대보험 가입확인서', icon: 'fa-notes-medical', templateGroup: 'stamped' },
  ]
  // templateGroup으로 묶이는 항목들이 공유하는 템플릿 업로드 슬롯 정의.
  const TEMPLATE_GROUPS = [
    { id: 'stamped', label: '범용 템플릿(도장O)', icon: 'fa-stamp' },
  ]
  // 항목이 속한 템플릿 업로드 슬롯 id(=bundleFiles의 key) — 전용 템플릿이면 항목 자신의
  // id, 공유 템플릿이면 그 templateGroup id.
  function templateSlotIdFor(def) {
    return def.templateGroup || def.id
  }
  // 표지는 체크 대상이 아니라 항상 포함되지만, 템플릿 업로드 슬롯은 항목들과 같은 자리에 둔다.
  // 전용 템플릿 슬롯 + 실제로 쓰이는 공유 템플릿 그룹 슬롯을 한 번씩만 나열한다.
  const usedGroupIds = [...new Set(BUNDLE_ITEM_DEFS.filter(d => d.templateGroup).map(d => d.templateGroup))]
  const TEMPLATE_SLOTS = [
    { id: 'cover', label: '0. 정성제안서 첨부 표지', icon: 'fa-file-alt', required: true },
    ...BUNDLE_ITEM_DEFS.filter(d => !d.templateGroup).map(d => ({ id: d.id, label: d.templateLabel || d.label, icon: d.icon, required: false })),
    ...usedGroupIds.map(gid => {
      const g = TEMPLATE_GROUPS.find(x => x.id === gid)
      return { id: g.id, label: g.label, icon: g.icon, required: false }
    }),
  ]

  // 1.일정표/2.실적경력/3.동의서는 거의 항상 같이 나가는 "기본 3종"이라, 첨부PPT 생성
  // 버튼을 누를 때마다 항상 체크된 채로 맨 앞 순서로 시작한다(2026-09-02 사용자 확인 —
  // "고정"은 시작 상태 얘기일 뿐, 드래그로 다시 옮기는 건 자유롭게 가능해야 함). 그 외
  // 항목(표준재무제표 등, 앞으로 늘어날 "범용" 항목들)은 매번 체크 해제 상태로 그 뒤에
  // 붙는다. 전부 똑같이 드래그로 순서를 바꿀 수 있고 잠긴 항목은 없다.
  const CORE_IDS = ['schedule', 'career', 'consent']
  // "범용 템플릿(도장O)"를 공유하는 항목들 — 하나라도 체크되면 도장 선택 UI가 뜨고,
  // 전부 체크 해제되면 사라진다(2026-09-03 사용자 확인 — 도장 선택은 "딱 한 번만").
  // templateGroup === 'stamped'인 항목을 자동으로 모아서 만든다 — 예전엔 이 배열을
  // 하드코딩해서, 새 도장O 항목을 추가할 때 여기 등록을 깜빡하면 도장 선택 UI가 안 뜨고
  // 검증도 건너뛰어 생성 버튼을 눌러도 모달이 닫힌 채로 서버에서만 실패하는 버그가 있었다
  // (2026-09-04 실측 — 4대보험 가입확인서 추가 시 실제로 이 배열에 등록을 빠뜨렸었음).
  const STAMP_GROUP_IDS = BUNDLE_ITEM_DEFS.filter(d => d.templateGroup === 'stamped').map(d => d.id)

  const bundleFiles = {} // id('cover'|'schedule'|'career'|'consent'|...) -> File — 페이지에 머무는 동안 유지
  const bundleItemChecked = {} // id -> boolean
  let bundleItemOrder = [] // 드래그로 바뀌는 현재 순서 (모달 열 때마다 resetBundleSelection이 기본값으로 채움)

  let bundleProjectId = null
  let bundleBtnEl = null
  let bundleDragId = null
  let bundleDragFromExtra = false // true면 bundleDragId가 "추가서류" 패널 카드에서 시작된 드래그
  let bundleExtraPanelOpen = false
  let bundleStampType = null // '원본대조필' | '사실과상위없음' | null — STAMP_GROUP_IDS 중 하나라도 체크 시 선택
  let bundleCorpRegistryIncludeCancelled = null // 'true' | 'false' | null — 법인등기부등본 체크 시 선택

  /** 첨부PPT 생성 모달을 열 때마다 호출 — 기본 3종만 체크된 채로 목록에 나타난 "시작
   *  상태"로 되돌린다. 그 외 항목(표준재무제표 등)은 목록에 안 보이고 "추가서류" 패널에
   *  있다가 드래그해 넣어야 목록에 나타난다(2026-09-04 사용자 확인 — 첨부 종류가 계속
   *  늘어날 걸 대비해 기본 목록을 짧게 유지). 업로드해둔 템플릿 파일(bundleFiles)은 그대로
   *  유지한다. */
  function resetBundleSelection() {
    bundleItemOrder = [...CORE_IDS]
    CORE_IDS.forEach(id => { bundleItemChecked[id] = true })
    BUNDLE_ITEM_DEFS.filter(d => !CORE_IDS.includes(d.id)).forEach(d => { bundleItemChecked[d.id] = false })
    bundleStampType = null
    bundleCorpRegistryIncludeCancelled = null
    bundleExtraPanelOpen = false
  }

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
      const hasFile = !!bundleFiles[templateSlotIdFor(def)]
      return \`
        <div class="border rounded-xl px-3 py-2.5 flex items-center gap-2 transition cursor-pointer
                    \${checked ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}"
             draggable="true" data-bundle-id="\${id}"
             onclick="bundleRowClick(event,'\${id}')"
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

  // 체크박스뿐 아니라 행 몸통 아무 데나 눌러도 체크/해제되게 한다(2026-09-04 사용자 확인).
  // 체크박스 자체를 누른 경우는 onchange가 이미 처리하므로 여기서 다시 토글하면 안 된다 —
  // 드래그로 순서를 바꾼 경우는 브라우저가 드래그 후 click 이벤트를 보내지 않으므로 그냥
  // 두면 된다(별도 처리 불필요).
  function bundleRowClick(ev, id) {
    if (ev.target.closest('input[type=checkbox]')) return
    const checkbox = document.querySelector('[data-bundle-id="' + id + '"] input[type=checkbox]')
    checkbox.checked = !checkbox.checked
    toggleBundleItem(id, checkbox.checked)
  }

  function toggleBundleItem(id, checked) {
    bundleItemChecked[id] = checked
    renderBundleList()
    if (id === 'schedule') {
      if (checked) loadBundleSchedulePhases()
      else document.getElementById('bundleSchedulePhaseWrap').classList.add('hidden')
    }
    if (STAMP_GROUP_IDS.includes(id)) {
      const anyStampNeeded = STAMP_GROUP_IDS.some(sid => bundleItemChecked[sid])
      if (anyStampNeeded) {
        document.getElementById('bundleStampWrap').classList.remove('hidden')
      } else {
        document.getElementById('bundleStampWrap').classList.add('hidden')
        bundleStampType = null
        document.querySelectorAll('input[name="bundleStamp"]').forEach(el => { el.checked = false })
      }
    }
    if (id === 'corpregistry') {
      if (checked) {
        document.getElementById('bundleCorpRegistryWrap').classList.remove('hidden')
      } else {
        document.getElementById('bundleCorpRegistryWrap').classList.add('hidden')
        bundleCorpRegistryIncludeCancelled = null
        document.querySelectorAll('input[name="bundleCorpRegistryCancelled"]').forEach(el => { el.checked = false })
      }
    }
  }

  function onStampChange(value) {
    bundleStampType = value
  }

  function onCorpRegistryCancelledChange(value) {
    bundleCorpRegistryIncludeCancelled = value
  }

  // 드래그 중에도 실시간으로 순서가 바뀌어 보이도록, drop을 기다리지 않고
  // dragover 시점에 실제 DOM 노드를 바로 옮긴다 (innerHTML로 통째로 다시 그리면
  // 드래그 중인 노드 자체가 사라져서 네이티브 드래그가 끊기므로 insertBefore로 이동만 한다).
  function bundleDragStart(ev, id) {
    bundleDragId = id
    bundleDragFromExtra = false
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
    bundleDragFromExtra = false
  }

  // ── 추가서류 패널 (기본 3종 외 항목들 — 드래그해서 왼쪽 목록에 넣는다) ──────────
  function toggleExtraPanel() {
    bundleExtraPanelOpen = !bundleExtraPanelOpen
    document.getElementById('bundleExtraPanel').classList.toggle('hidden', !bundleExtraPanelOpen)
    const icon = document.getElementById('bundleExtraToggleIcon')
    icon.classList.toggle('fa-chevron-right', !bundleExtraPanelOpen)
    icon.classList.toggle('fa-chevron-left', bundleExtraPanelOpen)
    if (bundleExtraPanelOpen) renderExtraPanel()
  }

  function renderExtraPanel() {
    const wrap = document.getElementById('bundleExtraList')
    // 가나다순 정렬(2026-09-04 사용자 확인) — 아직 목록에 안 들어간(=드래그로 안 넣은)
    // 항목만 카탈로그에 남는다.
    const extras = BUNDLE_ITEM_DEFS
      .filter(d => !CORE_IDS.includes(d.id) && !bundleItemOrder.includes(d.id))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
    if (!extras.length) {
      wrap.innerHTML = '<div class="text-xs text-slate-400 text-center py-6">추가할 서류가 없습니다</div>'
      return
    }
    wrap.innerHTML = extras.map(d => \`
      <div class="border border-dashed border-indigo-300 rounded-lg px-3 py-2.5 flex items-center gap-2 bg-indigo-50/30 cursor-grab select-none"
           draggable="true"
           ondragstart="bundleExtraDragStart(event,'\${d.id}')"
           ondragend="bundleExtraDragEnd(event)">
        <i class="fas \${d.icon} text-indigo-400 text-sm"></i>
        <span class="text-sm text-slate-700 flex-1">\${d.label}</span>
        <i class="fas fa-grip-vertical text-slate-300 text-xs"></i>
      </div>\`).join('')
  }

  function bundleExtraDragStart(ev, id) {
    bundleDragId = id
    bundleDragFromExtra = true
    ev.dataTransfer.effectAllowed = 'move'
    ev.target.classList.add('opacity-40')
  }
  function bundleExtraDragEnd(ev) {
    ev.target.classList.remove('opacity-40')
    bundleDragId = null
    bundleDragFromExtra = false
  }

  // 추가서류 패널 카드를 왼쪽 항목 목록에 떨어뜨리면 목록 끝에 추가하고 자동 체크한다
  // (2026-09-04 사용자 확인 — "드래그 하면 자동으로 체크되고"). 목록 안에서의 정확한
  // 위치는 기존 재정렬 드래그로 바로 조정할 수 있으므로 여기서는 위치 계산 없이 끝에 붙인다.
  function bundleListDrop(ev) {
    ev.preventDefault()
    if (!bundleDragFromExtra || !bundleDragId) return
    const id = bundleDragId
    bundleDragFromExtra = false
    bundleDragId = null
    if (bundleItemOrder.includes(id)) return
    bundleItemOrder.push(id)
    renderExtraPanel()
    toggleBundleItem(id, true)
  }

  // 반대 방향 — 왼쪽 목록의 항목을 추가서류 패널로 드래그하면 목록에서 빼서 카탈로그로
  // 되돌린다(2026-09-04 사용자 확인 — "왼쪽에서 오른쪽으로도 드래그가 되게"). 기본
  // 3종(CORE_IDS)은 항상 목록에 있어야 하는 항목이라 이 패널로 못 뺀다.
  function bundleExtraPanelDrop(ev) {
    ev.preventDefault()
    if (bundleDragFromExtra || !bundleDragId) return
    const id = bundleDragId
    bundleDragId = null
    if (CORE_IDS.includes(id)) return
    const idx = bundleItemOrder.indexOf(id)
    if (idx === -1) return
    bundleItemOrder.splice(idx, 1)
    toggleBundleItem(id, false)
    renderExtraPanel()
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
    resetBundleSelection()
    document.getElementById('bundleModal').classList.remove('hidden')
    renderBundleList()
    document.getElementById('bundleSchedulePhaseWrap').classList.add('hidden')
    if (bundleItemChecked['schedule']) loadBundleSchedulePhases()
    document.getElementById('bundleStampWrap').classList.add('hidden')
    document.querySelectorAll('input[name="bundleStamp"]').forEach(el => { el.checked = false })
    document.getElementById('bundleCorpRegistryWrap').classList.add('hidden')
    document.querySelectorAll('input[name="bundleCorpRegistryCancelled"]').forEach(el => { el.checked = false })
    document.getElementById('bundleExtraPanel').classList.add('hidden')
    document.getElementById('bundleExtraToggleIcon').classList.add('fa-chevron-right')
    document.getElementById('bundleExtraToggleIcon').classList.remove('fa-chevron-left')
    renderExtraPanel()
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
      const def = BUNDLE_ITEM_DEFS.find(d => d.id === iid)
      if (!bundleFiles[templateSlotIdFor(def)]) {
        const slotLabel = def.templateGroup
          ? TEMPLATE_GROUPS.find(g => g.id === def.templateGroup).label
          : (def.templateLabel || def.label)
        alert('"' + slotLabel + '" 템플릿(.pptx)을 업로드해주세요.')
        return
      }
    }
    const additionalPhaseIds = order.includes('schedule')
      ? [...document.querySelectorAll('.bundle-schedule-phase-checkbox:checked')].map(el => Number(el.value))
      : []
    const stampNeeded = STAMP_GROUP_IDS.some(sid => order.includes(sid))
    if (stampNeeded && !bundleStampType) {
      alert('찍을 도장(원본대조필/사실과상위없음)을 선택해주세요.')
      return
    }
    if (order.includes('corpregistry') && bundleCorpRegistryIncludeCancelled === null) {
      alert('법인등기부등본의 말소사항 포함 여부를 선택해주세요.')
      return
    }

    closeBundleModal()
    const originalHtml = btnEl.innerHTML
    btnEl.disabled = true
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...'
    try {
      const fd = new FormData()
      fd.append('cover', bundleFiles['cover'])
      fd.append('order', JSON.stringify(order))
      fd.append('additionalPhaseIds', JSON.stringify(additionalPhaseIds))
      if (stampNeeded) fd.append('stampType', bundleStampType)
      if (order.includes('corpregistry')) fd.append('corpRegistryIncludeCancelled', bundleCorpRegistryIncludeCancelled)
      order.forEach(iid => {
        const def = BUNDLE_ITEM_DEFS.find(d => d.id === iid)
        fd.append(iid, bundleFiles[templateSlotIdFor(def)])
      })
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
