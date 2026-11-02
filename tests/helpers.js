// tests/helpers.js
// DB 없이 API 로직을 검사하기 위한 가짜 store 와 가짜 req/res

import { randomUUID } from 'node:crypto';

export function createMemoryStore() {
  const db = { profiles: [], progress: new Map(), clears: [], logs: [], visits: new Set() };

  return {
    db,
    async findProfile(externalId) {
      return db.profiles.find(p => p.external_id === externalId) || null;
    },
    async upsertProfile(externalId, { nickname, rankPublic } = {}) {
      let p = await this.findProfile(externalId);
      if (!p) {
        p = { id: randomUUID(), external_id: externalId, nickname: nickname ?? '이름 없음',
              rank_public: rankPublic ?? false, created_at: new Date().toISOString() };
        db.profiles.push(p);
      } else {
        if (nickname !== undefined) p.nickname = nickname;
        if (rankPublic !== undefined) p.rank_public = rankPublic;
      }
      if (!db.progress.has(p.id)) {
        db.progress.set(p.id, { xp: 0, coins: 30, total_solved: 0, custom_unlocked: false, updated_at: new Date().toISOString() });
      }
      return p;
    },
    async getProgress(userId) { return { ...db.progress.get(userId) }; },
    async updateProgress(userId, patch) {
      Object.assign(db.progress.get(userId), patch, { updated_at: new Date().toISOString() });
    },
    async insertLog(row) {
      const created_at = new Date(Date.now() + db.logs.length).toISOString();
      db.logs.push({ ...row, created_at });
      return created_at;
    },
    async recordVisit(userId) { db.visits.add(userId + '|' + new Date().toISOString().slice(0, 10)); },
    async getClear(userId, stageId) {
      return db.clears.find(c => c.user_id === userId && c.stage_id === stageId) || null;
    },
    async insertClear(user_id, stage_id, grade) {
      db.clears.push({ user_id, stage_id, grade, cleared_at: new Date().toISOString() });
    },
    async updateClearGrade(userId, stageId, grade) {
      (await this.getClear(userId, stageId)).grade = grade;
    },
    async listClears(userId) {
      return db.clears.filter(c => c.user_id === userId).map(({ stage_id, grade, cleared_at }) => ({ stage_id, grade, cleared_at }));
    },
    async countVisits(userId) { return [...db.visits].filter(v => v.startsWith(userId + '|')).length; },
    async recentLogs(userId, { limit = 10, onlyWrong = false } = {}) {
      return db.logs.filter(l => l.user_id === userId && (!onlyWrong || !l.is_correct))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
        .map(({ stage_id, category, is_correct, selected_option, tries_count, created_at }) =>
          ({ stage_id, category, is_correct, selected_option, tries_count, created_at }));
    },
    async categoryStats(userId) {
      const by = {};
      for (const l of db.logs.filter(l => l.user_id === userId && l.category !== 'custom')) {
        by[l.category] ??= { category: l.category, attempts: 0, wrong: 0 };
        by[l.category].attempts++;
        if (!l.is_correct) by[l.category].wrong++;
      }
      return Object.values(by).map(s => ({ ...s, wrong_rate: (s.wrong / s.attempts).toFixed(3) }));
    },
    async ranking(limit) {
      return db.profiles.filter(p => p.rank_public)
        .map(p => ({ nickname: p.nickname, xp: db.progress.get(p.id).xp,
                     level: Math.floor(db.progress.get(p.id).xp / 100) + 1,
                     cleared_count: db.clears.filter(c => c.user_id === p.id).length }))
        .sort((a, b) => b.xp - a.xp).slice(0, limit);
    }
  };
}

/** handler(req, res) 를 호출하고 { status, body } 를 돌려준다 */
export async function call(handler, { method = 'POST', body, query = {} } = {}) {
  const out = { status: 200, headers: {}, body: undefined };
  const res = {
    status(code) { out.status = code; return this; },
    json(obj) { out.body = obj; return this; },
    setHeader(k, v) { out.headers[k] = v; }
  };
  await handler({ method, body, query }, res);
  return out;
}

/** 프론트가 보내는 모양의 기본 요청 */
export const submitBody = (over = {}) => ({
  user_id: 'test@example.com', stage_id: 'j1-1', category: 'jeonse',
  is_correct: true, tries_count: 1, ...over
});
