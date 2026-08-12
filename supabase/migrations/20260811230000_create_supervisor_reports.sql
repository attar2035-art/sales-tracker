-- Free-form supervisor reports (separate from route visits): a typed report
-- with a title/type, free text body, photos and inventory files.
create table if not exists public.supervisor_reports (
  id            uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.supervisors(id) on delete cascade,
  report_type   text not null,
  content       text,
  photos        jsonb not null default '[]'::jsonb,
  files         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.supervisor_reports enable row level security;

create policy "Supervisors insert own reports" on public.supervisor_reports
  for insert with check (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor'
      and ur.supervisor_id = supervisor_reports.supervisor_id));

create policy "Supervisors update own reports" on public.supervisor_reports
  for update using (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor'
      and ur.supervisor_id = supervisor_reports.supervisor_id))
  with check (exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor'
      and ur.supervisor_id = supervisor_reports.supervisor_id));

create policy "Role scoped read reports" on public.supervisor_reports
  for select using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    or exists (select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'supervisor'
        and ur.supervisor_id = supervisor_reports.supervisor_id));

create policy "Managers read all reports" on public.supervisor_reports
  for select using (exists (
    select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'manager'));
