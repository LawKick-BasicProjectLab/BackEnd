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
import { CATEGORY_LABELS } from './game.js';

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
