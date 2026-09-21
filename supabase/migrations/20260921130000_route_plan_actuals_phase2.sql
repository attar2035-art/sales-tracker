-- Phase 2: mark actual visits against the plan.
-- off_plan = a real visit that was NOT in the plan (entered by data-entry).
alter table public.daily_route_plan
  add column if not exists off_plan boolean not null default false;

-- Data-entry records the actual visits (they come from another system), so they
-- may write to any plan (mark visited / add off-plan visits). Admins already can.
drop policy if exists "route plan data entry write" on public.daily_route_plan;
create policy "route plan data entry write" on public.daily_route_plan
  for all to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'data_entry'))
  with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'data_entry'));
