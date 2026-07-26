-- Fix: daily-entry saves failing since 2026-07-23.
--
-- `daily_entries.year` and `daily_entries.month` were GENERATED ALWAYS columns
-- (derived from entry_date). The deployed frontend sends explicit year/month in
-- its upsert payload, so every insert/update failed with:
--   "cannot insert a non-DEFAULT value into column \"year\" (generated column)"
-- and data entry was broken in production.
--
-- This migration converts year/month to regular columns kept authoritative by a
-- BEFORE INSERT/UPDATE trigger that derives them from entry_date. As a result:
--   * the currently-deployed frontend (sends year/month) saves successfully —
--     the trigger overwrites whatever the client sent with the correct value;
--   * the fixed frontend (omits year/month) also works;
--   * stored year/month remain always-correct, so no bad data can be introduced.
--
-- NOTE: this was already applied to the production project via the Supabase
-- MCP (apply_migration); this file records it in version control.

alter table public.daily_entries alter column year drop expression;
alter table public.daily_entries alter column month drop expression;

create or replace function public.daily_entries_set_year_month()
returns trigger
language plpgsql
as $$
begin
  new.year  := extract(year  from new.entry_date)::int;
  new.month := extract(month from new.entry_date)::int;
  return new;
end;
$$;

drop trigger if exists trg_daily_entries_year_month on public.daily_entries;
create trigger trg_daily_entries_year_month
  before insert or update on public.daily_entries
  for each row
  execute function public.daily_entries_set_year_month();
