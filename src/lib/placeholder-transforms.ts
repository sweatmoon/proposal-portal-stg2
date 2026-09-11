/**
 * [ppt-portal 추가 기능] 플레이스홀더 치환 값 소스/변환 일반화(2026-09-11 사용자 확인 —
 * "값 소스마다 db/엑셀/ppt 선택 가능하게" + "코드 로직을 페이지에서 입력"은 서버 코드를
 * 그대로 실행(eval)하는 셈이라 보안상 배제하고, 대신 미리 정의해둔 안전한 변환 함수를
 * 체인으로 골라 붙이는 방식으로 하기로 함)에서 쓰는 내장 변환 함수 목록.
 *
 * 관리자는 페이지에서 이 목록 중에서만 골라 파라미터를 채운다 — 임의 코드 실행 경로가
 * 아니므로, "관리자 계정이 뚫리면 서버가 뚫린다" 같은 위험이 없다. 새 변환 종류가
 * 필요해지면 여기 함수 하나를 추가하는 정도의 코드 변경만 필요하다.
 *
 * 기존 3개 항목(비상근 감리원 참여 동의서/재직증명서/경력증명서)에 흩어져 있던 날짜 변환/
 * 조사 선택 로직(ppt-consent.ts의 formatBirthdate·formatDeadlineMinusOneDay,
 * xlsx-employee-lookup.ts의 formatBirthdate·formatDateKorean 등)과 동일한 결과를 내도록
 * 맞췄다 — 새 항목을 이 시스템으로 만들어도 기존과 같은 서식이 나온다.
 */
import { pickParticle } from './korean-particle.js'

export type TransformType = 'dateFormat' | 'dayOffset' | 'particle' | 'prefix' | 'suffix' | 'lookup'

export interface TransformSpec {
  type: TransformType
  params: Record<string, unknown>
}

export interface TransformContext {
  /** 이 값이 채워지는 슬라이드의 인물 이름 — particle 변환이 값 자체가 아니라 이름의
   *  받침을 기준으로 조사를 골라야 할 때 쓴다(예: "[이름]은" 자리는 값 자체가 이름이라
   *  문제 없지만, 다른 필드 뒤에 "~는" 식으로 붙이고 싶을 때를 위해 별도로 넘겨둔다). */
  personName: string
}

const DATE_FORMATS = ['YYMMDD_RRN', 'YYMMDD_CMP', 'YYYYMMDD', 'YYYY-MM-DD', 'YYYY.MM.DD'] as const
type DateInputFormat = (typeof DATE_FORMATS)[number]

function parseDateInput(raw: string, format: DateInputFormat): { y: number; m: number; d: number } | null {
  switch (format) {
    case 'YYMMDD_RRN': {
      // 주민번호 앞 6자리 규칙 — 첫 자리가 "0"이면 2000년대, 아니면 1900년대
      // (xlsx-employee-lookup.ts의 formatBirthdate와 동일).
      if (!/^\d{6}$/.test(raw)) return null
      const century = raw[0] === '0' ? 2000 : 1900
      return { y: century + Number(raw.slice(0, 2)), m: Number(raw.slice(2, 4)), d: Number(raw.slice(4, 6)) }
    }
    case 'YYMMDD_CMP': {
      // personnel.birthdate 규칙 — 현재 연도의 뒤 두 자리와 비교해 세기 추정
      // (ppt-consent.ts의 formatBirthdate와 동일).
      if (!/^\d{6}$/.test(raw)) return null
      const yy = Number(raw.slice(0, 2))
      const currentYY = new Date().getFullYear() % 100
      const century = yy > currentYY ? 1900 : 2000
      return { y: century + yy, m: Number(raw.slice(2, 4)), d: Number(raw.slice(4, 6)) }
    }
    case 'YYYYMMDD': {
      const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
      return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
    }
    case 'YYYY-MM-DD': {
      const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
      return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
    }
    case 'YYYY.MM.DD': {
      const m = raw.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/)
      return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
    }
  }
}

const DATE_OUTPUT_FORMATS = ['YYYY.MM.DD.', 'YYYY.MM.DD', 'YYYY-MM-DD', 'YYYY년 MM월 DD일', 'YYYY년 M월 D일'] as const
type DateOutputFormat = (typeof DATE_OUTPUT_FORMATS)[number]

function formatDateOutput(d: { y: number; m: number; d: number }, format: DateOutputFormat): string {
  const mm = String(d.m).padStart(2, '0')
  const dd = String(d.d).padStart(2, '0')
  switch (format) {
    case 'YYYY.MM.DD.': return `${d.y}.${mm}.${dd}.`
    case 'YYYY.MM.DD': return `${d.y}.${mm}.${dd}`
    case 'YYYY-MM-DD': return `${d.y}-${mm}-${dd}`
    case 'YYYY년 MM월 DD일': return `${d.y}년 ${mm}월 ${dd}일`
    case 'YYYY년 M월 D일': return `${d.y}년 ${d.m}월 ${d.d}일`
  }
}

/** dateFormat: params.inputFormat/outputFormat — 위 두 목록 중에서만 허용(자유 포맷 문자열
 *  파싱이 아니라 고정 목록에서 고르는 방식이라 안전하다). 파싱 실패 시 원본 값을 그대로 둔다. */
function applyDateFormat(value: string, params: Record<string, unknown>): string {
  const inputFormat = params.inputFormat as DateInputFormat
  const outputFormat = params.outputFormat as DateOutputFormat
  if (!DATE_FORMATS.includes(inputFormat) || !DATE_OUTPUT_FORMATS.includes(outputFormat)) return value
  const parsed = parseDateInput(value, inputFormat)
  if (!parsed) return value
  return formatDateOutput(parsed, outputFormat)
}

/** dayOffset: params.days(정수, 음수 가능) — "YYYY-MM-DD" 형식 값에 날짜를 더하고 다시
 *  "YYYY-MM-DD"로 반환한다(뒤에 dateFormat을 체인으로 붙여 한글 포맷으로 바꿀 수 있다).
 *  서버 타임존과 무관하도록 UTC 기준으로만 계산한다(ppt-consent.ts의
 *  formatDeadlineMinusOneDay와 동일한 이유 — 로컬 타임존이 UTC인 서버에서 문자열을 그대로
 *  "+09:00"으로 파싱하면 날짜가 하루 밀린다). */
function applyDayOffset(value: string, params: Record<string, unknown>): string {
  const days = Number(params.days)
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m || !Number.isFinite(days)) return value
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** particle: params.pair = [받침 있을 때 글자, 받침 없을 때 글자] (예: ['은','는']).
 *  값 자체(주로 이름)의 받침에 따라 조사를 골라 값 뒤에 붙인다. */
function applyParticle(value: string, params: Record<string, unknown>): string {
  const pair = params.pair as [string, string]
  if (!Array.isArray(pair) || pair.length !== 2) return value
  return `${value}${pickParticle(value, pair)}`
}

function applyPrefix(value: string, params: Record<string, unknown>): string {
  return `${params.text ?? ''}${value}`
}

function applySuffix(value: string, params: Record<string, unknown>): string {
  return `${value}${params.text ?? ''}`
}

/** lookup: params.pairs = [{from, to}, ...], params.default?(매치 안 될 때, 없으면 원본 값 유지) */
function applyLookup(value: string, params: Record<string, unknown>): string {
  const pairs = params.pairs as { from: string; to: string }[]
  if (!Array.isArray(pairs)) return value
  const hit = pairs.find(p => p.from === value)
  if (hit) return hit.to
  return typeof params.default === 'string' ? params.default : value
}

const TRANSFORM_FNS: Record<TransformType, (value: string, params: Record<string, unknown>, ctx: TransformContext) => string> = {
  dateFormat: (v, p) => applyDateFormat(v, p),
  dayOffset: (v, p) => applyDayOffset(v, p),
  particle: (v, p) => applyParticle(v, p),
  prefix: (v, p) => applyPrefix(v, p),
  suffix: (v, p) => applySuffix(v, p),
  lookup: (v, p) => applyLookup(v, p),
}

/** 변환 체인을 순서대로 적용한다. 알 수 없는 type은 조용히 건너뛴다(관리자 UI가 항상
 *  TRANSFORM_FNS에 있는 type만 저장하게 만들어서, 여기서 걸리는 건 데이터 손상 정도라
 *  전체 생성을 막기보다 그 변환만 무시하고 계속 진행하는 편이 안전하다). */
export function applyTransformChain(rawValue: string, chain: TransformSpec[] | undefined, ctx: TransformContext): string {
  if (!chain || !chain.length) return rawValue
  let value = rawValue
  for (const step of chain) {
    const fn = TRANSFORM_FNS[step.type]
    if (fn) value = fn(value, step.params ?? {}, ctx)
  }
  return value
}

export const TRANSFORM_TYPE_LABELS: Record<TransformType, string> = {
  dateFormat: '날짜 포맷 변환',
  dayOffset: '날짜 ± N일',
  particle: '조사 자동 선택(은/는, 이/가 등)',
  prefix: '앞에 문자 붙이기',
  suffix: '뒤에 문자 붙이기',
  lookup: '값 매핑(A→B)',
}
