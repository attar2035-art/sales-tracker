-- Replace client-side-only role checks with real database-level authorization.
-- The React app ships a public (anon-equivalent) Supabase key to every browser,
-- so any authenticated user could previously call the REST API directly and
-- read/write rows outside their role by skipping the app's UI filtering.
-- This migration locks each table down to what each role actually needs.

-- ============================================================
-- user_roles
-- ============================================================
alter table public.user_roles enable row level security;

drop policy if exists "Users can read own role" on public.user_roles;
create policy "Users can read own role"
on public.user_roles for select
to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
);

-- Account/role creation is done by the create-rep-account edge function with the
-- service role key, which bypasses RLS entirely. These policies just stop a
-- signed-in client from writing to user_roles directly.
drop policy if exists "Admins can insert roles" on public.user_roles;
create policy "Admins can insert roles"
on public.user_roles for insert
to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update roles" on public.user_roles;
create policy "Admins can update roles"
on public.user_roles for update
to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete roles" on public.user_roles;
create policy "Admins can delete roles"
on public.user_roles for delete
to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- regions / supervisors / representatives
-- Low-sensitivity org structure (names only) is readable by any signed-in
-- role, same as before this migration. Only admins (Setup page) may write.
-- ============================================================
alter table public.regions enable row level security;
alter table public.supervisors enable row level security;
alter table public.representatives enable row level security;

drop policy if exists "Authenticated users can read regions" on public.regions;
create policy "Authenticated users can read regions"
on public.regions for select to authenticated using (true);

drop policy if exists "Authenticated users can read supervisors" on public.supervisors;
create policy "Authenticated users can read supervisors"
on public.supervisors for select to authenticated using (true);

drop policy if exists "Authenticated users can read representatives" on public.representatives;
create policy "Authenticated users can read representatives"
on public.representatives for select to authenticated using (true);

drop policy if exists "Admins can insert regions" on public.regions;
create policy "Admins can insert regions" on public.regions for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can update regions" on public.regions;
create policy "Admins can update regions" on public.regions for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can delete regions" on public.regions;
create policy "Admins can delete regions" on public.regions for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can insert supervisors" on public.supervisors;
create policy "Admins can insert supervisors" on public.supervisors for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can update supervisors" on public.supervisors;
create policy "Admins can update supervisors" on public.supervisors for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can delete supervisors" on public.supervisors;
create policy "Admins can delete supervisors" on public.supervisors for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can insert representatives" on public.representatives;
create policy "Admins can insert representatives" on public.representatives for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can update representatives" on public.representatives;
create policy "Admins can update representatives" on public.representatives for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Admins can delete representatives" on public.representatives;
create policy "Admins can delete representatives" on public.representatives for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- daily_entries / monthly_targets
-- admin + data_entry manage every rep's rows; supervisor reads their own
-- reps' rows; rep reads only their own rows.
-- ============================================================
alter table public.daily_entries enable row level security;
alter table public.monthly_targets enable row level security;

drop policy if exists "Role scoped read access to daily entries" on public.daily_entries;
create policy "Role scoped read access to daily entries"
on public.daily_entries for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry'))
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rep.id = daily_entries.rep_id
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'rep' and ur.rep_id = daily_entries.rep_id
  )
);

drop policy if exists "Admin and data entry can insert daily entries" on public.daily_entries;
create policy "Admin and data entry can insert daily entries"
on public.daily_entries for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')));

drop policy if exists "Admin and data entry can update daily entries" on public.daily_entries;
create policy "Admin and data entry can update daily entries"
on public.daily_entries for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')));

drop policy if exists "Admins can delete daily entries" on public.daily_entries;
create policy "Admins can delete daily entries"
on public.daily_entries for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Role scoped read access to monthly targets" on public.monthly_targets;
create policy "Role scoped read access to monthly targets"
on public.monthly_targets for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry'))
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rep.id = monthly_targets.rep_id
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'rep' and ur.rep_id = monthly_targets.rep_id
  )
);

drop policy if exists "Admin and data entry can insert monthly targets" on public.monthly_targets;
create policy "Admin and data entry can insert monthly targets"
on public.monthly_targets for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')));

drop policy if exists "Admin and data entry can update monthly targets" on public.monthly_targets;
create policy "Admin and data entry can update monthly targets"
on public.monthly_targets for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin', 'data_entry')));

drop policy if exists "Admins can delete monthly targets" on public.monthly_targets;
create policy "Admins can delete monthly targets"
on public.monthly_targets for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- customers / customer_product_sales
-- Customer identity and sales data is sensitive: admin sees everything,
-- supervisor/rep only see customers in their own region. No client writes
-- exist in the app for these tables (populated by import tooling with the
-- service role key, which bypasses RLS), so no insert/update/delete policy
-- is added here.
-- ============================================================
alter table public.customers enable row level security;
alter table public.customer_product_sales enable row level security;

drop policy if exists "Role scoped read access to customers" on public.customers;
create policy "Role scoped read access to customers"
on public.customers for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rep.region_id = customers.region_id
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rep.region_id = customers.region_id
  )
);

drop policy if exists "Role scoped read access to customer product sales" on public.customer_product_sales;
create policy "Role scoped read access to customer product sales"
on public.customer_product_sales for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.customers c on c.region_id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and c.id = customer_product_sales.customer_id
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.customers c on c.region_id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and c.id = customer_product_sales.customer_id
  )
);

-- ============================================================
-- customer_yearly_sales
-- Was previously "any authenticated user, full access" (see supabase_migration.sql).
-- Reads are scoped by region_name; writes stay admin-only since
-- import-tool.html upserts this table using an admin's browser session.
-- ============================================================
drop policy if exists "Allow authenticated full access" on public.customer_yearly_sales;

drop policy if exists "Role scoped read access to customer yearly sales" on public.customer_yearly_sales;
create policy "Role scoped read access to customer yearly sales"
on public.customer_yearly_sales for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = customer_yearly_sales.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = customer_yearly_sales.region_name
  )
);

drop policy if exists "Admins can insert customer yearly sales" on public.customer_yearly_sales;
create policy "Admins can insert customer yearly sales"
on public.customer_yearly_sales for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update customer yearly sales" on public.customer_yearly_sales;
create policy "Admins can update customer yearly sales"
on public.customer_yearly_sales for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete customer yearly sales" on public.customer_yearly_sales;
create policy "Admins can delete customer yearly sales"
on public.customer_yearly_sales for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- Region-level analytics/reference tables (read-only from the app, used by
-- admin/supervisor/rep on the analytics & rep-dashboard pages; data_entry
-- has no UI access to these and gets none here either).
-- ============================================================
alter table public.top_customers_by_region enable row level security;
alter table public.customer_risks enable row level security;
alter table public.product_analysis_by_region enable row level security;
alter table public.opportunities_by_region enable row level security;
alter table public.region_strategy enable row level security;

drop policy if exists "Role scoped read access to top customers by region" on public.top_customers_by_region;
create policy "Role scoped read access to top customers by region"
on public.top_customers_by_region for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = top_customers_by_region.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = top_customers_by_region.region_name
  )
);

drop policy if exists "Role scoped read access to customer risks" on public.customer_risks;
create policy "Role scoped read access to customer risks"
on public.customer_risks for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = customer_risks.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = customer_risks.region_name
  )
);

drop policy if exists "Role scoped read access to product analysis by region" on public.product_analysis_by_region;
create policy "Role scoped read access to product analysis by region"
on public.product_analysis_by_region for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = product_analysis_by_region.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = product_analysis_by_region.region_name
  )
);

drop policy if exists "Role scoped read access to opportunities by region" on public.opportunities_by_region;
create policy "Role scoped read access to opportunities by region"
on public.opportunities_by_region for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = opportunities_by_region.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = opportunities_by_region.region_name
  )
);

drop policy if exists "Role scoped read access to region strategy" on public.region_strategy;
create policy "Role scoped read access to region strategy"
on public.region_strategy for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor' and rg.name = region_strategy.region_name
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.regions rg on rg.id = rep.region_id
    where ur.user_id = auth.uid() and ur.role = 'rep' and rg.name = region_strategy.region_name
  )
);
