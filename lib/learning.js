// lib/learning.js
// 팀원 B(맞춤 문제 생성)가 쓰는 학습 이력 조회 함수 (담당: 백엔드 A)
//
// 사용 예 (api/quiz/custom.js 안에서)
//   import { getWeakCategory, getRecentWrongAnswers } from '../../lib/learning.js';
//
//   const weak = await getWeakCategory(user_id);
//   // → { category: 'jeonse', label: '전세 계약', wrong_rate: 0.6, attempts: 5 } 또는 null
//   const wrongs = await getRecentWrongAnswers(user_id, 5);
//   // → [{ stage_id: 'j1-2', category: 'jeonse', selected_option: 1, tries_count: 1, created_at: '...' }, ...]
//
// user_id 는 프론트가 보내는 값(현재 이메일) 그대로 넘기면 된다.
// 기록이 없는 사용자(처음 온 사람, 게스트)는 null / [] 를 돌려준다.

import { store as defaultStore } from './store.js';
import { CATEGORY_LABELS, CHAPTER_TITLES, STAGE_TOPICS, isChapterId, chapterOf, categoryOfChapter } from './game.js';

/**
 * 오답률이 가장 높은 카테고리. 맞춤 문제(custom)는 제외.
 * 동률이면 틀린 횟수가 많은 쪽, 그것도 같으면 시도가 많은 쪽.
 * 한 번도 안 틀렸으면 null.
 */
export async function getWeakCategory(userId, store = defaultStore) {
  const profile = await store.findProfile(userId);
  if (!profile) return null;

  const stats = await store.categoryStats(profile.id);
  const candidates = stats
    .filter(s => s.wrong > 0)
    .sort((a, b) =>
      Number(b.wrong_rate) - Number(a.wrong_rate) || b.wrong - a.wrong || b.attempts - a.attempts);

  if (!candidates.length) return null;
  const top = candidates[0];
  return {
    category: top.category,
    label: CATEGORY_LABELS[top.category],
    wrong_rate: Number(top.wrong_rate),
    attempts: top.attempts
  };
}

/** 최근 오답 목록 (최신순) */
export async function getRecentWrongAnswers(userId, limit = 10, store = defaultStore) {
  const profile = await store.findProfile(userId);
  if (!profile) return [];
  const rows = await store.recentLogs(profile.id, { limit, onlyWrong: true });
  return rows.map(({ is_correct, ...rest }) => rest);
}

const MAX_FOCUS_TOPICS = 2;     // 맞춤 문제에 넘길 취약 주제 수
const CHAPTER_LOG_LIMIT = 500;  // 챕터 안의 풀이 이력을 훑을 최대 개수 (최신순)

/**
 * 한 챕터 안에서 틀린 주제(스테이지)를 골라낸다. 맞춤 문제(custom)와 다른 챕터는 제외.
 * 틀린 횟수가 많은 순, 같으면 더 최근에 틀린 쪽이 앞에 온다.
 *
 *   → { chapter_id, chapter_title, category, label, wrong_rate, attempts,
 *       topics: [{ stage_id, topic, wrong, attempts }] }   (topics 는 최대 2개, 틀린 게 없으면 [])
 *   → null : 모르는 챕터이거나 기록이 없는 사용자(처음 온 사람, 게스트)
 */
export async function getChapterWeakTopics(userId, chapterId, store = defaultStore) {
  if (!isChapterId(chapterId)) return null;
  const profile = await store.findProfile(userId);
  if (!profile) return null;

  const logs = await store.recentLogs(profile.id, { limit: CHAPTER_LOG_LIMIT });   // 최신순
  const byStage = new Map();
  let attempts = 0, wrong = 0;

  logs.forEach((log, idx) => {
    if (log.category === 'custom') return;
    if (!STAGE_TOPICS[log.stage_id] || chapterOf(log.stage_id) !== chapterId) return;

    const s = byStage.get(log.stage_id)
      ?? { stage_id: log.stage_id, topic: STAGE_TOPICS[log.stage_id], wrong: 0, attempts: 0, lastWrong: Infinity };
    byStage.set(log.stage_id, s);
    s.attempts++; attempts++;
    if (!log.is_correct) { s.wrong++; wrong++; s.lastWrong = Math.min(s.lastWrong, idx); }
  });

  const topics = [...byStage.values()]
    .filter(s => s.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.lastWrong - b.lastWrong)
    .slice(0, MAX_FOCUS_TOPICS)
    .map(({ stage_id, topic, wrong, attempts }) => ({ stage_id, topic, wrong, attempts }));

  const category = categoryOfChapter(chapterId);
  return {
    chapter_id: chapterId,
    chapter_title: CHAPTER_TITLES[chapterId],
    category,
    label: CATEGORY_LABELS[category],
    wrong_rate: attempts ? wrong / attempts : 0,
    attempts,
    topics
  };
}
