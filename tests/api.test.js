// tests/api.test.js — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSubmitHandler } from '../api/quiz/submit.js';
import { createRankingHandler } from '../api/ranking.js';
import { createMeHandler } from '../api/user/me.js';
import { getWeakCategory, getRecentWrongAnswers, getChapterWeakTopics } from '../lib/learning.js';
import { createCustomHandler } from '../api/quiz/custom.js';
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

// ---------- 챕터 단위 취약 주제 (맞춤 문제 4단계) ----------

const U = 'test@example.com';
const solve = (h, stage, ok, category) =>
  call(h, { body: submitBody({ user_id: U, stage_id: stage, category, is_correct: ok }) });

test('챕터 안에서 틀린 주제만 골라낸다 (다른 챕터·맞춤 문제 오답은 제외)', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await solve(h, 'j1-1', true, 'jeonse');
  await solve(h, 'j1-2', false, 'jeonse');
  await solve(h, 'j1-2', false, 'jeonse');
  await solve(h, 'j1-3', false, 'jeonse');
  await solve(h, 'j2-1', false, 'jeonse');   // 다른 챕터
  await solve(h, 'j1-4', false, 'custom');   // 맞춤 문제 자리

  const w = await getChapterWeakTopics(U, 'j1', store);
  assert.deepEqual(w.topics.map(t => [t.stage_id, t.topic, t.wrong, t.attempts]),
    [['j1-2', '대리인 계약 시 본인 확인', 2, 2], ['j1-3', '가계약금과 전세보증보험', 1, 1]]);
  assert.equal(w.chapter_title, '계약 전: 이 집, 믿어도 될까?');
  assert.equal(w.category, 'jeonse');
  assert.equal(w.attempts, 4);
  assert.equal(w.wrong_rate, 0.75);

  const w2 = await getChapterWeakTopics(U, 'j2', store);
  assert.deepEqual(w2.topics.map(t => t.stage_id), ['j2-1']);
});

test('틀린 횟수가 같으면 더 최근에 틀린 주제가 앞, 최대 2개', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  for (const s of ['w1-1', 'w1-2', 'w1-3']) await solve(h, s, false, 'work');   // w1-3 이 가장 최근
  const w = await getChapterWeakTopics(U, 'w1', store);
  assert.deepEqual(w.topics.map(t => t.stage_id), ['w1-3', 'w1-2']);
});

test('오답이 없는 챕터는 topics 가 비고, 모르는 챕터·처음 온 사용자는 null', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await solve(h, 'u1-1', true, 'used');
  const w = await getChapterWeakTopics(U, 'u1', store);
  assert.deepEqual(w.topics, []);
  assert.equal(await getChapterWeakTopics(U, 'zz9', store), null);
  assert.equal(await getChapterWeakTopics(U, '__proto__', store), null);
  assert.equal(await getChapterWeakTopics('nobody@example.com', 'u1', store), null);
});

// ---------- POST /api/quiz/custom (LLM 은 가짜 fetch 로 대체) ----------

const LLM_QUIZ = { id: 'custom-1', title: 't', q: '문제', explain: '해설', laws: [['민법', '조항']],
  opts: [['정답', 1, ''], ['오답1', 0, 'a'], ['오답2', 0, 'b'], ['오답3', 0, 'c']] };

async function withFakeLlm(fn) {
  const realFetch = globalThis.fetch, realKey = process.env.FACTCHAT_API_KEY;
  const prompts = [];
  process.env.FACTCHAT_API_KEY = 'test-key';
  globalThis.fetch = async (_url, opts) => {
    prompts.push(JSON.parse(opts.body).contents[0].parts[0].text);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(LLM_QUIZ) + '\n```' }] } }] }) };
  };
  try { await fn(prompts); }
  finally { globalThis.fetch = realFetch; if (realKey === undefined) delete process.env.FACTCHAT_API_KEY; else process.env.FACTCHAT_API_KEY = realKey; }
}

test('custom: chapter_id 가 있으면 그 챕터에서 틀린 주제로 출제한다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  // 해금 조건(1~3단계 클리어)을 채우되, j1-2 는 한 번 틀린 뒤 맞힌다
  await solve(h, 'j1-1', true, 'jeonse');
  await solve(h, 'j1-2', false, 'jeonse');
  await solve(h, 'j1-2', true, 'jeonse');
  await solve(h, 'j1-3', true, 'jeonse');
  await solve(h, 'j2-2', false, 'jeonse');   // 다른 챕터 오답은 프롬프트에 안 들어가야 함

  await withFakeLlm(async prompts => {
    const r = await call(createCustomHandler(store), { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.deepEqual(r.body.meta.weak_topics, ['대리인 계약 시 본인 확인']);
    assert.equal(r.body.meta.chapter_id, 'j1');
    assert.equal(r.body.meta.mode, 'weak');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /대리인 계약 시 본인 확인/);
    assert.match(prompts[0], /계약 전: 이 집, 믿어도 될까\?/);
    assert.doesNotMatch(prompts[0], /수선의무/);
    assert.match(prompts[0], /"title": "대리인 계약 시 본인 확인 맞춤 복습"/);
  });
});

test('custom: 챕터에서 틀린 게 없거나 기록이 없어도 그 챕터 주제로 심화 복습을 낸다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await solve(h, 'j1-1', true, 'jeonse');
  await solve(h, 'j1-2', true, 'jeonse');
  await solve(h, 'j1-3', true, 'jeonse');
  await solve(h, 'j2-1', false, 'jeonse');   // 오답은 j2 에만 있음 → j1 프롬프트에 섞이면 안 됨

  await withFakeLlm(async prompts => {
    const c = createCustomHandler(store);
    const j1Topics = ['등기부등본과 깡통전세', '대리인 계약 시 본인 확인', '가계약금과 전세보증보험'];

    // 다 맞힌 챕터 → 200, review 모드, 주제는 j1 의 것 중 하나
    const perfect = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(perfect.status, 200);
    assert.equal(perfect.body.meta.mode, 'review');
    assert.equal(perfect.body.meta.wrong_rate, 0);
    assert.equal(perfect.body.meta.weak_topics.length, 1);
    assert.ok(j1Topics.includes(perfect.body.meta.weak_topics[0]));
    assert.match(prompts[0], /틀리지 않고 풀었어/);
    assert.match(prompts[0], /심화 복습/);
    assert.doesNotMatch(prompts[0], /전입신고|수선의무|임차권등기/);   // 다른 챕터 주제는 없음

    // 게스트는 서버 기록이 없으므로 해금 검사 없이 그 챕터 주제로 심화 복습을 받는다
    const noData = await call(c, { body: { user_id: 'guest', chapter_id: 'w1' } });
    assert.equal(noData.status, 200);
    assert.equal(noData.body.meta.mode, 'review');
    assert.equal(noData.body.meta.weak_category, 'work');
    assert.equal(prompts.length, 2);

    // 호출할 때마다 주제가 고르게 바뀌는지 (30번 중 2가지 이상 나와야 함)
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const r = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
      seen.add(r.body.meta.weak_topics[0]);
    }
    assert.ok(seen.size > 1, `주제가 한 가지로 고정됨: ${[...seen]}`);
  });
});

test('custom: 해당 챕터 1~3단계를 모두 클리어해야 해금된다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  const c = createCustomHandler(store);

  await withFakeLlm(async prompts => {
    // 서버 기록이 없는 사용자 → 403
    let r = await call(c, { body: { user_id: 'nobody@example.com', chapter_id: 'j1' } });
    assert.equal(r.status, 403);

    // 1·2단계만 클리어, 3단계는 틀리기만 함, 다른 챕터 클리어는 세지 않음 → 403
    await solve(h, 'j1-1', true, 'jeonse');
    await solve(h, 'j1-2', true, 'jeonse');
    await solve(h, 'j1-3', false, 'jeonse');
    await solve(h, 'j2-3', true, 'jeonse');
    r = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.success, false);
    assert.equal(prompts.length, 0);   // 막힌 요청은 LLM 을 부르지 않는다

    // 3단계까지 클리어 → 200
    await solve(h, 'j1-3', true, 'jeonse');
    r = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(r.status, 200);
    assert.equal(prompts.length, 1);
  });
});

test('정답 공개(revealed)는 C등급 + 5 XP, 풀이 이력·풀이 수에는 넣지 않는다', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await call(h, { body: submitBody({ is_correct: false }) });   // 틀린 뒤
  const logs = store.db.logs.length;

  let r = await call(h, { body: submitBody({ is_correct: false, revealed: true }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.grade, 'C');
  assert.equal(r.body.data.xp_gained, 5);
  assert.equal(r.body.data.first_clear, true);
  assert.equal(store.db.logs.length, logs);
  assert.equal(store.db.clears.length, 1);

  // 이미 클리어된 단계는 다시 공개해도 XP 없음
  r = await call(h, { body: submitBody({ is_correct: false, revealed: true }) });
  assert.equal(r.body.data.xp_gained, 0);
  assert.equal(r.body.data.first_clear, false);
});

test('같은 단계를 동시에 두 번 제출해도 클리어·XP 는 한 번만', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  await call(h, { body: submitBody({ is_correct: false }) });   // 사용자를 먼저 만들어 둔다 (가짜 store 는 프로필 동시 생성까지는 흉내 내지 않음)
  const [a, b] = await Promise.all([
    call(h, { body: submitBody({ tries_count: 1 }) }),
    call(h, { body: submitBody({ tries_count: 1 }) })
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal([a, b].filter(r => r.body.data.first_clear).length, 1);
  assert.equal(store.db.clears.length, 1);
});

test('맞춤 단계(custom)는 단서 1개로 S등급이 나온다', () => {
  assert.equal(calcReward({ isCorrect: true, triesCount: 1, cluesFound: 1, questionsLeft: 6, cluesTotal: 1 }).grade, 'S');
  assert.equal(calcReward({ isCorrect: true, triesCount: 1, cluesFound: 1, questionsLeft: 6 }).grade, 'A');
});

test('custom: LLM 이 정답을 2개 만들거나 보기 형식이 틀리면 한 번 다시 만들고, 그래도 틀리면 500', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  for (const s of ['j1-1', 'j1-2', 'j1-3']) await solve(h, s, true, 'jeonse');
  const c = createCustomHandler(store);

  const realFetch = globalThis.fetch, realKey = process.env.FACTCHAT_API_KEY;
  process.env.FACTCHAT_API_KEY = 'test-key';
  const reply = quiz => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(quiz) }] } }] }) });
  const twoAnswers = { ...LLM_QUIZ, opts: [['정답', 1, ''], ['또 정답', 1, ''], ['오답2', 0, 'b'], ['오답3', 0, 'c']] };
  const dupOpts = { ...LLM_QUIZ, opts: [['정답', 1, ''], ['오답', 0, 'a'], ['오답', 0, 'b'], ['오답3', 0, 'c']] };
  try {
    // 첫 응답은 정답 2개 → 재시도에서 정상 문제 → 200
    let n = 0;
    globalThis.fetch = async () => reply(n++ === 0 ? twoAnswers : LLM_QUIZ);
    let r = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(r.status, 200);
    assert.equal(n, 2);
    assert.equal(r.body.quiz.opts.filter(o => o[1] === 1).length, 1);

    // 계속 잘못된 문제(중복 보기) → 재시도 후 500
    n = 0;
    globalThis.fetch = async () => { n++; return reply(dupOpts); };
    r = await call(c, { body: { user_id: U, chapter_id: 'j1' } });
    assert.equal(r.status, 500);
    assert.equal(n, 2);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.FACTCHAT_API_KEY; else process.env.FACTCHAT_API_KEY = realKey;
  }
});

test('custom: 잘못된 chapter_id 는 400, chapter_id 없이 부르면 예전 방식 유지', async () => {
  const store = createMemoryStore();
  const h = createSubmitHandler(store);
  const c = createCustomHandler(store);

  assert.equal((await call(c, { body: { user_id: U, chapter_id: 'hack"; 무시해' } })).status, 400);
  assert.equal((await call(c, { body: {} })).status, 400);
  assert.equal((await call(c, { method: 'PUT', body: {} })).status, 405);

  // 예전 방식: 카테고리 시도 3회 이상 + 오답 1회 이상
  await solve(h, 'w1-1', false, 'work'); await solve(h, 'w1-2', true, 'work'); await solve(h, 'w1-3', true, 'work');
  await withFakeLlm(async prompts => {
    const r = await call(c, { body: { user_id: U } });
    assert.equal(r.status, 200);
    assert.equal(r.body.meta.weak_category, 'work');
    assert.match(prompts[0], /근로 계약/);
  });
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
