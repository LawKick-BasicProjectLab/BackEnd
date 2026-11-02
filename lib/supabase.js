// lib/supabase.js
// 서버 전용 Supabase 클라이언트. service_role(secret) 키를 쓰므로 절대 프론트로 보내지 않는다.
//
// 필요한 환경변수 (.env.local / Vercel Environment Variables)
//   SUPABASE_URL               예: https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API Keys 의 secret 키

import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.');
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}
