-- ============================================================
-- Radical fix: no uploaded visit is ever silently dropped.
-- Unmatched rows are held in unmatched_visits and auto-matched
-- (reconciled) as soon as the missing customer/rep appears.
-- ============================================================

create table if not exists public.unmatched_visits (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null,
  visit_date date not null,
  result text not null check (result in ('ناجحة','غير ناجحة')),
  operations_count int not null default 1,
  reason text not null,              -- 'customer_unregistered' | 'no_active_rep'
  source text default 'visits_file',
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_rep_id uuid references public.representatives(id)
);

-- one live (unresolved) holding row per code/date; resolved history is kept
create unique index if not exists uq_unmatched_live
  on public.unmatched_visits (customer_code, visit_date) where resolved_at is null;
create index if not exists idx_unmatched_unresolved
  on public.unmatched_visits (resolved_at) where resolved_at is null;

alter table public.unmatched_visits enable row level security;

-- read access mirrors daily_visits (admin / data_entry / manager). Writes happen
-- only through SECURITY DEFINER functions below, so no write policies are needed.
drop policy if exists "read unmatched visits" on public.unmatched_visits;
create policy "read unmatched visits" on public.unmatched_visits for select
  using (exists (select 1 from public.user_roles ur
                 where ur.user_id = auth.uid()
                   and ur.role in ('admin','data_entry','manager')));

-- ------------------------------------------------------------
-- reconcile: try to match held rows; move matched ones into
-- daily_visits, mark them resolved, recompute daily_entries.
-- p_codes = null  -> process ALL unresolved rows.
-- ------------------------------------------------------------
create or replace function public.reconcile_unmatched_visits(p_codes text[] default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_dates date[]; v_resolved int;
begin
  create temp table _rec on commit drop as
  select uv.id,
         uv.customer_code as code,
         uv.visit_date,
         uv.result,
         uv.operations_count as ops,
         (select rp.id from public.representatives rp
            where rp.region_id = cu.region_id and coalesce(rp.is_active,true)=true
            order by rp.created_at limit 1) as rep_id
  from public.unmatched_visits uv
  join public.customers cu on cu.customer_code = uv.customer_code
  where uv.resolved_at is null
    and (p_codes is null or uv.customer_code = any(p_codes));

  if not exists (select 1 from _rec where rep_id is not null) then
    return jsonb_build_object('resolved', 0);
  end if;

  insert into public.daily_visits (rep_id, visit_date, customer_code, result, operations_count, source)
  select rep_id, visit_date, code, result, ops, 'visits_file_reconciled'
  from _rec where rep_id is not null
  on conflict (rep_id, customer_code, visit_date) do update
    set result = case when excluded.result='ناجحة' or public.daily_visits.result='ناجحة' then 'ناجحة' else 'غير ناجحة' end,
        operations_count = excluded.operations_count;

  update public.unmatched_visits uv
    set resolved_at = now(), resolved_rep_id = r.rep_id
  from _rec r where uv.id = r.id and r.rep_id is not null;

  select array_agg(distinct visit_date) into v_dates from _rec where rep_id is not null;

  insert into public.daily_entries (rep_id, entry_date, year, month)
  select distinct rep_id, visit_date, extract(year from visit_date)::int, extract(month from visit_date)::int
  from _rec where rep_id is not null
  on conflict (rep_id, entry_date) do nothing;

  update public.daily_entries de set
    total_visits = s.tot, successful_visits = s.ok, updated_at = now()
  from (
    select rep_id, visit_date, count(*)::int tot, count(*) filter (where result='ناجحة')::int ok
    from public.daily_visits where visit_date = any(v_dates)
    group by rep_id, visit_date
  ) s
  where de.rep_id = s.rep_id and de.entry_date = s.visit_date;

  select count(*) into v_resolved from _rec where rep_id is not null;
  return jsonb_build_object('resolved', v_resolved, 'dates', to_jsonb(coalesce(v_dates, array[]::date[])));
end $$;

-- ------------------------------------------------------------
-- self-heal triggers
-- ------------------------------------------------------------
create or replace function public.trg_reconcile_on_customer()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.reconcile_unmatched_visits(array[new.customer_code]);
  return new;
end $$;

drop trigger if exists reconcile_on_customer on public.customers;
create trigger reconcile_on_customer
  after insert or update of region_id, customer_code on public.customers
  for each row execute function public.trg_reconcile_on_customer();

create or replace function public.trg_reconcile_on_rep()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_codes text[];
begin
  if coalesce(new.is_active, true) then
    select array_agg(distinct uv.customer_code) into v_codes
    from public.unmatched_visits uv
    join public.customers cu on cu.customer_code = uv.customer_code
    where uv.resolved_at is null and cu.region_id = new.region_id;
    if v_codes is not null then
      perform public.reconcile_unmatched_visits(v_codes);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists reconcile_on_rep on public.representatives;
create trigger reconcile_on_rep
  after insert or update of is_active, region_id on public.representatives
  for each row execute function public.trg_reconcile_on_rep();
