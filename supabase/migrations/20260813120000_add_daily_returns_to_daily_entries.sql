-- Track the day's returns (مردود) separately from sales. daily_sales stores the
-- NET (gross sales minus returns); daily_returns keeps the raw returns amount so
-- reports can show both. Existing rows default to 0 returns (net == old value).
alter table public.daily_entries
  add column if not exists daily_returns numeric not null default 0;
