-- Fix: an upsert (INSERT ... ON CONFLICT DO UPDATE) fires the BEFORE INSERT
-- trigger with the proposed row EVEN WHEN it ends up updating an existing row.
-- The proposed row re-sends the current value of locked fields (e.g. another
-- user's daily_sales), so the INSERT-time guard rejected legitimate saves
-- ("الحقل daily_sales مخصّص لمستخدم آخر ولا يمكنك إدخاله").
--
-- Enforce field locks on UPDATE only — that is what protects data that already
-- exists. A brand-new row has no other user's data to protect yet, and the app
-- UI still prevents entering fields you're not assigned to. The check now runs
-- only for fields whose value actually changed, comparing daily_sales as GROSS
-- (net + returns) so a returns edit never trips the sales lock.
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
  changed boolean;
begin
  if uid is null then
    return new; -- trusted server/maintenance context
  end if;

  foreach k in array lockable loop
    if k = 'daily_sales' then
      changed := (new.daily_sales + coalesce(new.daily_returns,0))
                 is distinct from (old.daily_sales + coalesce(old.daily_returns,0));
    else
      changed := (to_jsonb(new) ->> k) is distinct from (to_jsonb(old) ->> k);
    end if;

    if not changed then
      continue;
    end if;

    select user_id::text into assigned_id
      from public.data_entry_field_assignments where field_key = k;
    if assigned_id is not null then
      if assigned_id <> uid then
        raise exception 'الحقل "%" مخصّص لمستخدم آخر ولا يمكن تعديله', k using errcode='check_violation';
      end if;
      continue;
    end if;

    owner_id := old.field_owners ->> k;
    if owner_id is not null and owner_id <> uid then
      raise exception 'الحقل المقفول "%" أدخله مستخدم آخر ولا يمكن تعديله', k using errcode='check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_enforce_daily_entry_field_locks on public.daily_entries;
create trigger trg_enforce_daily_entry_field_locks
before update on public.daily_entries
for each row execute function public.enforce_daily_entry_field_locks();
