-- Managers: a company-wide read-only role, managed from the app like reps.
-- Applied to production via the Supabase MCP; this file records it in VCS.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role = any (array['admin','supervisor','data_entry','rep','manager']));

create table if not exists public.managers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  manager_type text not null default 'sales_manager'
    check (manager_type in ('sales_manager','company_manager')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.user_roles add column if not exists manager_id uuid references public.managers(id) on delete set null;

alter table public.managers enable row level security;
drop policy if exists "Admins manage managers" on public.managers;
create policy "Admins manage managers" on public.managers for all to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));
drop policy if exists "Managers read managers" on public.managers;
create policy "Managers read managers" on public.managers for select to authenticated
using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'manager'));

-- Additive company-wide READ policies for the manager role.
do $$
declare t text;
begin
  foreach t in array array[
    'representatives','supervisors','regions','monthly_targets','daily_entries',
    'customers','customer_yearly_sales','supervisor_routes','supervisor_visits'
  ]
  loop
    execute format('drop policy if exists "Managers read all %1$s" on public.%1$s', t);
    execute format(
      'create policy "Managers read all %1$s" on public.%1$s for select to authenticated '
      || 'using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = ''manager''))',
      t
    );
  end loop;
end $$;
