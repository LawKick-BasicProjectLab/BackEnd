// api/quiz/submit.js
// POST /api/quiz/submit — 문제 풀이 결과 저장 (담당: 백엔드 A)
//
// 하는 일
//   1) 입력 검증
//   2) 사용자(profiles) 찾기/만들기
//   3) 풀이 이력(quiz_logs) 저장 + 오늘 방문(visits) 기록
//   4) 정답이면 등급·경험치를 서버에서 계산해 stage_clears / user_progress 갱신
//   5) 풀이 수가 기준(기본 10)을 넘으면 맞춤 문제 해금
//
// 응답 형식은 기존 명세를 유지하고, 새 값은 data 안에만 추가했다.

import { store as defaultStore } from '../../lib/store.js';
import { ok, fail, rejectMethod, readBody, isGuest, validUserId } from '../../lib/http.js';
import { normalizeCategory, calcReward, levelOf, GRADE_RANK, customUnlockThreshold } from '../../lib/game.js';

const SAVED_MESSAGE = '정오답 데이터가 안전하게 저장되었습니다.';

/** 선택 입력: 없으면 null, 있으면 min~max 정수인지 검사 */
function optionalInt(body, name, min, max, errors) {
  const v = body[name];
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v < min || v > max) {
    errors.push(`${name}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
    return null;
  }
  return v;
}

/** 요청 body 를 검사해서 { input } 또는 { error } 를 돌려준다 */
export function validateSubmit(body) {
  const { user_id, stage_id, is_correct, category, nickname, rank_public } = body;

  if (!validUserId(user_id) || typeof stage_id !== 'string' || stage_id === '') {
    return { error: '필수 데이터(user_id 또는 stage_id)가 누락되었습니다.' };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(stage_id)) {
    return { error: 'stage_id 형식이 올바르지 않습니다.' };
  }
  if (typeof is_correct !== 'boolean') {
    return { error: 'is_correct 는 true 또는 false 여야 합니다.' };
  }
  const cat = normalizeCategory(category, stage_id);
  if (!cat) {
    return { error: 'category 는 jeonse, work, used, custom 중 하나여야 합니다.' };
  }

  const errors = [];
  const input = {
    userId: user_id.trim(),
    stageId: stage_id,
    category: cat,
    isCorrect: is_correct,
    triesCount: optionalInt(body, 'tries_count', 1, 50, errors),
    selectedOption: optionalInt(body, 'selected_option', 0, 9, errors),
    cluesFound: optionalInt(body, 'clues_found', 0, 10, errors),
    questionsLeft: optionalInt(body, 'questions_left', 0, 100, errors),
    nickname: undefined,
    rankPublic: undefined
  };

  if (nickname !== undefined && nickname !== null) {
    if (typeof nickname !== 'string' || nickname.trim().length < 1 || nickname.trim().length > 20) {
      errors.push('nickname 은 1~20자 문자열이어야 합니다.');
    } else {
      input.nickname = nickname.trim();
    }
  }
  if (rank_public !== undefined && rank_public !== null) {
    if (typeof rank_public !== 'boolean') errors.push('rank_public 은 true 또는 false 여야 합니다.');
    else input.rankPublic = rank_public;
  }

  if (errors.length) return { error: errors.join(' ') };
  return { input };
}

/** 테스트에서 가짜 store 를 넣을 수 있도록 만든 생성 함수 */
export function createSubmitHandler(store) {
  return async function handler(req, res) {
    if (rejectMethod(req, res, ['POST'])) return;

    let body;
    try {
      body = readBody(req);
    } catch {
      return fail(res, 400, '요청 본문이 올바른 JSON 형식이 아닙니다.');
    }

    const { input, error } = validateSubmit(body);
    if (error) return fail(res, 400, error);

    const base = { user_id: input.userId, stage_id: input.stageId, is_correct: input.isCorrect };

    // 게스트 둘러보기는 저장하지 않는다 (랭킹·통계 오염 방지)
    if (isGuest(input.userId)) {
      return ok(res, { ...base, saved: false, recorded_at: new Date().toISOString() },
        '게스트 모드라 학습 기록을 서버에 저장하지 않았습니다.');
    }

    try {
      // 1. 사용자
      const profile = await store.upsertProfile(input.userId, {
        nickname: input.nickname, rankPublic: input.rankPublic
      });

      // 2. 풀이 이력 + 방문
      const recordedAt = await store.insertLog({
        user_id: profile.id,
        stage_id: input.stageId,
        category: input.category,
        is_correct: input.isCorrect,
        selected_option: input.selectedOption,
        tries_count: input.triesCount,
        clues_found: input.cluesFound,
        questions_left: input.questionsLeft
      });
      await store.recordVisit(profile.id);

      // 3. 보상 (처음 클리어할 때만 경험치, 다시 풀면 등급만 올라감 — 프론트와 동일)
      const reward = calcReward(input);
      let xpGained = 0;
      let firstClear = false;
      let grade = null;

      if (reward) {
        const prev = await store.getClear(profile.id, input.stageId);
        if (!prev) {
          await store.insertClear(profile.id, input.stageId, reward.grade);
          xpGained = reward.xp;
          firstClear = true;
          grade = reward.grade;
        } else if (GRADE_RANK[reward.grade] > GRADE_RANK[prev.grade]) {
          await store.updateClearGrade(profile.id, input.stageId, reward.grade);
          grade = reward.grade;
        } else {
          grade = prev.grade;
        }
      }

      // 4. 누적 상태
      const progress = await store.getProgress(profile.id);
      const xp = progress.xp + xpGained;
      const totalSolved = progress.total_solved + 1;
      const customUnlocked = progress.custom_unlocked || totalSolved >= customUnlockThreshold();
      await store.updateProgress(profile.id, {
        xp, total_solved: totalSolved, custom_unlocked: customUnlocked
      });

      console.log(`[submit] stage=${input.stageId} correct=${input.isCorrect} xp+${xpGained}`);

      return ok(res, {
        ...base,
        recorded_at: recordedAt,
        saved: true,
        category: input.category,
        first_clear: firstClear,
        grade,
        xp_gained: xpGained,
        xp,
        level: levelOf(xp),
        total_solved: totalSolved,
        custom_unlocked: customUnlocked
      }, SAVED_MESSAGE);

    } catch (err) {
      console.error('[submit] 저장 실패:', err.message);
      return fail(res, 500, '서버 내부 오류가 발생했습니다.');
    }
  };
}

export default createSubmitHandler(defaultStore);
