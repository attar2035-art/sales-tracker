-- Let a supervisor read the route plans of the reps in their team (for the
-- adherence follow-up), in addition to their own plan.
drop policy if exists "route plan supervisor reads team" on public.daily_route_plan;
create policy "route plan supervisor reads team" on public.daily_route_plan
  for select to authenticated
  using (
    daily_route_plan.rep_id is not null and exists (
      select 1 from public.user_roles ur
      join public.representatives rep on rep.supervisor_id = ur.supervisor_id
      where ur.user_id = auth.uid() and ur.role = 'supervisor' and rep.id = daily_route_plan.rep_id
    )
  );
