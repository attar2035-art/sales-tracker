-- Free-form supervisor visits: the customer is now typed in by hand, plus
-- address / contact / rep fields. customer_id becomes optional (legacy link).
alter table public.supervisor_visits
  alter column customer_id drop not null;

alter table public.supervisor_visits
  add column if not exists customer_name   text,
  add column if not exists contact_person  text,
  add column if not exists city            text,
  add column if not exists neighborhood    text,
  add column if not exists street          text,
  add column if not exists rep_name        text,
  add column if not exists attachment_path text;

-- NOTE: the send-visit-report edge function reads the Resend API key from a
-- locked-down public.app_secrets table (RLS enabled, no policies => service
-- role only). That table and its secret value are provisioned directly on the
-- production project and are intentionally NOT committed here, so the key never
-- lands in this public repository.
