-- Supervisor's rating of the customer's category during a visit
-- (VIP / ممتاز / جيد / متوسط / ضعيف جداً).
alter table public.supervisor_visits
  add column if not exists customer_rating text;
