// api/ranking.js
// GET /api/ranking?limit=50 — 경험치 랭킹 (담당: 백엔드 A)
// 랭킹 공개에 동의한(rank_public) 사용자만 나온다. 이메일은 내보내지 않는다.

import { store as defaultStore } from '../lib/store.js';
import { ok, fail, rejectMethod } from '../lib/http.js';

export function createRankingHandler(store) {
  return async function handler(req, res) {
    if (rejectMethod(req, res, ['GET'])) return;

    const raw = Number(req.query?.limit ?? 50);
    const limit = Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 50;

    try {
      const rows = await store.ranking(limit);
      const rankings = rows.map((r, i) => ({
        rank: i + 1,
        nickname: r.nickname,
        xp: r.xp,
        level: r.level,
        cleared_count: r.cleared_count
      }));
      return ok(res, { rankings });
    } catch (err) {
      console.error('[ranking] 조회 실패:', err.message);
      return fail(res, 500, '서버 내부 오류가 발생했습니다.');
    }
  };
}

export default createRankingHandler(defaultStore);
