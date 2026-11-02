// lib/store.js
// DB 읽기/쓰기를 한곳에 모았다. API 파일은 이 함수들만 부른다.
// (테스트에서는 이 객체를 가짜로 바꿔 끼워서 DB 없이 API 로직을 검사한다)

import { getSupabase } from './supabase.js';

/** Supabase 응답에서 에러면 throw, 아니면 data 반환 */
function must({ data, error }) {
  if (error) throw new Error(`[DB] ${error.message}`);
  return data;
}

/** 한국 시간 기준 오늘 날짜 'YYYY-MM-DD' */
export function todayKST(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const PROFILE_COLS = 'id, nickname, rank_public, created_at';

export const store = {
  /** external_id(프론트 user_id)로 사용자 찾기. 없으면 null */
  async findProfile(externalId) {
    const db = getSupabase();
    return must(await db.from('profiles').select(PROFILE_COLS)
      .eq('external_id', externalId).maybeSingle());
  },

  /**
   * 사용자 찾기, 없으면 만들기. nickname / rankPublic 이 오면 갱신.
   * user_progress 행도 함께 보장한다.
   */
  async upsertProfile(externalId, { nickname, rankPublic } = {}) {
    const db = getSupabase();
    let profile = await this.findProfile(externalId);

    if (!profile) {
      const row = { external_id: externalId };
      if (nickname !== undefined) row.nickname = nickname;
      if (rankPublic !== undefined) row.rank_public = rankPublic;
      const res = await db.from('profiles').insert(row).select(PROFILE_COLS).single();
      // 동시에 두 요청이 같은 사용자를 만들려 한 경우(unique 위반) → 다시 조회
      profile = res.error?.code === '23505' ? await this.findProfile(externalId) : must(res);
    } else {
      const patch = {};
      if (nickname !== undefined && nickname !== profile.nickname) patch.nickname = nickname;
      if (rankPublic !== undefined && rankPublic !== profile.rank_public) patch.rank_public = rankPublic;
      if (Object.keys(patch).length) {
        profile = must(await db.from('profiles').update(patch).eq('id', profile.id)
          .select(PROFILE_COLS).single());
      }
    }

    must(await db.from('user_progress')
      .upsert({ user_id: profile.id }, { onConflict: 'user_id', ignoreDuplicates: true }));
    return profile;
  },

  async getProgress(userId) {
    const db = getSupabase();
    return must(await db.from('user_progress')
      .select('xp, coins, total_solved, custom_unlocked, updated_at')
      .eq('user_id', userId).single());
  },

  async updateProgress(userId, patch) {
    const db = getSupabase();
    must(await db.from('user_progress')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId));
  },

  /** 풀이 이력 1건 저장, 저장된 시각 반환 */
  async insertLog(row) {
    const db = getSupabase();
    const data = must(await db.from('quiz_logs').insert(row).select('created_at').single());
    return data.created_at;
  },

  async recordVisit(userId, date = todayKST()) {
    const db = getSupabase();
    must(await db.from('visits')
      .upsert({ user_id: userId, visit_date: date },
              { onConflict: 'user_id,visit_date', ignoreDuplicates: true }));
  },

  async getClear(userId, stageId) {
    const db = getSupabase();
    return must(await db.from('stage_clears').select('grade, cleared_at')
      .eq('user_id', userId).eq('stage_id', stageId).maybeSingle());
  },

  async insertClear(userId, stageId, grade) {
    const db = getSupabase();
    must(await db.from('stage_clears').insert({ user_id: userId, stage_id: stageId, grade }));
  },

  async updateClearGrade(userId, stageId, grade) {
    const db = getSupabase();
    must(await db.from('stage_clears').update({ grade })
      .eq('user_id', userId).eq('stage_id', stageId));
  },

  // ----- 조회용 (마이페이지 / 랭킹 / 팀원 B) -----

  async listClears(userId) {
    const db = getSupabase();
    return must(await db.from('stage_clears').select('stage_id, grade, cleared_at')
      .eq('user_id', userId).order('cleared_at', { ascending: true }));
  },

  async countVisits(userId) {
    const db = getSupabase();
    const { count, error } = await db.from('visits')
      .select('visit_date', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) throw new Error(`[DB] ${error.message}`);
    return count ?? 0;
  },

  async recentLogs(userId, { limit = 10, onlyWrong = false } = {}) {
    const db = getSupabase();
    let q = db.from('quiz_logs')
      .select('stage_id, category, is_correct, selected_option, tries_count, created_at')
      .eq('user_id', userId);
    if (onlyWrong) q = q.eq('is_correct', false);
    return must(await q.order('created_at', { ascending: false }).limit(limit));
  },

  async categoryStats(userId) {
    const db = getSupabase();
    return must(await db.from('user_category_stats')
      .select('category, attempts, wrong, wrong_rate').eq('user_id', userId));
  },

  async ranking(limit = 50) {
    const db = getSupabase();
    return must(await db.from('ranking')
      .select('nickname, xp, level, cleared_count')
      .order('xp', { ascending: false })
      .order('updated_at', { ascending: true })   // 동점이면 먼저 도달한 사람이 위
      .limit(limit));
  }
};
