-- customer_yearly_history had RLS enabled with zero policies (locked to
-- everyone but service role). Add the same region/rep-scoped pattern used
-- for customer_product_sales so it's consistent if the app starts using it.
drop policy if exists "Role scoped read access to customer yearly history" on public.customer_yearly_history;
create policy "Role scoped read access to customer yearly history"
on public.customer_yearly_history for select to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.supervisor_id = ur.supervisor_id
    join public.customers c on c.id = customer_yearly_history.customer_id
    where ur.user_id = auth.uid() and ur.role = 'supervisor'
      and (c.region_id = rep.region_id or c.rep_id = rep.id)
  )
  or exists (
    select 1 from public.user_roles ur
    join public.representatives rep on rep.id = ur.rep_id
    join public.customers c on c.id = customer_yearly_history.customer_id
    where ur.user_id = auth.uid() and ur.role = 'rep'
      and (c.region_id = rep.region_id or c.rep_id = rep.id)
  )
);

drop policy if exists "Admins can insert customer yearly history" on public.customer_yearly_history;
create policy "Admins can insert customer yearly history"
on public.customer_yearly_history for insert to authenticated
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can update customer yearly history" on public.customer_yearly_history;
create policy "Admins can update customer yearly history"
on public.customer_yearly_history for update to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

drop policy if exists "Admins can delete customer yearly history" on public.customer_yearly_history;
create policy "Admins can delete customer yearly history"
on public.customer_yearly_history for delete to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
