-- =====================================================================
-- Law-Kick DB 스키마 v2 (Supabase / PostgreSQL)
-- 담당: 백엔드 A (데이터 영속화)
--
-- v1 과 달라진 점
--   지금 프론트는 로그인 계정을 브라우저(localStorage)에만 두고,
--   서버에는 user_id 로 "이메일" 을 보낸다. 그래서 사용자를 Supabase Auth 의
--   UUID 가 아니라 external_id(= 프론트가 보내는 user_id) 로 구분한다.
--   서버 로그인을 붙이면 auth_user_id 를 채우고 external_id 를 그 값으로 바꾸면 된다.
--
-- 근거: FrontEnd js/app.js 의 localStorage 구조
--   lk_accounts        {email: {nick, hash, created, rankOpt}}
--   lk_prog_<email>    {xp, coins, cleared:{sid:{grade,at}}, seen, badges, hist, visits}
--
-- 사용법: Supabase → SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전하다.
-- 접근: 서버리스 함수가 service_role(secret) 키로만 읽고 쓴다.
--       RLS 를 켜고 정책을 만들지 않았으므로 브라우저(anon 키)는 아무것도 못 본다.
-- =====================================================================


-- 1. profiles : 사용자 ------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique,          -- 프론트가 보내는 user_id (현재 이메일)
  auth_user_id  uuid unique,                   -- 서버 로그인 도입 시 auth.users.id 연결용 (지금은 비움)
  nickname      text not null default '이름 없음'
                check (char_length(nickname) between 1 and 20),
  rank_public   boolean not null default false, -- 프론트 rankOpt (랭킹 공개 동의)
  created_at    timestamptz not null default now()
);


-- 2. user_progress : 사용자별 누적 상태 -------------------------------
--    레벨은 저장하지 않고 xp 로 계산: lv = floor(xp/100) + 1
--    coins 는 아직 프론트가 관리(질문 구매·챕터 보너스) → 서버는 자리만 마련
create table if not exists public.user_progress (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  xp               integer not null default 0  check (xp >= 0),
  coins            integer not null default 30 check (coins >= 0),
  total_solved     integer not null default 0  check (total_solved >= 0), -- 제출 횟수
  custom_unlocked  boolean not null default false,                       -- 맞춤 문제 해금 여부
  updated_at       timestamptz not null default now()
);


-- 3. stage_clears : 스테이지 클리어 기록 (pg.cleared) ------------------
create table if not exists public.stage_clears (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  stage_id    text not null,                    -- 'j1-1', 'w2-1', 'u1-3', 'custom-...'
  grade       char(1) not null check (grade in ('S','A','B','C')),
  cleared_at  timestamptz not null default now(),
  primary key (user_id, stage_id)
);


-- 4. quiz_logs : 모든 제출 이력 (팀원 B 가 오답 분석에 사용) ----------
create table if not exists public.quiz_logs (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  stage_id        text not null,
  category        text not null check (category in ('jeonse','work','used','custom')),
  is_correct      boolean not null,
  selected_option smallint,      -- 고른 보기 index (0~3)
  tries_count     smallint,      -- 이번이 몇 번째 시도인지
  clues_found     smallint,      -- 찾은 단서 수
  questions_left  smallint,      -- 남은 질문 수
  created_at      timestamptz not null default now()
);
create index if not exists quiz_logs_user_time_idx
  on public.quiz_logs (user_id, created_at desc);


-- 5. visits : 접속(제출)한 날짜 → 마이페이지 "며칠차" -------------------
create table if not exists public.visits (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  visit_date  date not null default current_date,
  primary key (user_id, visit_date)
);


-- 뷰 ------------------------------------------------------------------

-- 랭킹: 공개 동의한 사용자만, 경험치 순 (이메일은 절대 포함하지 않는다)
create or replace view public.ranking as
select p.nickname,
       up.xp,
       floor(up.xp / 100)::int + 1                         as level,
       (select count(*)::int from public.stage_clears sc
         where sc.user_id = p.id)                          as cleared_count,
       up.updated_at
from public.profiles p
join public.user_progress up on up.user_id = p.id
where p.rank_public;

-- 카테고리별 오답률: 팀원 B 의 취약 카테고리 산출용 (맞춤 문제 제외)
create or replace view public.user_category_stats as
select user_id,
       category,
       count(*)::int                                 as attempts,
       (count(*) filter (where not is_correct))::int as wrong,
       round(avg(case when is_correct then 0 else 1 end)::numeric, 3) as wrong_rate
from public.quiz_logs
where category <> 'custom'
group by user_id, category;


-- 보안 ----------------------------------------------------------------
-- 모든 읽기/쓰기는 서버리스 함수(service_role)로만 한다.
alter table public.profiles      enable row level security;
alter table public.user_progress enable row level security;
alter table public.stage_clears  enable row level security;
alter table public.quiz_logs     enable row level security;
alter table public.visits        enable row level security;

revoke all on public.ranking             from anon, authenticated;
revoke all on public.user_category_stats from anon, authenticated;
