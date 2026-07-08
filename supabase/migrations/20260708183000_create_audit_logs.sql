create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text not null,
  user_role text,
  supervisor_id uuid,
  rep_id uuid,
  event_type text not null,
  page_key text,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_user_id_idx on public.audit_logs (user_id);
create index if not exists audit_logs_event_type_idx on public.audit_logs (event_type);
create index if not exists audit_logs_rep_id_idx on public.audit_logs (rep_id);

alter table public.audit_logs enable row level security;

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'admin'
  )
);

drop policy if exists "Users can insert own audit logs" on public.audit_logs;
create policy "Users can insert own audit logs"
on public.audit_logs
for insert
to authenticated
with check (auth.uid() = user_id);
