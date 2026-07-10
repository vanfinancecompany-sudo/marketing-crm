-- Marketing CRM Phase 4 customer ID allocator and import hardening
-- Additive marketing-only migration. Does not modify existing CRM tables.

create sequence if not exists public.marketing_customer_id_seq;

do $$
declare
  max_customer_number integer;
  sequence_last_value bigint;
  sequence_called boolean;
  sequence_seed bigint;
begin
  select coalesce(max((substring(customer_id from 4))::integer), 0)
  into max_customer_number
  from public.marketing_contacts
  where customer_id ~ '^VFC[0-9]+$';

  select last_value, is_called
  into sequence_last_value, sequence_called
  from public.marketing_customer_id_seq;

  sequence_seed := greatest(max_customer_number, case when sequence_called then sequence_last_value else 0 end);

  if sequence_seed < 1 then
    perform setval('public.marketing_customer_id_seq', 1, false);
  else
    perform setval('public.marketing_customer_id_seq', sequence_seed, true);
  end if;
end $$;

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
