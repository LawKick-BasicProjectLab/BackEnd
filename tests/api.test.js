// tests/api.test.js — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSubmitHandler } from '../api/quiz/submit.js';
import { createRankingHandler } from '../api/ranking.js';
import { createMeHandler } from '../api/user/me.js';
import { getWeakCategory, getRecentWrongAnswers } from '../lib/learning.js';
import { calcReward, normalizeCategory } from '../lib/game.js';
import { createMemoryStore, call, submitBody } from './helpers.js';

// ---------- 게임 규칙 (프론트 pick() 과 같은 결과인지) ----------

test('경험치·등급 공식이 프론트와 같다', () => {
  assert.deepEqual(calcReward({ isCorrect: true, triesCount: 1, cluesFound: 2, questionsLeft: 6 }), { grade: 'S', xp: 30 + 10 + 6 });
  assert.deepEqual(calcReward({ isCorrect: true, triesCount: 1, cluesFound: 1, questionsLeft: 8 }), { grade: 'A', xp: 30 + 5 + 8 });
  assert.deepEqual(calcReward({ isCorrect: true, triesCount: 2, cluesFound: 2, questionsLeft: 3 }), { grade: 'B', xp: 15 + 10 + 3 });
  assert.equal(calcReward({ isCorrect: false, triesCount: 1 }), null);
  // 조작 방지: 단서 수·남은 질문 수 상한
  assert.equal(calcReward({ isCorrect: true, triesCount: 1, cluesFound: 99, questionsLeft: 999 }).xp, 30 + 10 + 30);
});

test('카테고리: 코스 id·한글 이름·stage_id 로 모두 인식', () => {
  assert.equal(normalizeCategory('work'), 'work');
  assert.equal(normalizeCategory('전세 계약'), 'jeonse');
  assert.equal(normalizeCategory(undefined, 'u2-1'), 'used');
  assert.equal(normalizeCategory(undefined, 'custom-123'), 'custom');
  assert.equal(normalizeCategory('기타'), null);
});

// ---------- POST /api/quiz/submit ----------

test('지금 프론트가 보내는 요청 그대로 저장된다', async () => {
  const store = createMemoryStore();
  const r = await call(createSubmitHandler(store), { body: submitBody() });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.message, '정오답 데이터가 안전하게 저장되었습니다.');
  // 기존 응답 필드 유지
  for (const k of ['user_id', 'stage_id', 'is_correct', 'recorded_at']) assert.ok(k in r.body.data, k);
  assert.equal(r.body.data.saved, true);
  assert.equal(r.body.data.first_clear, true);
  assert.equal(store.db.logs.length, 1);
  assert.equal(store.db.clears.length, 1);
});

test('경험치는 처음 클리어할 때만, 재도전은 등급만 올라간다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);

  await call(h, { body: submitBody({ is_correct: false, tries_count: 1 }) });
  let r = await call(h, { body: submitBody({ tries_count: 2, clues_found: 2, questions_left: 3 }) });
  assert.equal(r.body.data.grade, 'B');
  assert.equal(r.body.data.xp_gained, 28);
  assert.equal(r.body.data.xp, 28);

  r = await call(h, { body: submitBody({ tries_count: 1, clues_found: 2, questions_left: 7 }) });
  assert.equal(r.body.data.grade, 'S');        // 등급은 올라감
  assert.equal(r.body.data.xp_gained, 0);      // 경험치는 그대로
  assert.equal(r.body.data.xp, 28);
  assert.equal(r.body.data.total_solved, 3);
  assert.equal(store.db.logs.length, 3);       // 이력은 전부 남음
});

test('10번 풀면 맞춤 문제가 해금된다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  let r;
  for (let i = 1; i <= 10; i++) {
    r = await call(h, { body: submitBody({ stage_id: `j1-${(i % 4) + 1}`, is_correct: i % 2 === 0 }) });
    assert.equal(r.body.data.custom_unlocked, i >= 10, `${i}번째`);
  }
});

test('게스트는 저장하지 않는다', async () => {
  const store = createMemoryStore();
  const r = await call(createSubmitHandler(store), { body: submitBody({ user_id: 'guest' }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.saved, false);
  assert.equal(store.db.logs.length, 0);
});

test('잘못된 요청은 400, 다른 메서드는 405', async () => {
  const h = createSubmitHandler(createMemoryStore());
  assert.equal((await call(h, { body: { stage_id: 'j1-1', is_correct: true } })).status, 400);
  assert.equal((await call(h, { body: submitBody({ is_correct: 'yes' }) })).status, 400);
  assert.equal((await call(h, { body: submitBody({ category: '기타' }) })).status, 400);
  assert.equal((await call(h, { body: submitBody({ tries_count: -1 }) })).status, 400);
  assert.equal((await call(h, { body: submitBody({ stage_id: "j1-1'; drop table" }) })).status, 400);
  assert.equal((await call(h, { body: '{깨진 json' })).status, 400);
  const r = await call(h, { method: 'GET' });
  assert.equal(r.status, 405);
  assert.deepEqual(r.body, { success: false, error: 'Method GET Not Allowed' });
});

test('DB 오류는 500 으로 감싸고 내부 메시지를 노출하지 않는다', async () => {
  const store = createMemoryStore();
  store.insertLog = async () => { throw new Error('[DB] connection refused'); };
  const r = await call(createSubmitHandler(store), { body: submitBody() });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, '서버 내부 오류가 발생했습니다.');
});

// ---------- 팀원 B 용 함수 ----------

test('취약 카테고리와 최근 오답', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await call(h, { body: submitBody({ stage_id: 'j1-1', is_correct: true }) });
  await call(h, { body: submitBody({ stage_id: 'w1-1', category: 'work', is_correct: false, selected_option: 2 }) });
  await call(h, { body: submitBody({ stage_id: 'w1-2', category: 'work', is_correct: false, selected_option: 0 }) });

  const weak = await getWeakCategory('test@example.com', store);
  assert.deepEqual(weak, { category: 'work', label: '근로 계약', wrong_rate: 1, attempts: 2 });

  const wrongs = await getRecentWrongAnswers('test@example.com', 5, store);
  assert.deepEqual(wrongs.map(w => w.stage_id), ['w1-2', 'w1-1']);
  assert.equal(await getWeakCategory('nobody@example.com', store), null);
});

// ---------- GET /api/ranking, GET /api/user/me ----------

test('랭킹은 공개 동의자만, 이메일 없이 경험치 순', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await call(h, { body: submitBody({ user_id: 'a@x.com', nickname: '에이', rank_public: true }) });
  await call(h, { body: submitBody({ user_id: 'b@x.com', nickname: '비', rank_public: true, clues_found: 2, questions_left: 9 }) });
  await call(h, { body: submitBody({ user_id: 'c@x.com', nickname: '비공개', rank_public: false, clues_found: 2, questions_left: 9 }) });

  const r = await call(createRankingHandler(store), { method: 'GET' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.rankings.map(x => [x.rank, x.nickname]), [[1, '비'], [2, '에이']]);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

test('마이페이지', async () => {
  const store = createMemoryStore();
  await call(createSubmitHandler(store), { body: submitBody({ nickname: '테스터', clues_found: 2, questions_left: 10 }) });
  const me = createMeHandler(store);

  const r = await call(me, { method: 'GET', query: { user_id: 'test@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.nickname, '테스터');
  assert.equal(r.body.data.xp, 50);
  assert.equal(r.body.data.days, 1);
  assert.deepEqual(r.body.data.cleared.map(c => [c.stage_id, c.grade]), [['j1-1', 'S']]);

  assert.equal((await call(me, { method: 'GET', query: { user_id: 'new@x.com' } })).body.data.exists, false);
  assert.equal((await call(me, { method: 'GET', query: {} })).status, 400);
});
