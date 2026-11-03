// api/user/reset.js
// POST /api/user/reset — 마이페이지 '진행 기록 초기화'
// body: { user_id }
// 클리어 기록·경험치·코인·풀이 수를 처음으로 되돌린다. (풀이 이력과 접속일은 유지)
//
// ⚠️ 아직 서버 로그인이 없어서 user_id 만 알면 누구나 초기화할 수 있다.
//    서버 인증을 붙이면 토큰에서 user_id 를 꺼내도록 바꿔야 한다.

import { store as defaultStore } from '../../lib/store.js';
import { ok, fail, rejectMethod, readBody, isGuest, validUserId } from '../../lib/http.js';

export function createResetHandler(store) {
  return async function handler(req, res) {
    if (rejectMethod(req, res, ['POST'])) return;

    let body;
    try {
      body = readBody(req);
    } catch {
      return fail(res, 400, '요청 본문이 올바른 JSON 형식이 아닙니다.');
    }

    const userId = body.user_id;
    if (!validUserId(userId)) return fail(res, 400, '필수 데이터(user_id)가 누락되었습니다.');
    if (isGuest(userId)) return ok(res, { reset: false }, '게스트는 서버에 기록이 없습니다.');

    try {
      const profile = await store.findProfile(userId.trim());
      // 서버에 기록이 없는 사용자는 지울 것도 없다
      if (!profile) return ok(res, { reset: true });

      await store.resetProgress(profile.id);
      console.log(`[reset] 진행 기록 초기화: user=${profile.id}`);
      return ok(res, { reset: true }, '진행 기록을 초기화했습니다.');
    } catch (err) {
      console.error('[reset] 초기화 실패:', err.message);
      return fail(res, 500, '서버 내부 오류가 발생했습니다.');
    }
  };
}

export default createResetHandler(defaultStore);
