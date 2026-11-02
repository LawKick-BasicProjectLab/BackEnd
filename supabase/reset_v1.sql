-- =====================================================================
-- v1 스키마 정리용 (한 번만 실행)
-- 처음 만든 v1 테이블은 Supabase Auth 계정이 있어야만 데이터를 넣을 수 있는 구조라
-- v2 로 바꾸기 전에 지운다. ⚠️ 테이블 안의 데이터도 함께 지워진다.
-- (아직 테스트 데이터밖에 없을 때만 실행할 것)
--
-- 순서: 이 파일 Run → schema.sql Run
-- =====================================================================
drop view  if exists public.ranking;
drop view  if exists public.user_category_stats;
drop table if exists public.quiz_logs     cascade;
drop table if exists public.stage_clears  cascade;
drop table if exists public.visits        cascade;
drop table if exists public.user_progress cascade;
drop table if exists public.profiles      cascade;
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
