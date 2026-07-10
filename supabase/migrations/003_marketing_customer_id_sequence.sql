-- Marketing CRM Phase 4 customer ID allocator and import hardening
-- Additive marketing-only migration. Does not modify existing CRM tables.

create sequence if not exists public.marketing_customer_id_seq;

select setval(
  'public.marketing_customer_id_seq',
  greatest(
    coalesce((
      select max((substring(customer_id from 4))::integer)
      from public.marketing_contacts
      where customer_id ~ '^VFC[0-9]+$'
    ), 0),
    coalesce((select last_value from public.marketing_customer_id_seq), 1)
  ),
  true
);

create or replace function public.next_marketing_customer_id()
returns text
language sql
as $$
  select 'VFC' || lpad(nextval('public.marketing_customer_id_seq')::text, 6, '0');
$$;

alter table public.marketing_imports
  add column if not exists duration_seconds integer;

alter table public.marketing_imports
  drop constraint if exists marketing_imports_status_check;

alter table public.marketing_imports
  add constraint marketing_imports_status_check
  check (status in ('pending', 'processing', 'completed', 'failed', 'partially_failed'));

create index if not exists marketing_imports_fingerprint_idx
  on public.marketing_imports ((metadata->>'import_fingerprint'));
