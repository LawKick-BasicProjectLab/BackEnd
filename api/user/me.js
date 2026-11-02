// api/user/me.js
// GET /api/user/me?user_id=... — 마이페이지 정보 (담당: 백엔드 A)
// 레벨·경험치·며칠차(접속한 날 수)·클리어한 스테이지·최근 풀이 기록
//
// ⚠️ 아직 서버 로그인이 없어서 user_id 만 알면 누구나 조회할 수 있다.
//    서버 인증을 붙이면 토큰에서 user_id 를 꺼내도록 바꿔야 한다.

import { store as defaultStore } from '../../lib/store.js';
import { ok, fail, rejectMethod, isGuest, validUserId } from '../../lib/http.js';
import { levelOf } from '../../lib/game.js';

const EMPTY = {
  exists: false, nickname: null, xp: 0, level: 1, coins: 30, total_solved: 0,
  custom_unlocked: false, days: 0, cleared: [], recent: []
};

export function createMeHandler(store) {
  return async function handler(req, res) {
    if (rejectMethod(req, res, ['GET'])) return;

    const userId = req.query?.user_id;
    if (!validUserId(userId)) return fail(res, 400, '필수 데이터(user_id)가 누락되었습니다.');
    if (isGuest(userId)) return ok(res, { ...EMPTY });

    try {
      const profile = await store.findProfile(userId.trim());
      if (!profile) return ok(res, { ...EMPTY });

      const [progress, days, cleared, recent] = await Promise.all([
        store.getProgress(profile.id),
        store.countVisits(profile.id),
        store.listClears(profile.id),
        store.recentLogs(profile.id, { limit: 10 })
      ]);

      return ok(res, {
        exists: true,
        nickname: profile.nickname,
        rank_public: profile.rank_public,
        joined_at: profile.created_at,
        xp: progress.xp,
        level: levelOf(progress.xp),
        coins: progress.coins,
        total_solved: progress.total_solved,
        custom_unlocked: progress.custom_unlocked,
        days,
        cleared,
        recent
      });
    } catch (err) {
      console.error('[me] 조회 실패:', err.message);
      return fail(res, 500, '서버 내부 오류가 발생했습니다.');
    }
  };
}

export default createMeHandler(defaultStore);
