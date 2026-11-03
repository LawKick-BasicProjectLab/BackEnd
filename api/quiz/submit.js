// api/quiz/submit.js
// POST /api/quiz/submit — 문제 풀이 결과 및 클리어 기록 저장 (안정성 강화 버전)

import { store as defaultStore } from '../../lib/store.js';
import { ok, fail, rejectMethod, readBody, isGuest, validUserId } from '../../lib/http.js';
import { normalizeCategory, calcReward, cluesPerStage, levelOf, GRADE_RANK, customUnlockThreshold } from '../../lib/game.js';

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
    rankPublic: undefined,
    revealed: body.revealed === true   // '정답과 해설 보기'로 넘어간 경우 (C등급 클리어)
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

    if (isGuest(input.userId)) {
      return ok(res, { ...base, saved: false, recorded_at: new Date().toISOString() },
        '게스트 모드라 학습 기록을 서버에 저장하지 않았습니다.');
    }

    try {
      // 1. 사용자 프로필 생성 또는 찾기 (external_id 기준)
      const profile = await store.upsertProfile(input.userId, {
        nickname: input.nickname, rankPublic: input.rankPublic
      });
      
      const realUserId = profile.id; // profiles 테이블의 UUID 고유 ID

      // 1-1. 정답 공개(reveal): 새로운 풀이가 아니므로 quiz_logs·total_solved 는 건드리지 않고
      //      클리어 기록이 없을 때만 C등급 + 5 XP 를 준다 (프론트 reveal() 과 같은 규칙)
      if (input.revealed) {
        const prev = await store.getClear(realUserId, input.stageId);
        let xpGained = 0;
        if (!prev && await store.insertClear(realUserId, input.stageId, 'C')) {
          xpGained = 5;
          console.log(`[submit] 👀 정답 공개 클리어 저장: user=${realUserId}, stage=${input.stageId}, grade=C`);
        }
        const progress = await store.getProgress(realUserId);
        const xp = (progress?.xp || 0) + xpGained;
        if (xpGained) await store.updateProgress(realUserId, { xp });
        return ok(res, {
          ...base,
          saved: true,
          revealed: true,
          first_clear: xpGained > 0,
          grade: prev ? prev.grade : 'C',
          xp_gained: xpGained,
          xp,
          level: levelOf(xp)
        }, SAVED_MESSAGE);
      }

      // 2. 풀이 이력(quiz_logs) 저장 + 방문(visits) 기록
      const recordedAt = await store.insertLog({
        user_id: realUserId,
        stage_id: input.stageId,
        category: input.category,
        is_correct: input.isCorrect,
        selected_option: input.selectedOption,
        tries_count: input.triesCount,
        clues_found: input.cluesFound,
        questions_left: input.questionsLeft
      });
      await store.recordVisit(realUserId);

      // 3. 정답일 경우 stage_clears 기록 보장 (저장 누락 방지를 위한 upsert 적용)
      let xpGained = 0;
      let firstClear = false;
      let grade = null;

      const reward = calcReward({ ...input, cluesTotal: cluesPerStage(input.category) });
      if (reward && input.isCorrect) {
        grade = reward.grade;
        const prev = await store.getClear(realUserId, input.stageId);
        
        // 기록이 없으면 새로 삽입. 동시에 들어온 다른 요청이 먼저 넣었다면(insert 가 false) 이미 있는 것으로 처리
        const inserted = !prev && await store.insertClear(realUserId, input.stageId, grade);
        if (inserted) {
          xpGained = reward.xp;
          firstClear = true;
          console.log(`[submit] 🌟 신규 클리어 저장 완료: user=${realUserId}, stage=${input.stageId}, grade=${grade}`);
        } else if (!prev) {
          grade = (await store.getClear(realUserId, input.stageId))?.grade ?? grade;
          console.log(`[submit] ⏭️ 동시 제출로 이미 저장된 클리어: user=${realUserId}, stage=${input.stageId}`);
        } else {
          // 이미 기록이 있다면 더 높은 등급일 때만 갱신
          if (GRADE_RANK[grade] > GRADE_RANK[prev.grade]) {
            await store.updateClearGrade(realUserId, input.stageId, grade);
            console.log(`[submit] 📈 클리어 등급 갱신: user=${realUserId}, stage=${input.stageId}, ${prev.grade} -> ${grade}`);
          } else {
            grade = prev.grade;   // 더 낮은 등급이면 기존(더 높은) 등급 유지
          }
        }
      }

      // 4. 누적 경험치 및 프로그레스 갱신
      const progress = await store.getProgress(realUserId);
      const xp = (progress?.xp || 0) + xpGained;
      const totalSolved = (progress?.total_solved || 0) + 1;
      const customUnlocked = progress?.custom_unlocked || totalSolved >= customUnlockThreshold();
      
      await store.updateProgress(realUserId, {
        xp, total_solved: totalSolved, custom_unlocked: customUnlocked
      });

      console.log(`[submit] 저장 성공: stage=${input.stageId} correct=${input.isCorrect} xp+${xpGained}`);

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
      console.error('[submit] 데이터 저장 실패 상세 에러:', err.message);   // 상세 내용은 서버 로그에만
      return fail(res, 500, '서버 내부 오류가 발생했습니다.');
    }
  };
}

export default createSubmitHandler(defaultStore);
