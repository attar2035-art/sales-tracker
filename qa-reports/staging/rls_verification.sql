-- =============================================================================
-- RLS verification for sales-tracker (run on STAGING, after seed_test_data.sql)
-- =============================================================================
-- HOW THIS WORKS
-- The Supabase SQL editor runs as a privileged role that BYPASSES RLS. To test a
-- policy you must impersonate a specific end user: set the JWT claims (so
-- auth.uid() resolves to that user) and switch to the `authenticated` role (so
-- `to authenticated` policies apply). Each check below is wrapped in
-- begin; ... rollback; so the impersonation is temporary and nothing is written.
--
-- Run each block and compare the returned count/behavior to the EXPECTED comment.
-- Expected values assume a fresh run of seed_test_data.sql (no other data).
--
-- Helper pattern used in every block:
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select id from auth.users where email = '<email>')::text,
--                       'role', 'authenticated')::text, true);
--   set local role authenticated;
-- =============================================================================


-- ############################################################################
-- 1) daily_entries — SELECT scoping
--    Seed totals: rep1=2, rep2=1, rep3=1  => 4 rows total
-- ############################################################################

-- 1a. ADMIN sees ALL entries. EXPECT: 4
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin daily_entries' as check, count(*) as got, 4 as expected from daily_entries;
rollback;

-- 1b. DATA_ENTRY sees ALL entries. EXPECT: 4
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='data@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'data_entry daily_entries' as check, count(*) as got, 4 as expected from daily_entries;
rollback;

-- 1c. SUPERVISOR الرياض sees only their team (rep1+rep2). EXPECT: 3
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='supA@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'supA daily_entries' as check, count(*) as got, 3 as expected from daily_entries;
rollback;

-- 1d. SUPERVISOR جدة sees only their team (rep3). EXPECT: 1
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='supB@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'supB daily_entries' as check, count(*) as got, 1 as expected from daily_entries;
rollback;

-- 1e. REP1 sees only own entries. EXPECT: 2
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep1@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep1 daily_entries' as check, count(*) as got, 2 as expected from daily_entries;
rollback;

-- 1f. REP3 sees only own entries. EXPECT: 1
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep3@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep3 daily_entries' as check, count(*) as got, 1 as expected from daily_entries;
rollback;


-- ############################################################################
-- 2) daily_entries — WRITE permission
-- ############################################################################

-- 2a. REP1 INSERT must be DENIED (only admin/data_entry can insert).
--     EXPECT: ERROR "new row violates row-level security policy".
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep1@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  insert into daily_entries (rep_id, entry_date, year, month, daily_sales)
  values ((select id from representatives where name='مندوب اختبار 1'), current_date, extract(year from current_date)::int, extract(month from current_date)::int, 999);
rollback;

-- 2b. DATA_ENTRY INSERT must SUCCEED (rolled back). EXPECT: INSERT 0 1, no error.
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='data@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  insert into daily_entries (rep_id, entry_date, year, month, daily_sales)
  values ((select id from representatives where name='مندوب اختبار 2'), current_date, extract(year from current_date)::int, extract(month from current_date)::int, 111);
rollback;

-- 2c. REP1 DELETE must be DENIED (only admin can delete). EXPECT: 0 rows deleted.
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep1@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  with del as (delete from daily_entries where rep_id=(select id from representatives where name='مندوب اختبار 1') returning 1)
  select 'rep1 delete count' as check, count(*) as got, 0 as expected from del;
rollback;


-- ############################################################################
-- 3) monthly_targets — SELECT scoping (seed: rep1,rep2,rep3 => 3)
-- ############################################################################

-- 3a. ADMIN. EXPECT: 3
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin targets' as check, count(*) as got, 3 as expected from monthly_targets;
rollback;

-- 3b. SUPERVISOR الرياض (rep1+rep2). EXPECT: 2
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='supA@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'supA targets' as check, count(*) as got, 2 as expected from monthly_targets;
rollback;

-- 3c. REP1. EXPECT: 1
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep1@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep1 targets' as check, count(*) as got, 1 as expected from monthly_targets;
rollback;


-- ############################################################################
-- 4) customers — SELECT scoping (seed: 4 customers; 2 الرياض, 2 جدة)
-- ############################################################################

-- 4a. ADMIN. EXPECT: 4
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin customers' as check, count(*) as got, 4 as expected from customers;
rollback;

-- 4b. SUPERVISOR الرياض sees الرياض customers. EXPECT: 2
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='supA@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'supA customers' as check, count(*) as got, 2 as expected from customers;
rollback;

-- 4c. REP3 sees جدة customers (own region). EXPECT: 2
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep3@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep3 customers' as check, count(*) as got, 2 as expected from customers;
rollback;


-- ############################################################################
-- 5) customer_yearly_sales — SELECT scoping by region_name
--    Seed: الرياض rows=4 (C001x2, C002x2) ; جدة rows=3 (C003x2, C004x1)
-- ############################################################################

-- 5a. ADMIN. EXPECT: 7
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin yearly' as check, count(*) as got, 7 as expected from customer_yearly_sales;
rollback;

-- 5b. SUPERVISOR الرياض. EXPECT: 4
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='supA@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'supA yearly' as check, count(*) as got, 4 as expected from customer_yearly_sales;
rollback;

-- 5c. REP3 (جدة). EXPECT: 3
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep3@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep3 yearly' as check, count(*) as got, 3 as expected from customer_yearly_sales;
rollback;


-- ############################################################################
-- 6) user_roles — a user reads only their own row (unless admin)
-- ############################################################################

-- 6a. REP1 sees exactly their own role row. EXPECT: 1
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep1@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep1 user_roles' as check, count(*) as got, 1 as expected from user_roles;
rollback;

-- 6b. ADMIN sees all role rows (7 seeded: admin,data_entry,2 sup,2 rep). EXPECT: 6
--     (norole@staging.test has no row, by design.)
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin user_roles' as check, count(*) as got, 6 as expected from user_roles;
rollback;


-- ############################################################################
-- 7) customer_sales_totals RPC (BUG-020) — respects RLS via SECURITY INVOKER
-- ############################################################################

-- 7a. ADMIN, all regions => totals for all 4 customers with sales. EXPECT: 4 rows
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='admin@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'admin rpc rows' as check, count(*) as got, 4 as expected
  from customer_sales_totals(null);
rollback;

-- 7b. REP3 (جدة) => only جدة customers with sales (C003, C004). EXPECT: 2 rows
begin;
  select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='rep3@staging.test')::text,'role','authenticated')::text, true);
  set local role authenticated;
  select 'rep3 rpc rows' as check, count(*) as got, 2 as expected
  from customer_sales_totals(null);
rollback;


-- ############################################################################
-- 8) Policy audit — no leftover permissive "allow-all" policy
--    RLS combines PERMISSIVE policies with OR, so ONE stray "using (true)" policy
--    silently defeats all the scoped ones. The hardening migration drops the old
--    permissive policies by specific names (e.g. customer_yearly_sales' old policy
--    was named "Allow authenticated full access"). Confirm nothing permissive is
--    left behind on the sensitive tables.
-- ############################################################################

-- 8a. List all policies on the sensitive tables. Review by eye: every SELECT
--     policy must be role/region-scoped; there must be NO policy with a
--     qual of "true" (allow-all).
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('daily_entries','monthly_targets','customers',
                    'customer_product_sales','customer_yearly_sales',
                    'customer_yearly_history','user_roles','audit_logs')
order by tablename, cmd, policyname;

-- 8b. Hard check: any permissive policy whose qual is literally TRUE is a leak.
--     EXPECT: 0 rows.
select tablename, policyname, 'LEAK: allow-all policy' as problem
from pg_policies
where schemaname = 'public'
  and permissive = 'PERMISSIVE'
  and coalesce(btrim(qual), '') = 'true'
  and tablename in ('daily_entries','monthly_targets','customers',
                    'customer_product_sales','customer_yearly_sales',
                    'customer_yearly_history');


-- =============================================================================
-- PASS CRITERIA: every "got" equals its "expected"; 2a raises an RLS error and
-- 2c deletes 0 rows. Any mismatch is an RLS defect — do not release.
-- Note: exact counts for supervisor/rep customer visibility depend on your real
-- region/rep assignments; adjust expectations if you change the seed.
-- =============================================================================
