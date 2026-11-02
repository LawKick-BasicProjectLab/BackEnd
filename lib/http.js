// lib/http.js
// 모든 API 가 같은 응답 형식을 쓰도록 모아 둔 도우미.
//   성공: { success: true, message?, data }
//   실패: { success: false, error: "메시지" }

export function ok(res, data, message) {
  const body = { success: true };
  if (message) body.message = message;
  body.data = data;
  return res.status(200).json(body);
}

export function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

/** 허용하지 않은 메서드면 405 를 보내고 true 를 돌려준다 */
export function rejectMethod(req, res, allowed) {
  if (allowed.includes(req.method)) return false;
  res.setHeader('Allow', allowed);
  fail(res, 405, `Method ${req.method} Not Allowed`);
  return true;
}

/** body 가 문자열로 들어오는 경우까지 처리 */
export function readBody(req) {
  const b = req.body;
  if (b == null || b === '') return {};
  if (typeof b === 'string') return JSON.parse(b);   // 깨진 JSON 이면 throw → 400 처리
  return b;
}

/** 프론트의 게스트 둘러보기 계정은 서버에 저장하지 않는다 */
export function isGuest(userId) {
  return userId === 'guest';
}

/** user_id 형식 검사: 문자열, 1~200자 */
export function validUserId(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
}
