-- top_customers_by_region, customer_risks, product_analysis_by_region,
-- opportunities_by_region, and region_strategy are read by RepDashboard.js
-- for every signed-in role (admin/supervisor/rep), filtered client-side by
-- region_name. These tables were never touched by the earlier RLS migrations
-- (20260708190000 / 20260708191500) because they are not part of the app's
-- core schema — they were created directly in Supabase for the "region
-- insights" feature. Lock them down with the same region-scoped pattern
-- already used for customer_yearly_sales, so a rep/supervisor session can't
-- read other regions' data straight from the REST API.

-- ============================================================
-- top_customers_by_region
-- ============================================================
alter table public.top_customers_by_region enable row level security;

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

drop policy if exists "Admins can insert top customers by region" on public.top_customers_by_region;
create policy "Admins can insert top customers by region"
on public.top_customers_by_region for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update top customers by region" on public.top_customers_by_region;
create policy "Admins can update top customers by region"
on public.top_customers_by_region for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete top customers by region" on public.top_customers_by_region;
create policy "Admins can delete top customers by region"
on public.top_customers_by_region for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- customer_risks
-- ============================================================
alter table public.customer_risks enable row level security;

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

drop policy if exists "Admins can insert customer risks" on public.customer_risks;
create policy "Admins can insert customer risks"
on public.customer_risks for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update customer risks" on public.customer_risks;
create policy "Admins can update customer risks"
on public.customer_risks for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete customer risks" on public.customer_risks;
create policy "Admins can delete customer risks"
on public.customer_risks for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- product_analysis_by_region
-- ============================================================
alter table public.product_analysis_by_region enable row level security;

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

drop policy if exists "Admins can insert product analysis by region" on public.product_analysis_by_region;
create policy "Admins can insert product analysis by region"
on public.product_analysis_by_region for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update product analysis by region" on public.product_analysis_by_region;
create policy "Admins can update product analysis by region"
on public.product_analysis_by_region for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete product analysis by region" on public.product_analysis_by_region;
create policy "Admins can delete product analysis by region"
on public.product_analysis_by_region for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- opportunities_by_region
-- ============================================================
alter table public.opportunities_by_region enable row level security;

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

drop policy if exists "Admins can insert opportunities by region" on public.opportunities_by_region;
create policy "Admins can insert opportunities by region"
on public.opportunities_by_region for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update opportunities by region" on public.opportunities_by_region;
create policy "Admins can update opportunities by region"
on public.opportunities_by_region for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete opportunities by region" on public.opportunities_by_region;
create policy "Admins can delete opportunities by region"
on public.opportunities_by_region for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- ============================================================
-- region_strategy
-- ============================================================
alter table public.region_strategy enable row level security;

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

drop policy if exists "Admins can insert region strategy" on public.region_strategy;
create policy "Admins can insert region strategy"
on public.region_strategy for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update region strategy" on public.region_strategy;
create policy "Admins can update region strategy"
on public.region_strategy for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete region strategy" on public.region_strategy;
create policy "Admins can delete region strategy"
on public.region_strategy for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
