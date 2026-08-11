-- Permissions center: managers who receive supervisor field-visit reports.
-- region_id NULL = receives for all regions; otherwise scoped to that region.
-- Applied to production via the Supabase MCP; this file records it in VCS.
create table if not exists public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role text not null default 'sales_manager'
    check (role in ('sales_manager', 'company_manager', 'other')),
  region_id uuid references public.regions(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists report_recipients_region_idx on public.report_recipients (region_id);
create index if not exists report_recipients_active_idx on public.report_recipients (is_active);

alter table public.report_recipients enable row level security;

drop policy if exists "Admins manage report recipients" on public.report_recipients;
create policy "Admins manage report recipients"
on public.report_recipients for all to authenticated
using (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
)
with check (
  exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
);
