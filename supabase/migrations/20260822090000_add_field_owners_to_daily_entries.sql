-- Per-field ownership for collaborative daily entry: maps each entry field key
-- to the user_id who first filled it, so a field locks for other data-entry
-- users (owner + admin can still edit).
alter table public.daily_entries
  add column if not exists field_owners jsonb not null default '{}'::jsonb;
