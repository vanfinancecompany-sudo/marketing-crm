-- REVIEW-ONLY SCHEMA PROPOSAL. DO NOT RUN against production yet.
-- Dedicated overrides keep commercial specials outside derived DealerKit review settings.
-- Privileged access only; no public/authenticated Data API grants or policies.

create table if not exists public.dealerkit_rent2buy_special_deals (
  id uuid primary key default gen_random_uuid(),
  supplier_stock_id text not null unique,
  registration text not null unique,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  monthly_ex_vat numeric(12,2) not null check (monthly_ex_vat > 0),
  initial_ex_vat numeric(12,2) not null check (initial_ex_vat >= 1000),
  term_months integer not null check (term_months in (12,18,24,30,36,42,48)),
  miles_per_month integer not null check (miles_per_month in (1000,1500,2000,2500,3000,3500,4000)),
  source_retail_amount numeric(12,2) not null,
  source_vat_status text not null default 'unknown',
  source_updated_at text,
  reason text not null check (length(trim(reason)) >= 10),
  expires_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.dealerkit_rent2buy_special_deals enable row level security;
revoke all on public.dealerkit_rent2buy_special_deals from anon, authenticated;
grant select, insert, update on public.dealerkit_rent2buy_special_deals to service_role;

create table if not exists public.dealerkit_rent2buy_special_deal_audit (
  id bigint generated always as identity primary key,
  special_deal_id uuid not null,
  registration text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_row jsonb,
  after_row jsonb,
  logged_at timestamptz not null default now()
);
alter table public.dealerkit_rent2buy_special_deal_audit enable row level security;
revoke all on public.dealerkit_rent2buy_special_deal_audit from anon, authenticated;
grant select, insert on public.dealerkit_rent2buy_special_deal_audit to service_role;

-- Standard invoker-rights trigger (no SECURITY DEFINER) logs every change.
-- Review function privileges with the DBA before applying.
create or replace function public.audit_rent2buy_special_deal()
returns trigger language plpgsql security invoker
set search_path = ''
as $$
begin
  insert into public.dealerkit_rent2buy_special_deal_audit
    (special_deal_id, registration, operation, before_row, after_row)
  values
    (coalesce(new.id, old.id),
     coalesce(new.registration, old.registration),
     tg_op,
     case when tg_op <> 'INSERT' then to_jsonb(old) else null end,
     case when tg_op <> 'DELETE' then to_jsonb(new) else null end);
  return coalesce(new, old);
end
$$;
revoke all on function public.audit_rent2buy_special_deal() from public, anon, authenticated;
grant execute on function public.audit_rent2buy_special_deal() to service_role;

drop trigger if exists dealerkit_rent2buy_special_deals_audit on public.dealerkit_rent2buy_special_deals;
create trigger dealerkit_rent2buy_special_deals_audit
after insert or update or delete on public.dealerkit_rent2buy_special_deals
for each row execute function public.audit_rent2buy_special_deal();

comment on table public.dealerkit_rent2buy_special_deals is
'Server-controlled special Rent2Buy pricing. Saving draft does not publish; approval separate.';
