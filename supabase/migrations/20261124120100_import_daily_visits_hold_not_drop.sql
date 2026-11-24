-- Rewrite import_daily_visits so UNMATCHED rows are HELD in unmatched_visits
-- (with a reason) instead of being silently dropped. Matched rows behave as
-- before. Returns held/unmatched counts so the upload screen can show them.
create or replace function public.import_daily_visits(p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_ok boolean;
  v_dates date[];
  v_unmatched text[];
  v_held int;
  v_uid uuid := auth.uid();
BEGIN
  -- auth: admin or data_entry only
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = v_uid AND ur.role IN ('admin','data_entry')) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'not allowed'; END IF;

  -- stage incoming rows (one per operation line)
  CREATE TEMP TABLE _in (code text, visit_date date, result text) ON COMMIT DROP;
  INSERT INTO _in (code, visit_date, result)
  SELECT btrim(x->>'code'),
         (x->>'date')::date,
         CASE WHEN coalesce(x->>'result','') LIKE '%غير%' THEN 'غير ناجحة' ELSE 'ناجحة' END
  FROM jsonb_array_elements(p_rows) x
  WHERE btrim(coalesce(x->>'code','')) <> '' AND nullif(x->>'date','') IS NOT NULL;

  -- resolve rep via customer code -> region -> active rep (carry region_id for reason)
  CREATE TEMP TABLE _res ON COMMIT DROP AS
  SELECT i.visit_date, i.code, i.result,
         cu.region_id,
         (SELECT rp.id FROM public.representatives rp
            WHERE rp.region_id = cu.region_id AND coalesce(rp.is_active,true)=true
            ORDER BY rp.created_at LIMIT 1) AS rep_id
  FROM _in i
  LEFT JOIN public.customers cu ON cu.customer_code = i.code;

  SELECT array_agg(DISTINCT code) INTO v_unmatched FROM _res WHERE rep_id IS NULL;

  -- ===== MATCHED: dedup per rep/code/date; success if any line is ناجحة =====
  CREATE TEMP TABLE _agg ON COMMIT DROP AS
  SELECT rep_id, visit_date, code,
         bool_or(result='ناجحة') AS ok,
         count(*)::int AS ops
  FROM _res WHERE rep_id IS NOT NULL
  GROUP BY rep_id, visit_date, code;

  INSERT INTO public.daily_visits (rep_id, visit_date, customer_code, result, operations_count, source)
  SELECT rep_id, visit_date, code, CASE WHEN ok THEN 'ناجحة' ELSE 'غير ناجحة' END, ops, 'visits_file'
  FROM _agg
  ON CONFLICT (rep_id, customer_code, visit_date) DO UPDATE
    SET result = CASE WHEN excluded.result='ناجحة' OR public.daily_visits.result='ناجحة' THEN 'ناجحة' ELSE 'غير ناجحة' END,
        operations_count = excluded.operations_count;

  SELECT array_agg(DISTINCT visit_date) INTO v_dates FROM _agg;

  INSERT INTO public.daily_entries (rep_id, entry_date, year, month)
  SELECT DISTINCT rep_id, visit_date, EXTRACT(YEAR FROM visit_date)::int, EXTRACT(MONTH FROM visit_date)::int
  FROM _agg
  ON CONFLICT (rep_id, entry_date) DO NOTHING;

  UPDATE public.daily_entries de SET
    total_visits = s.tot, successful_visits = s.ok, updated_at = now()
  FROM (
    SELECT rep_id, visit_date, count(*)::int tot, count(*) FILTER (WHERE result='ناجحة')::int ok
    FROM public.daily_visits WHERE visit_date = ANY(v_dates)
    GROUP BY rep_id, visit_date
  ) s
  WHERE de.rep_id=s.rep_id AND de.entry_date=s.visit_date;

  -- ===== UNMATCHED: HOLD, never drop. Aggregate per code/date with reason. =====
  INSERT INTO public.unmatched_visits (customer_code, visit_date, result, operations_count, reason, source, created_by)
  SELECT code, visit_date,
         CASE WHEN bool_or(result='ناجحة') THEN 'ناجحة' ELSE 'غير ناجحة' END,
         count(*)::int,
         CASE WHEN bool_and(region_id IS NULL) THEN 'customer_unregistered' ELSE 'no_active_rep' END,
         'visits_file', v_uid
  FROM _res WHERE rep_id IS NULL
  GROUP BY code, visit_date
  ON CONFLICT (customer_code, visit_date) WHERE resolved_at IS NULL
  DO UPDATE SET result = excluded.result,
               operations_count = excluded.operations_count,
               reason = excluded.reason,
               created_at = now();

  SELECT count(*) INTO v_held FROM (SELECT 1 FROM _res WHERE rep_id IS NULL GROUP BY code, visit_date) q;

  RETURN jsonb_build_object(
    'reps', (SELECT count(DISTINCT rep_id) FROM _agg),
    'visits', (SELECT count(*) FROM _agg),
    'successful', (SELECT count(*) FROM _agg WHERE ok),
    'dates', to_jsonb(coalesce(v_dates, ARRAY[]::date[])),
    'unmatched', to_jsonb(coalesce(v_unmatched, ARRAY[]::text[])),
    'held', coalesce(v_held, 0)
  );
END;
$function$;
