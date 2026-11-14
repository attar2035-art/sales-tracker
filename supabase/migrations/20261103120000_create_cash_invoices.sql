-- فواتير نقدية: المندوب يحصّلها كاش، تُحوَّل له عمولة 5% لحظيًا تُخصم آخر الشهر
-- من إجمالي عمولاته. تُدخلها أميرة (data_entry) يوميًا؛ وتُستخدم كمرجع عند المرتجع.
create table if not exists public.cash_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_date date not null,
  rep_id uuid not null references public.representatives(id),
  customer_id uuid not null references public.customers(id),
  invoice_number text not null,
  amount numeric not null check (amount >= 0),
  -- العمولة ثابتة 5% غير قابلة للتعديل (محسوبة على مستوى قاعدة البيانات).
  commission_amount numeric generated always as (round(amount * 0.05, 2)) stored,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cash_invoices_rep_date on public.cash_invoices (rep_id, invoice_date);
create index if not exists idx_cash_invoices_date on public.cash_invoices (invoice_date);
create index if not exists idx_cash_invoices_invnum on public.cash_invoices (invoice_number);
create index if not exists idx_cash_invoices_customer on public.cash_invoices (customer_id);

alter table public.cash_invoices enable row level security;

-- قراءة: الأدمن/مدخل البيانات/المدير على مستوى الشركة، المشرف لمناديبه، المندوب لنفسه.
create policy "cash invoices read" on public.cash_invoices for select
using (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry','manager']))
  or exists (select 1 from user_roles ur
             join representatives rep on rep.supervisor_id = ur.supervisor_id
             where ur.user_id = auth.uid() and ur.role = 'supervisor'
               and rep.id = cash_invoices.rep_id)
  or exists (select 1 from user_roles ur where ur.user_id = auth.uid()
             and ur.role = 'rep' and ur.rep_id = cash_invoices.rep_id)
);

-- إدخال/تعديل/حذف: الأدمن ومدخل البيانات فقط.
create policy "cash invoices insert" on public.cash_invoices for insert
with check (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
);
create policy "cash invoices update" on public.cash_invoices for update
using (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
)
with check (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
);
create policy "cash invoices delete" on public.cash_invoices for delete
using (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
);
