// lib/game.js
// 게임 규칙(카테고리, 등급, 경험치, 레벨). DB 와 무관한 순수 함수만 둔다.
// 경험치 공식은 FrontEnd js/app.js 의 pick() 을 그대로 옮겼다.
// 공식을 바꾸면 프론트와 이 파일을 함께 바꿔야 한다.

// ----- 카테고리 -----
// 프론트는 코스 id(jeonse/work/used, 맞춤 문제는 custom)를 보낸다.
// Docs 명세 예시처럼 한글 이름이 와도 받아준다.
export const CATEGORIES = ['jeonse', 'work', 'used', 'custom'];

export const CATEGORY_LABELS = {
  jeonse: '전세 계약',
  work: '근로 계약',
  used: '중고 거래',
  custom: 'AI 맞춤 코스'
};

const CATEGORY_ALIASES = {
  '전세 계약': 'jeonse', '전세계약': 'jeonse', '전세': 'jeonse',
  '근로 계약': 'work', '근로계약': 'work', '알바·근로 계약': 'work', '근로': 'work',
  '중고 거래': 'used', '중고거래': 'used',
  'AI 맞춤 코스': 'custom'
};

// stage_id 첫 글자로 코스 추측 (category 가 비어 있을 때)
const STAGE_PREFIX = { j: 'jeonse', w: 'work', u: 'used' };

/** 카테고리 값을 jeonse/work/used/custom 중 하나로 바꾼다. 알 수 없으면 null */
export function normalizeCategory(category, stageId = '') {
  if (typeof category === 'string' && category.trim() !== '') {
    const v = category.trim();
    if (CATEGORIES.includes(v)) return v;
    return CATEGORY_ALIASES[v] || null;
  }
  if (stageId.startsWith('custom')) return 'custom';
  return STAGE_PREFIX[stageId[0]] || null;
}

// ----- 등급 / 경험치 -----
export const GRADE_RANK = { S: 4, A: 3, B: 2, C: 1 };
export const CLUES_PER_STAGE = 2;   // 현재 모든 스테이지의 단서 수
const MAX_QUESTIONS_LEFT = 30;      // 조작 방지용 상한 (기본 10 + 코인 구매·재도전 추가분)

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * 정답일 때 등급과 경험치를 계산한다. 오답이면 null.
 * 프론트 pick() 과 같은 공식:
 *   등급  S: 한 번에 + 단서 전부 + 남은 질문 5개 이상 / A: 한 번에 / B: 재도전
 *   XP  = (한 번에 30, 아니면 15) + 단서 수 × 5 + 남은 질문 수
 */
export function calcReward({ isCorrect, triesCount, cluesFound, questionsLeft }) {
  if (!isCorrect) return null;
  const firstTry = (triesCount ?? 1) === 1;
  const nf = clamp(cluesFound ?? 0, 0, CLUES_PER_STAGE);
  const left = clamp(questionsLeft ?? 0, 0, MAX_QUESTIONS_LEFT);

  const grade = firstTry && nf === CLUES_PER_STAGE && left >= 5 ? 'S'
              : firstTry ? 'A'
              : 'B';
  const xp = (firstTry ? 30 : 15) + nf * 5 + left;
  return { grade, xp };
}

/** 프론트 level() 과 같은 계산 */
export function levelOf(xp) {
  return Math.floor(xp / 100) + 1;
}

// ----- 맞춤 문제 해금 -----
export function customUnlockThreshold() {
  const n = Number(process.env.CUSTOM_UNLOCK_THRESHOLD);
  return Number.isInteger(n) && n > 0 ? n : 10;
}
