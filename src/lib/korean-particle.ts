/**
 * [ppt-portal 추가 기능] 한글 단어의 받침 유무에 따라 조사(은/는, 이/가, 을/를 등)를
 * 자동으로 고르는 공용 유틸. 원래 ppt-consent.ts에 "은/는"만 판정하는 pickEunNeun()으로
 * 있던 걸, 플레이스홀더 치환 값 소스/변환 일반화(2026-09-11)에서 어떤 조사 쌍이든 쓸 수
 * 있게 뽑아냈다 — 관리자가 페이지에서 "변환: 조사 자동 선택 (은/는)" 또는 "(이/가)" 등을
 * 고를 수 있게 하기 위함.
 *
 * 한글 음절(가~힣) 유니코드 공식: (코드 - 0xAC00) % 28 === 0 이면 받침 없음.
 */
export function hasBatchim(word: string): boolean {
  if (!word) return false
  const lastChar = word[word.length - 1]
  const code = lastChar.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return false // 한글 음절이 아니면 받침 없다고 취급(보수적 기본값)
  return code % 28 !== 0
}

/** pair = [받침 있을 때, 받침 없을 때] 순서 (예: ['은','는'], ['이','가'], ['을','를']). */
export function pickParticle(word: string, pair: [string, string]): string {
  return hasBatchim(word) ? pair[0] : pair[1]
}
