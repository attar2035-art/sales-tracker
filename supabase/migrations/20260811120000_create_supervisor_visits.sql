-- Field-visit tracking for supervisors: one route per supervisor per day,
-- containing individual customer visits with GPS check-in and photos.
--
-- SCHEMA-TYPE CAVEAT: supervisor_id/customer_id below are declared uuid to
-- match user_roles.supervisor_id / user_roles.rep_id and the existing
-- audit_logs.supervisor_id/rep_id columns (same assumption that migration
-- already made). No REFERENCES constraint is added to supervisors/customers
-- because this repo has no committed CREATE TABLE for those tables to verify
-- the real column type against (they predate migrations, created directly in
-- Supabase). If the live schema turns out to use bigint ids instead, this
-- migration will fail on the (unused) casts below and needs a follow-up fix
-- once the real types are confirmed.

create table if not exists public.supervisor_routes (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null,
  route_date date not null default current_date,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz not null default now(),
  unique (supervisor_id, route_date)
);

create index if not exists supervisor_routes_supervisor_id_idx on public.supervisor_routes (supervisor_id);
create index if not exists supervisor_routes_route_date_idx on public.supervisor_routes (route_date desc);

create table if not exists public.supervisor_visits (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.supervisor_routes(id) on delete cascade,
  customer_id uuid not null,
  visit_status text not null default 'planned' check (visit_status in ('planned', 'completed', 'cancelled')),
  check_in_time timestamptz,
  check_out_time timestamptz,
  gps_lat double precision,
  gps_lng double precision,
  visit_notes text,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists supervisor_visits_route_id_idx on public.supervisor_visits (route_id);
create index if not exists supervisor_visits_customer_id_idx on public.supervisor_visits (customer_id);

alter table public.supervisor_routes enable row level security;
alter table public.supervisor_visits enable row level security;

-- ============================================================
-- supervisor_routes: admin reads everything; a supervisor reads/creates/
-- updates only their own day's route.
-- ============================================================
drop policy if exists "Role scoped read access to supervisor routes" on public.supervisor_routes;
create policy "Role scoped read access to supervisor routes"
on public.supervisor_routes for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = supervisor_routes.supervisor_id
  )
);

drop policy if exists "Supervisors can insert own routes" on public.supervisor_routes;
create policy "Supervisors can insert own routes"
on public.supervisor_routes for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = supervisor_routes.supervisor_id
  )
);

drop policy if exists "Supervisors can update own routes" on public.supervisor_routes;
create policy "Supervisors can update own routes"
on public.supervisor_routes for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = supervisor_routes.supervisor_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = supervisor_routes.supervisor_id
  )
);

-- ============================================================
-- supervisor_visits: scoped through the parent route's supervisor_id, same
-- admin/supervisor split as above.
-- ============================================================
drop policy if exists "Role scoped read access to supervisor visits" on public.supervisor_visits;
create policy "Role scoped read access to supervisor visits"
on public.supervisor_visits for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.supervisor_routes sr on sr.id = supervisor_visits.route_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = sr.supervisor_id
  )
);

drop policy if exists "Supervisors can insert visits on own routes" on public.supervisor_visits;
create policy "Supervisors can insert visits on own routes"
on public.supervisor_visits for insert to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    join public.supervisor_routes sr on sr.id = supervisor_visits.route_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = sr.supervisor_id
  )
);

drop policy if exists "Supervisors can update visits on own routes" on public.supervisor_visits;
create policy "Supervisors can update visits on own routes"
on public.supervisor_visits for update to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    join public.supervisor_routes sr on sr.id = supervisor_visits.route_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = sr.supervisor_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    join public.supervisor_routes sr on sr.id = supervisor_visits.route_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and ur.supervisor_id = sr.supervisor_id
  )
);

-- ============================================================
-- Storage: private bucket for visit photos. Objects are stored under
-- "<auth.uid()>/<filename>" so ownership can be checked from the path alone.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

drop policy if exists "Supervisors can upload own visit photos" on storage.objects;
create policy "Supervisors can upload own visit photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'visit-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Read access to visit photos" on storage.objects;
create policy "Read access to visit photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'visit-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  )
);
