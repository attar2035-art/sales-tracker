-- Performance (BUG-020): server-side per-customer sales aggregation so the
-- Customers screen no longer has to pull every customer_product_sales row to
-- the browser and sum it in JS.
--
-- SECURITY INVOKER => the caller's RLS on customer_product_sales / customers
-- still applies, so region/rep scoping is preserved.
--
-- customer_id and region_id are cast to text so this function is correct
-- whether those columns are bigint or uuid (no schema assumption). The client
-- keys results by String(id) and falls back to client-side aggregation if this
-- function is not deployed, so it is safe to ship before or after this migration.

create or replace function public.customer_sales_totals(p_region_ids text[] default null)
returns table (
  customer_id text,
  total_amount numeric,
  total_quantity numeric,
  sku_count integer
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    cps.customer_id::text as customer_id,
    coalesce(sum(cps.amount), 0)::numeric as total_amount,
    coalesce(sum(cps.quantity), 0)::numeric as total_quantity,
    count(distinct cps.product_id)::integer as sku_count
  from public.customer_product_sales cps
  join public.customers c on c.id = cps.customer_id
  where p_region_ids is null or c.region_id::text = any(p_region_ids)
  group by cps.customer_id;
$$;

grant execute on function public.customer_sales_totals(text[]) to authenticated;
