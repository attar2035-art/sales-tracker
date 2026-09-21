-- Daily route plan (خطة خط السير). Each row is one planned customer for a
-- given day, owned by EITHER a rep OR a supervisor (each plans independently).
create table if not exists public.daily_route_plan (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  rep_id uuid references public.representatives(id) on delete cascade,
  supervisor_id uuid references public.supervisors(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  region_id uuid references public.regions(id) on delete set null,
  neighborhood text,
  city text,
  phone text,
  contact_person text,
  customer_rating text,
  notes text,
  visited boolean not null default false,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_owner check ((rep_id is not null) <> (supervisor_id is not null))
);
create index if not exists idx_drp_rep_date on public.daily_route_plan(rep_id, plan_date);
create index if not exists idx_drp_sup_date on public.daily_route_plan(supervisor_id, plan_date);

alter table public.daily_route_plan enable row level security;

drop policy if exists "route plan owner manage" on public.daily_route_plan;
create policy "route plan owner manage" on public.daily_route_plan
  for all to authenticated
  using (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    or (rep_id is not null and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'rep' and ur.rep_id = daily_route_plan.rep_id))
    or (supervisor_id is not null and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = daily_route_plan.supervisor_id))
  )
  with check (
    exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    or (rep_id is not null and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'rep' and ur.rep_id = daily_route_plan.rep_id))
    or (supervisor_id is not null and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = daily_route_plan.supervisor_id))
  );

drop policy if exists "route plan read all" on public.daily_route_plan;
create policy "route plan read all" on public.daily_route_plan
  for select to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('manager','data_entry')));
