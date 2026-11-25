-- Fix: the field-lock trigger treated an empty/blank value as DIFFERENT from NULL
-- (e.g. the daily-entry form sends notes='' while a row pre-created by the visits
-- import stored notes=NULL). That made a non-edit look like a change to a field
-- assigned to another user, so a legitimate save (e.g. Amira entering collection
-- on a day whose daily_entries row the visits import created) was wrongly rejected:
--   "الحقل "notes" مخصّص لمستخدم آخر ولا يمكن تعديله".
-- Normalize empty/blank <-> NULL so "no value either way" is never a change.
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
    'overdue_total_input','overdue_collected',
    'debt_total','debt_1_45','debt_over_60','debt_over_90','debt_over_120','debt_over_150',
    'notes'];
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
      -- Treat NULL and empty/blank as the same "no value", so writing '' over a
      -- stored NULL (or vice versa) is NOT counted as editing the field.
      changed := nullif(btrim(to_jsonb(new) ->> k), '')
                 is distinct from nullif(btrim(to_jsonb(old) ->> k), '');
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
