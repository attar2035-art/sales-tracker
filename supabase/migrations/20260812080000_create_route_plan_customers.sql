-- Weekly route plan: which customers a region's supervisor visits on each
-- weekday. Uploaded by admins from ready sheets; read by the owning supervisor
-- (and managers) to pre-fill the visit form.
create table if not exists public.route_plan_customers (
  id            uuid primary key default gen_random_uuid(),
  region_id     uuid not null references public.regions(id) on delete cascade,
  day_of_week   text not null,
  customer_name text not null,
  neighborhood  text,
  city          text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists route_plan_region_day_idx
  on public.route_plan_customers (region_id, day_of_week);

alter table public.route_plan_customers enable row level security;

create policy "Admins manage route plan" on public.route_plan_customers
  for all
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

create policy "Supervisors read own route plan" on public.route_plan_customers
  for select using (exists (
    select 1 from public.user_roles ur
      join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor'
      and rep.region_id = route_plan_customers.region_id));

create policy "Managers read route plan" on public.route_plan_customers
  for select using (exists (
    select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'manager'));
