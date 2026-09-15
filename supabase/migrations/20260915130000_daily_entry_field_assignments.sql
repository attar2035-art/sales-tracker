-- Per-field ownership + explicit assignment for daily_entries.
--
-- Two layers of protection so entered numbers can't be tampered with:
--   1) field_owners (first-come): whoever fills a field owns it; only they may
--      later change it — admins included.
--   2) data_entry_field_assignments (explicit): an admin can designate the
--      responsible data-entry user per field. An assigned field may only be
--      entered/edited by its assigned user; it takes precedence over field_owners.
-- Both are enforced by a BEFORE INSERT/UPDATE trigger, independent of the app UI.

-- 1) Assignment map -----------------------------------------------------------
create table if not exists public.data_entry_field_assignments (
  field_key   text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

alter table public.data_entry_field_assignments enable row level security;

drop policy if exists "read field assignments" on public.data_entry_field_assignments;
create policy "read field assignments" on public.data_entry_field_assignments
  for select to authenticated using (true);

drop policy if exists "admins manage field assignments" on public.data_entry_field_assignments;
create policy "admins manage field assignments" on public.data_entry_field_assignments
  for all to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'))
  with check (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- 2) Enforcement trigger ------------------------------------------------------
create or replace function public.enforce_daily_entry_field_locks()
returns trigger
language plpgsql
security invoker
as $$
declare
  uid text := auth.uid()::text;
  k text;
  owner_id text;
  assigned_id text;
  lockable text[] := array[
    'daily_sales','daily_returns','daily_collection','new_customers','new_customers_value',
    'total_visits','shelf_photos','successful_visits','new_products_skus','new_products_qty',
    'new_products_availability','working_hours','km','daily_expenses',
    'overdue_total_input','overdue_collected','notes'];
  new_val text;
  changed boolean;
begin
  -- Trusted server/maintenance contexts (service_role, SQL) have no auth.uid();
  -- let them through so genuine corrections stay possible off-app.
  if uid is null then
    return new;
  end if;

  foreach k in array lockable loop
    select user_id::text into assigned_id
      from public.data_entry_field_assignments where field_key = k;

    -- "daily_sales" is stored NET, so represent the sales quantity as GROSS.
    if k = 'daily_sales' then
      new_val := (new.daily_sales + coalesce(new.daily_returns,0))::text;
    else
      new_val := to_jsonb(new) ->> k;
    end if;

    if assigned_id is not null then
      -- Explicitly assigned: only the assignee may write it.
      if assigned_id = uid then
        continue;
      end if;

      if tg_op = 'INSERT' then
        if k = 'notes' then
          if coalesce(new_val,'') <> '' then
            raise exception 'الحقل "%" مخصّص لمستخدم آخر ولا يمكنك إدخاله', k using errcode='check_violation';
          end if;
        elsif coalesce(new_val,'0')::numeric <> 0 then
          raise exception 'الحقل "%" مخصّص لمستخدم آخر ولا يمكنك إدخاله', k using errcode='check_violation';
        end if;
      else
        if k = 'daily_sales' then
          changed := (new.daily_sales + coalesce(new.daily_returns,0))
                     is distinct from (old.daily_sales + coalesce(old.daily_returns,0));
        else
          changed := (to_jsonb(new) ->> k) is distinct from (to_jsonb(old) ->> k);
        end if;
        if changed then
          raise exception 'الحقل "%" مخصّص لمستخدم آخر ولا يمكن تعديله', k using errcode='check_violation';
        end if;
      end if;

    elsif tg_op = 'UPDATE' then
      -- Unassigned: legacy first-come owner lock.
      owner_id := old.field_owners ->> k;
      if owner_id is not null and owner_id <> uid then
        if k = 'daily_sales' then
          changed := (new.daily_sales + coalesce(new.daily_returns,0))
                     is distinct from (old.daily_sales + coalesce(old.daily_returns,0));
        else
          changed := (to_jsonb(new) ->> k) is distinct from (to_jsonb(old) ->> k);
        end if;
        if changed then
          raise exception 'الحقل المقفول "%" أدخله مستخدم آخر ولا يمكن تعديله', k using errcode='check_violation';
        end if;
        if (new.field_owners ->> k) is distinct from owner_id then
          raise exception 'لا يمكن تغيير ملكية الحقل المقفول "%"', k using errcode='check_violation';
        end if;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_enforce_daily_entry_field_locks on public.daily_entries;
create trigger trg_enforce_daily_entry_field_locks
before insert or update on public.daily_entries
for each row execute function public.enforce_daily_entry_field_locks();

-- 3) Admin-only helper to list data-entry users by email (auth.users is not
--    client-readable) so the Permissions Center can assign fields to them.
create or replace function public.list_data_entry_users()
returns table(user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  return query
    select ur.user_id, u.email::text
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
    where ur.role in ('data_entry','admin')
    order by u.email;
end;
$$;

revoke all on function public.list_data_entry_users() from public;
grant execute on function public.list_data_entry_users() to authenticated;
