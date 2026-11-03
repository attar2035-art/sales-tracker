-- توسعة الفواتير النقدية: تخزين الإجمالي شامل الضريبة ومرجع الملف، وجدول الأصناف.
-- amount = صافي البيع قبل الضريبة (العمولة 5% محسوبة عليه عبر commission_amount).
alter table public.cash_invoices
  add column if not exists amount_with_vat numeric,
  add column if not exists source_file_path text,
  add column if not exists source_file_name text,
  add column if not exists extracted_meta jsonb;

create table if not exists public.cash_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.cash_invoices(id) on delete cascade,
  line_no int,
  item_code text,
  item_name text,
  unit text,
  quantity numeric,
  unit_price numeric,          -- السعر بعد الخصم (قبل الضريبة، للوحدة)
  discount numeric,
  vat_per_unit numeric,
  price_with_vat numeric,      -- السعر شامل الضريبة (للوحدة)
  line_total numeric,          -- quantity * unit_price (قبل الضريبة)
  line_total_with_vat numeric, -- quantity * price_with_vat
  created_at timestamptz not null default now()
);
create index if not exists idx_cash_invoice_items_invoice on public.cash_invoice_items (invoice_id);

alter table public.cash_invoice_items enable row level security;

create policy "cash invoice items read" on public.cash_invoice_items for select
using (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry','manager']))
  or exists (
    select 1 from cash_invoices ci
    join user_roles ur on ur.user_id = auth.uid()
    join representatives rep on rep.supervisor_id = ur.supervisor_id
    where ci.id = cash_invoice_items.invoice_id and ur.role = 'supervisor' and rep.id = ci.rep_id)
  or exists (
    select 1 from cash_invoices ci
    join user_roles ur on ur.user_id = auth.uid()
    where ci.id = cash_invoice_items.invoice_id and ur.role = 'rep' and ur.rep_id = ci.rep_id)
);

create policy "cash invoice items write" on public.cash_invoice_items for all
using (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
)
with check (
  exists (select 1 from user_roles ur where ur.user_id = auth.uid()
          and ur.role = any (array['admin','data_entry']))
);

-- حاوية تخزين ملفات الفواتير (خاصة).
insert into storage.buckets (id, name, public)
values ('cash-invoices', 'cash-invoices', false)
on conflict (id) do nothing;

create policy "cash files insert" on storage.objects for insert
with check (
  bucket_id = 'cash-invoices' and exists (
    select 1 from user_roles ur where ur.user_id = auth.uid()
    and ur.role = any (array['admin','data_entry']))
);
create policy "cash files read" on storage.objects for select
using (
  bucket_id = 'cash-invoices' and exists (
    select 1 from user_roles ur where ur.user_id = auth.uid()
    and ur.role = any (array['admin','data_entry','manager']))
);
create policy "cash files update" on storage.objects for update
using (
  bucket_id = 'cash-invoices' and exists (
    select 1 from user_roles ur where ur.user_id = auth.uid()
    and ur.role = any (array['admin','data_entry']))
);
create policy "cash files delete" on storage.objects for delete
using (
  bucket_id = 'cash-invoices' and exists (
    select 1 from user_roles ur where ur.user_id = auth.uid()
    and ur.role = any (array['admin','data_entry']))
);
