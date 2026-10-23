-- REVIEW-ONLY proposal, NOT a production migration. No action taken in Supabase.
-- A price basis must be individually reviewed before Felix matrix quotes can be issued.
-- Dedicated from DealerKit stock review to avoid automatic writes/upsert overwrites.
create table if not exists public.dealerkit_rent2buy_retail_approvals (
  supplier_stock_id text primary key,
  registration text not null,
  status text not null default 'draft' check (status in ('draft','approved','revoked')),
  source_retail_amount numeric(12,2) not null check (source_retail_amount > 0),
  source_vat_status text not null check (source_vat_status in ('plus_vat','inc_vat','no_vat')),
  source_updated_at text not null,
  approved_retail_ex_vat numeric(12,2) not null check (approved_retail_ex_vat > 0),
  allowed_terms integer[] not null default '{}',
  revision integer not null default 1 check (revision >= 1),
  approved_by text,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint contract_terms_nonempty_when_approved
    check (status <> 'approved' or (
      cardinality(allowed_terms) > 0
      and approved_by is not null and length(trim(approved_by)) > 0
      and approved_at is not null
    ))
);
alter table public.dealerkit_rent2buy_retail_approvals enable row level security;
revoke all on public.dealerkit_rent2buy_retail_approvals from anon, authenticated;
grant select on public.dealerkit_rent2buy_retail_approvals to service_role;
-- No application-facing write grant. Explicit audited approval flow is still to be designed.
comment on table public.dealerkit_rent2buy_retail_approvals is
'Proposed approved EX-VAT retail basis and contract terms for matrix quoting. No automatic DealerKit writes.';
