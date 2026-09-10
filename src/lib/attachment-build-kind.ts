/**
 * [ppt-portal 추가 기능] 첨부 문서 하나하나가 실제로 "어떻게 만들어지는지" 3가지 방식으로
 * 분류한 값 — PPT 템플릿 관리 탭의 첨부 항목과, 첨부PPT 생성(ppt-attachment-bundle.ts)의
 * 항목 레지스트리가 공통으로 참조하는 단일 출처(2026-09-10 사용자 확인 — "지금까지의 첨부
 * 서류들을 이 3가지 버전으로 분류해").
 *
 *   PERSON_PAGES  인력별로 슬라이드(페이지)를 각각 복제해서 플레이스홀더를 치환한다.
 *                 (예: 투입 감리원별 실적 및 경력, 비상근 감리원 참여 동의서, 재직증명서,
 *                 경력증명서 — buildMultiSlideDeck으로 인원 수만큼 복제)
 *   IMAGE_REPLACE NAS의 원본 PPT/PDF를 이미지로 추출해서 템플릿의 자리표시자 이미지를
 *                 그 이미지로 바꿔치기한다. (예: 표준재무제표, 사업자등록증, 국세/지방세
 *                 납세증명서, 법인등기부등본, 4대보험 가입확인서 — pptx-image-swap.ts)
 *   SHARED_TABLE  페이지(슬라이드) 자체는 한 장(또는 고정 몇 장)이지만, 그 안의 표를
 *                 인력 수에 맞게 행을 늘리거나 줄여 구성하고 플레이스홀더를 치환한다.
 *                 (예: 감리원 일정 현황표, 상근감리원인력현황 — pptx-table-rows.ts)
 *
 * 새 첨부 종류를 추가할 때 이 셋 중 어디에도 안 맞으면(예: 표지처럼 인력/이미지와 무관하게
 * 통째로 텍스트만 치환하는 경우) build_kind를 비워둬도 된다 — 필수 분류가 아니라, "생성
 * 로직이 셋 중 하나를 재사용할 수 있는지"를 나타내는 가벼운 태그다.
 */
export const ATTACHMENT_BUILD_KINDS = {
  PERSON_PAGES: {
    label: '인력별 페이지',
    description: '인력 수만큼 슬라이드를 복제해 각각 플레이스홀더를 치환합니다',
  },
  IMAGE_REPLACE: {
    label: '이미지 치환',
    description: 'NAS의 원본 PPT/PDF를 이미지로 추출해 템플릿의 자리표시자 이미지를 바꿔치기합니다',
  },
  SHARED_TABLE: {
    label: '공용 표',
    description: '표 형태의 한 페이지 안에서 인력별로 행 구성을 달리하며 플레이스홀더를 치환합니다',
  },
} as const

export type AttachmentBuildKind = keyof typeof ATTACHMENT_BUILD_KINDS

export function isAttachmentBuildKind(value: unknown): value is AttachmentBuildKind {
  return typeof value === 'string' && value in ATTACHMENT_BUILD_KINDS
}
