-- top_customers_by_region, customer_risks, product_analysis_by_region,
-- opportunities_by_region, and region_strategy are read by RepDashboard.js
-- for every signed-in role (admin/supervisor/rep), filtered client-side by
-- region_name. As of this migration none of these tables exist yet in the
-- live project (RepDashboard's fetchOptionalRows() falls back to computed
-- values when they're missing), so there is nothing to secure right now.
--
-- This migration is written defensively: each block only runs if its table
-- already exists, so it's a safe no-op today. If/when any of these tables
-- get created (matching the region_name column shape used elsewhere), this
-- migration must be re-run (or a new one added) to actually apply the
-- policies — `supabase db push` will not re-apply an already-recorded
-- migration just because its guarded condition later becomes true.

do $$
begin
  if to_regclass('public.top_customers_by_region') is not null then
    execute 'alter table public.top_customers_by_region enable row level security';

    execute 'drop policy if exists "Role scoped read access to top customers by region" on public.top_customers_by_region';
    execute $pol$create policy "Role scoped read access to top customers by region"
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
      )$pol$;

    execute 'drop policy if exists "Admins can insert top customers by region" on public.top_customers_by_region';
    execute $pol$create policy "Admins can insert top customers by region"
      on public.top_customers_by_region for insert to authenticated
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can update top customers by region" on public.top_customers_by_region';
    execute $pol$create policy "Admins can update top customers by region"
      on public.top_customers_by_region for update to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can delete top customers by region" on public.top_customers_by_region';
    execute $pol$create policy "Admins can delete top customers by region"
      on public.top_customers_by_region for delete to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_risks') is not null then
    execute 'alter table public.customer_risks enable row level security';

    execute 'drop policy if exists "Role scoped read access to customer risks" on public.customer_risks';
    execute $pol$create policy "Role scoped read access to customer risks"
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
      )$pol$;

    execute 'drop policy if exists "Admins can insert customer risks" on public.customer_risks';
    execute $pol$create policy "Admins can insert customer risks"
      on public.customer_risks for insert to authenticated
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can update customer risks" on public.customer_risks';
    execute $pol$create policy "Admins can update customer risks"
      on public.customer_risks for update to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can delete customer risks" on public.customer_risks';
    execute $pol$create policy "Admins can delete customer risks"
      on public.customer_risks for delete to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.product_analysis_by_region') is not null then
    execute 'alter table public.product_analysis_by_region enable row level security';

    execute 'drop policy if exists "Role scoped read access to product analysis by region" on public.product_analysis_by_region';
    execute $pol$create policy "Role scoped read access to product analysis by region"
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
      )$pol$;

    execute 'drop policy if exists "Admins can insert product analysis by region" on public.product_analysis_by_region';
    execute $pol$create policy "Admins can insert product analysis by region"
      on public.product_analysis_by_region for insert to authenticated
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can update product analysis by region" on public.product_analysis_by_region';
    execute $pol$create policy "Admins can update product analysis by region"
      on public.product_analysis_by_region for update to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can delete product analysis by region" on public.product_analysis_by_region';
    execute $pol$create policy "Admins can delete product analysis by region"
      on public.product_analysis_by_region for delete to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.opportunities_by_region') is not null then
    execute 'alter table public.opportunities_by_region enable row level security';

    execute 'drop policy if exists "Role scoped read access to opportunities by region" on public.opportunities_by_region';
    execute $pol$create policy "Role scoped read access to opportunities by region"
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
      )$pol$;

    execute 'drop policy if exists "Admins can insert opportunities by region" on public.opportunities_by_region';
    execute $pol$create policy "Admins can insert opportunities by region"
      on public.opportunities_by_region for insert to authenticated
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can update opportunities by region" on public.opportunities_by_region';
    execute $pol$create policy "Admins can update opportunities by region"
      on public.opportunities_by_region for update to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can delete opportunities by region" on public.opportunities_by_region';
    execute $pol$create policy "Admins can delete opportunities by region"
      on public.opportunities_by_region for delete to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.region_strategy') is not null then
    execute 'alter table public.region_strategy enable row level security';

    execute 'drop policy if exists "Role scoped read access to region strategy" on public.region_strategy';
    execute $pol$create policy "Role scoped read access to region strategy"
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
      )$pol$;

    execute 'drop policy if exists "Admins can insert region strategy" on public.region_strategy';
    execute $pol$create policy "Admins can insert region strategy"
      on public.region_strategy for insert to authenticated
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can update region strategy" on public.region_strategy';
    execute $pol$create policy "Admins can update region strategy"
      on public.region_strategy for update to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
      with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;

    execute 'drop policy if exists "Admins can delete region strategy" on public.region_strategy';
    execute $pol$create policy "Admins can delete region strategy"
      on public.region_strategy for delete to authenticated
      using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))$pol$;
  end if;
end $$;
