-- Report automation hardening (Phase 1): send-log + atomic reservation,
-- shared rate budget, and a kill switch. Additive only — no existing table or
-- code path references these objects until the senders are migrated, so this
-- migration is safe to apply ahead of the sender rollout.

-- 1) Send log: one row per (report unit, recipient), keyed by a stable
--    idempotency key. Two independent dimensions: processing vs delivery.
create table if not exists public.report_send_log (
  idempotency_key   text primary key,                    -- NOT NULL by PK; no composite-with-NULLs trap
  report_type       text not null,
  report_id         text not null,
  period            text not null,
  version           text not null,
  recipient         text not null,
  processing_status text not null default 'reserved'
    check (processing_status in ('pending','reserved','accepted','failed_temporary','failed_permanent','in_doubt','skipped')),
  delivery_status   text not null default 'unknown'
    check (delivery_status in ('unknown','delivered','bounced','complained')),
  attempts          integer not null default 0,
  lease_token       uuid,
  reserved_until    timestamptz,
  provider_message_id text,
  batch_id          text,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists report_send_log_type_period_idx on public.report_send_log (report_type, period);
create index if not exists report_send_log_processing_idx on public.report_send_log (processing_status);
create index if not exists report_send_log_recipient_idx on public.report_send_log (recipient);

-- 2) Kill switch: scope = 'global' | '<report_type>' | 'recipient:<email>'.
create table if not exists public.automation_settings (
  scope      text primary key,
  disabled   boolean not null default false,
  note       text,
  updated_at timestamptz not null default now()
);
insert into public.automation_settings (scope, disabled, note)
values ('global', false, 'Master switch for automated report sending')
on conflict (scope) do nothing;

-- 3) Shared rate budget (single window row); serialized via SELECT ... FOR UPDATE.
create table if not exists public.send_rate_budget (
  id           integer primary key default 1,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
insert into public.send_rate_budget (id, window_start, count)
values (1, now(), 0) on conflict (id) do nothing;

-- 4) Atomic claim: INSERT-or-takeover. Returns 'claimed' + a fresh lease, or 'skip'.
create or replace function public.reserve_report_send(
  p_key text, p_type text, p_id text, p_period text, p_version text,
  p_recipient text, p_lease_ms integer
) returns table(outcome text, lease uuid)
language plpgsql as $$
declare
  r public.report_send_log%rowtype;
  v_lease uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_until timestamptz := now() + make_interval(secs => p_lease_ms / 1000.0);
begin
  insert into public.report_send_log
    (idempotency_key, report_type, report_id, period, version, recipient,
     processing_status, reserved_until, lease_token, attempts)
  values
    (p_key, p_type, p_id, p_period, p_version, lower(btrim(p_recipient)),
     'reserved', v_until, v_lease, 0)
  on conflict (idempotency_key) do nothing;

  if found then
    outcome := 'claimed'; lease := v_lease; return next; return;
  end if;

  select * into r from public.report_send_log where idempotency_key = p_key for update;
  if r.processing_status in ('accepted','skipped','failed_permanent','in_doubt') then
    outcome := 'skip'; lease := null; return next; return;
  end if;
  if r.processing_status = 'reserved' and r.reserved_until > v_now then
    outcome := 'skip'; lease := null; return next; return;
  end if;

  -- expired reservation OR failed_temporary -> take over with a NEW lease
  update public.report_send_log
     set processing_status = 'reserved', reserved_until = v_until,
         lease_token = v_lease, updated_at = v_now
   where idempotency_key = p_key;
  outcome := 'claimed'; lease := v_lease; return next;
end; $$;

-- 5) CAS result write: only the current lease owner may record an outcome.
create or replace function public.record_report_send(
  p_key text, p_lease uuid, p_status text, p_provider text,
  p_attempts integer, p_error text, p_batch_id text default null
) returns boolean
language plpgsql as $$
declare n integer;
begin
  update public.report_send_log
     set processing_status = p_status,
         provider_message_id = coalesce(p_provider, provider_message_id),
         batch_id = coalesce(p_batch_id, batch_id),
         attempts = p_attempts,
         error = p_error,
         lease_token = case when p_status = 'reserved' then lease_token else null end,
         updated_at = now()
   where idempotency_key = p_key and lease_token = p_lease;
  get diagnostics n = row_count;
  return n > 0;
end; $$;

-- 6) Atomic token acquire for the shared team budget. Returns ms to wait (0 = got a token).
create or replace function public.acquire_send_token(p_budget integer, p_window_ms integer)
returns integer language plpgsql as $$
declare w public.send_rate_budget%rowtype; v_now timestamptz := clock_timestamp(); wait_ms integer;
begin
  select * into w from public.send_rate_budget where id = 1 for update;
  if w is null then
    insert into public.send_rate_budget(id, window_start, count) values (1, v_now, 1);
    return 0;
  end if;
  if v_now - w.window_start >= make_interval(secs => p_window_ms / 1000.0) then
    update public.send_rate_budget set window_start = v_now, count = 1 where id = 1; return 0;
  end if;
  if w.count < p_budget then
    update public.send_rate_budget set count = count + 1 where id = 1; return 0;
  end if;
  wait_ms := ceil(extract(epoch from ((w.window_start + make_interval(secs => p_window_ms/1000.0)) - v_now)) * 1000);
  return greatest(wait_ms, 1);
end; $$;

-- 7) Lock down. Backend uses the service role (bypasses RLS). Enable RLS so
--    anon/authenticated cannot read/write, with a read-only window for admins.
alter table public.report_send_log enable row level security;
alter table public.automation_settings enable row level security;
alter table public.send_rate_budget enable row level security;

drop policy if exists report_send_log_admin_read on public.report_send_log;
create policy report_send_log_admin_read on public.report_send_log
  for select to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists automation_settings_admin_read on public.automation_settings;
create policy automation_settings_admin_read on public.automation_settings
  for select to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists automation_settings_admin_write on public.automation_settings;
create policy automation_settings_admin_write on public.automation_settings
  for update to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- Functions are backend-only.
revoke execute on function public.reserve_report_send(text,text,text,text,text,text,integer) from public;
revoke execute on function public.record_report_send(text,uuid,text,text,integer,text,text) from public;
revoke execute on function public.acquire_send_token(integer,integer) from public;
grant execute on function public.reserve_report_send(text,text,text,text,text,text,integer) to service_role;
grant execute on function public.record_report_send(text,uuid,text,text,integer,text,text) to service_role;
grant execute on function public.acquire_send_token(integer,integer) to service_role;
