-- =============================================================================
-- STAGING seed data for sales-tracker QA (safe, idempotent, INSERT-only)
-- =============================================================================
-- RUN ONLY ON A STAGING PROJECT. Never on production.
--
-- This script is id-type agnostic: it never hardcodes ids. Rows are inserted by
-- their natural keys (name / code) and referenced via subqueries, so it works
-- whether your primary keys are bigint or uuid. Each insert is guarded with
-- WHERE NOT EXISTS, so re-running does not duplicate rows.
--
-- NOTE ON AUTH USERS: Supabase auth users cannot be created reliably from plain
-- SQL (auth.users needs an encrypted password + provider rows). Create the test
-- login accounts FIRST via the Supabase Dashboard (Authentication > Add user)
-- or the Admin API, using these emails (any password; enable "auto confirm"):
--     admin@staging.test        (admin)
--     data@staging.test         (data_entry)
--     supA@staging.test         (supervisor — الرياض)
--     supB@staging.test         (supervisor — جدة)
--     rep1@staging.test         (rep — مندوب اختبار 1)
--     rep3@staging.test         (rep — مندوب اختبار 3)
--     norole@staging.test       (NO user_roles row — for the BUG-004 test)
-- Then run this whole file. The final section links user_roles by email.
-- =============================================================================

begin;

-- ---------- Regions ----------
insert into regions (name)
select v.name from (values ('الرياض'), ('جدة')) as v(name)
where not exists (select 1 from regions r where r.name = v.name);

-- ---------- Supervisors ----------
insert into supervisors (name, region_id)
select 'مشرف الرياض', (select id from regions where name = 'الرياض')
where not exists (select 1 from supervisors where name = 'مشرف الرياض');

insert into supervisors (name, region_id)
select 'مشرف جدة', (select id from regions where name = 'جدة')
where not exists (select 1 from supervisors where name = 'مشرف جدة');

-- ---------- Representatives ----------
-- rep1, rep2 => الرياض under مشرف الرياض ; rep3, rep4 => جدة under مشرف جدة
insert into representatives (name, supervisor_id, region_id, is_active)
select r.name,
       (select id from supervisors where name = r.sup),
       (select id from regions where name = r.region),
       true
from (values
  ('مندوب اختبار 1', 'مشرف الرياض', 'الرياض'),
  ('مندوب اختبار 2', 'مشرف الرياض', 'الرياض'),
  ('مندوب اختبار 3', 'مشرف جدة',   'جدة'),
  ('مندوب اختبار 4', 'مشرف جدة',   'جدة')
) as r(name, sup, region)
where not exists (select 1 from representatives x where x.name = r.name);

-- ---------- Products ----------
insert into products (product_code, product_name, unit)
select v.code, v.name, v.unit from (values
  ('P001', 'منتج تجريبي 1', 'علبة'),
  ('P002', 'منتج تجريبي 2', 'كرتون')
) as v(code, name, unit)
where not exists (select 1 from products p where p.product_code = v.code);

-- ---------- Customers ----------
-- C001/C002 in الرياض (C001 assigned to rep1) ; C003/C004 in جدة (C003 to rep3)
insert into customers (customer_code, customer_name, region_id, rep_id)
select c.code, c.name,
       (select id from regions where name = c.region),
       case when c.rep is null then null else (select id from representatives where name = c.rep) end
from (values
  ('C001', 'عميل الرياض 1', 'الرياض', 'مندوب اختبار 1'),
  ('C002', 'عميل الرياض 2', 'الرياض', null),
  ('C003', 'عميل جدة 1',    'جدة',   'مندوب اختبار 3'),
  ('C004', 'عميل جدة 2',    'جدة',   null)
) as c(code, name, region, rep)
where not exists (select 1 from customers x where x.customer_code = c.code);

-- ---------- Customer product sales (for Customers totals + RPC test) ----------
insert into customer_product_sales (customer_id, product_id, amount, quantity)
select (select id from customers where customer_code = s.ccode),
       (select id from products  where product_code  = s.pcode),
       s.amount, s.qty
from (values
  ('C001', 'P001', 5000, 20),
  ('C001', 'P002', 3000, 10),
  ('C002', 'P001', 1500, 6),
  ('C003', 'P001', 8000, 30),
  ('C004', 'P002', 2000, 8)
) as s(ccode, pcode, amount, qty)
where not exists (
  select 1 from customer_product_sales cps
  join customers c on c.id = cps.customer_id
  join products  p on p.id = cps.product_id
  where c.customer_code = s.ccode and p.product_code = s.pcode
);

-- ---------- Monthly targets (current month, rep1/rep2/rep3) ----------
insert into monthly_targets (
  rep_id, year, month,
  target_sales, target_collection, target_new_customers, target_new_customers_value,
  target_total_visits, target_successful_visits, target_new_products_skus,
  target_new_products_qty, target_working_hours, target_km, overdue_total
)
select (select id from representatives where name = t.rep),
       extract(year from current_date)::int, extract(month from current_date)::int,
       t.sales, t.collection, 10, 5000, 100, 70, 20, 60, 160, 1200, 15000
from (values
  ('مندوب اختبار 1', 60000, 20000),
  ('مندوب اختبار 2', 50000, 18000),
  ('مندوب اختبار 3', 40000, 15000)
) as t(rep, sales, collection)
where not exists (
  select 1 from monthly_targets m
  where m.rep_id = (select id from representatives where name = t.rep)
    and m.year = extract(year from current_date)::int
    and m.month = extract(month from current_date)::int
);

-- ---------- Daily entries (current month: 2 rows each for rep1/rep2/rep3) ----
insert into daily_entries (
  rep_id, entry_date, year, month,
  daily_sales, daily_collection, new_customers, new_customers_value,
  total_visits, successful_visits, shelf_photos, new_products_skus, new_products_qty,
  new_products_availability, working_hours, km, daily_expenses,
  overdue_total_input, overdue_collected, notes
)
select (select id from representatives where name = e.rep),
       e.d,
       extract(year from e.d)::int, extract(month from e.d)::int,
       e.sales, e.collection, 2, 800, 8, 6, 5, 3, 9, 90, 8, 40, 60, 5000, 500, 'بيانات اختبار'
from (
  values
    ('مندوب اختبار 1', (date_trunc('month', current_date)::date + 1), 2500, 900),
    ('مندوب اختبار 1', (date_trunc('month', current_date)::date + 2), 3000, 1100),
    ('مندوب اختبار 2', (date_trunc('month', current_date)::date + 1), 2000, 700),
    ('مندوب اختبار 3', (date_trunc('month', current_date)::date + 1), 3500, 1500)
) as e(rep, d, sales, collection)
where not exists (
  select 1 from daily_entries x
  where x.rep_id = (select id from representatives where name = e.rep)
    and x.entry_date = e.d
);

-- ---------- Customer yearly sales (2024 + 2025, both regions) ----------
-- Has a UNIQUE(customer_code, year, region_name) constraint => on conflict skip.
insert into customer_yearly_sales (
  customer_code, customer_name, region_name, year,
  net_sales, collected, aging_0_30, aging_31_60, aging_61_90, aging_91_120,
  aging_120_plus, debt_age, monthly_avg_collection
)
select y.code, y.name, y.region, y.year,
       y.net, y.collected, 0, 0, 0, 0, 0, 'جاري', 0
from (values
  ('C001', 'عميل الرياض 1', 'الرياض', 2024, 40000, 38000),
  ('C001', 'عميل الرياض 1', 'الرياض', 2025, 52000, 50000),
  ('C002', 'عميل الرياض 2', 'الرياض', 2024, 12000, 11000),
  ('C002', 'عميل الرياض 2', 'الرياض', 2025, 9000,  8500),
  ('C003', 'عميل جدة 1',    'جدة',   2024, 60000, 55000),
  ('C003', 'عميل جدة 1',    'جدة',   2025, 72000, 70000),
  ('C004', 'عميل جدة 2',    'جدة',   2025, 3000,  2500)
) as y(code, name, region, year, net, collected)
on conflict (customer_code, year, region_name) do nothing;

-- ---------- Link user_roles by email (auth users must already exist) ----------
-- Admin
insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'admin', null, null from auth.users u
where u.email = 'admin@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

-- Data entry
insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'data_entry', null, null from auth.users u
where u.email = 'data@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

-- Supervisors
insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'supervisor', (select id from supervisors where name = 'مشرف الرياض'), null
from auth.users u where u.email = 'supA@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'supervisor', (select id from supervisors where name = 'مشرف جدة'), null
from auth.users u where u.email = 'supB@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

-- Reps
insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'rep', null, (select id from representatives where name = 'مندوب اختبار 1')
from auth.users u where u.email = 'rep1@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

insert into user_roles (user_id, role, supervisor_id, rep_id)
select u.id, 'rep', null, (select id from representatives where name = 'مندوب اختبار 3')
from auth.users u where u.email = 'rep3@staging.test'
  and not exists (select 1 from user_roles r where r.user_id = u.id);

-- NOTE: norole@staging.test is intentionally left WITHOUT a user_roles row
-- (BUG-004 fail-closed test).

commit;

-- Quick sanity check (run as service role):
--   select 'regions' t, count(*) from regions
--   union all select 'reps', count(*) from representatives
--   union all select 'customers', count(*) from customers
--   union all select 'daily_entries', count(*) from daily_entries
--   union all select 'targets', count(*) from monthly_targets
--   union all select 'yearly', count(*) from customer_yearly_sales
--   union all select 'user_roles', count(*) from user_roles;
