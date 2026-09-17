-- Debt aging buckets entered per rep per day, alongside the existing overdue
-- fields. debt_total is the rep's total outstanding debt; the rest are the
-- amounts aged into each bucket (entered, not derived, since buckets may overlap).
alter table public.daily_entries
  add column if not exists debt_total    numeric not null default 0,
  add column if not exists debt_1_45     numeric not null default 0,
  add column if not exists debt_over_60  numeric not null default 0,
  add column if not exists debt_over_90  numeric not null default 0,
  add column if not exists debt_over_120 numeric not null default 0,
  add column if not exists debt_over_150 numeric not null default 0;
