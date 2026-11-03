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

// ----- 챕터 / 스테이지 주제 (맞춤 문제 출제용) -----
// 프론트 js/data.js 의 챕터·스테이지 구성과 같아야 한다. 스테이지를 추가·삭제·이동하면 이 표도 함께 고친다.
// 각 챕터의 4번째 단계(j1-4 등)는 AI 맞춤 문제 자리라서 여기에 넣지 않는다.
export const CHAPTER_TITLES = {
  j1: '계약 전: 이 집, 믿어도 될까?',
  j2: '계약 후: 이사부터 만기까지',
  w1: '첫 직장: 인턴인데 계약서가 없어요',
  w2: '알바의 세계: 편의점 편',
  u1: '구매자 편: 반값 아이패드',
  u2: '판매자·피해 대응 편'
};

export const STAGE_TOPICS = {
  'j1-1': '등기부등본과 깡통전세',
  'j1-2': '대리인 계약 시 본인 확인',
  'j1-3': '가계약금과 전세보증보험',
  'j2-1': '전입신고·확정일자와 대항력',
  'j2-2': '임대인의 수선의무와 수리비',
  'j2-3': '보증금 미반환 시 임차권등기',
  'w1-1': '근로자성과 근로계약서 교부',
  'w1-2': '연장근로와 가산수당',
  'w1-3': '임금명세서와 급여 공제',
  'w2-1': '주휴수당 요건',
  'w2-2': '수습 기간 최저임금 감액',
  'w2-3': '퇴직금과 임금 지급 기한',
  'u1-1': '시세 대비 지나치게 싼 매물',
  'u1-2': '안전결제를 가장한 피싱 링크',
  'u1-3': '계좌 명의 확인과 결제 재촉',
  'u2-1': '가짜 입금 캡처 사기',
  'u2-2': '개인 간 거래 하자담보책임',
  'u2-3': '중고거래 사기 피해 대응'
};

export const isChapterId = id => typeof id === 'string' && Object.hasOwn(CHAPTER_TITLES, id);

/** 'j1-2' → 'j1'. 형식이 다르면 null */
export function chapterOf(stageId) {
  const m = /^([a-z]+\d+)-\d+$/.exec(String(stageId));
  return m ? m[1] : null;
}

/** 챕터에 속한 스테이지 주제들 [{ stage_id, topic }] */
export function topicsOfChapter(chapterId) {
  return Object.entries(STAGE_TOPICS)
    .filter(([stageId]) => chapterOf(stageId) === chapterId)
    .map(([stage_id, topic]) => ({ stage_id, topic }));
}

/** 챕터 id → 코스 카테고리 ('j1' → 'jeonse') */
export function categoryOfChapter(chapterId) {
  return STAGE_PREFIX[String(chapterId)[0]] || null;
}

// ----- 등급 / 경험치 -----
export const GRADE_RANK = { S: 4, A: 3, B: 2, C: 1 };
export const CLUES_PER_STAGE = 2;   // 일반 스테이지의 단서 수
export const CUSTOM_CLUES = 1;      // AI 맞춤 단계의 단서 수 (프론트 loadCustomQuiz 가 1개만 만든다)

/** 카테고리별 단서 수 */
export function cluesPerStage(category) {
  return category === 'custom' ? CUSTOM_CLUES : CLUES_PER_STAGE;
}
const MAX_QUESTIONS_LEFT = 30;      // 조작 방지용 상한 (기본 10 + 코인 구매·재도전 추가분)

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * 정답일 때 등급과 경험치를 계산한다. 오답이면 null.
 * 프론트 pick() 과 같은 공식:
 *   등급  S: 한 번에 + 단서 전부 + 남은 질문 5개 이상 / A: 한 번에 / B: 재도전
 *   XP  = (한 번에 30, 아니면 15) + 단서 수 × 5 + 남은 질문 수
 */
export function calcReward({ isCorrect, triesCount, cluesFound, questionsLeft, cluesTotal = CLUES_PER_STAGE }) {
  if (!isCorrect) return null;
  const firstTry = (triesCount ?? 1) === 1;
  const nf = clamp(cluesFound ?? 0, 0, cluesTotal);
  const left = clamp(questionsLeft ?? 0, 0, MAX_QUESTIONS_LEFT);

  const grade = firstTry && nf === cluesTotal && left >= 5 ? 'S'
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
