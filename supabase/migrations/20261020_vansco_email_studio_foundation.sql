-- Isolated Vansco marketing foundation. Additive only.
-- Transactional CRM mail, VFC marketing tables and existing worker schedules are untouched.
create extension if not exists pgcrypto;

create table if not exists public.marketing_vansco_email_master (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_vansco_email_contacts (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique
    check (email_normalized = lower(trim(email_normalized)) and position('@' in email_normalized) > 1),
  first_name text not null default '',
  last_name text not null default '',
  source text not null,
  marketing_basis text not null check (marketing_basis in ('consent', 'legitimate_interest')),
  status text not null default 'pending_review'
    check (status in ('pending_review','ready','suppressed')),
  suppression_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_vansco_email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  theme text not null check (theme in ('standard','halloween','black_friday','christmas')),
  subject text not null check (length(trim(subject)) > 0),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  selected_vehicles jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_vehicles) = 'array'),
  status text not null default 'draft' check (status in ('draft','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_vansco_email_contacts_status_idx
  on public.marketing_vansco_email_contacts(status);
create index if not exists marketing_vansco_email_campaigns_created_idx
  on public.marketing_vansco_email_campaigns(created_at desc);

alter table public.marketing_vansco_email_master enable row level security;
alter table public.marketing_vansco_email_contacts enable row level security;
alter table public.marketing_vansco_email_campaigns enable row level security;

revoke all on public.marketing_vansco_email_master from anon, authenticated;
revoke all on public.marketing_vansco_email_contacts from anon, authenticated;
revoke all on public.marketing_vansco_email_campaigns from anon, authenticated;
grant select, insert, update on public.marketing_vansco_email_master to service_role;
grant select, insert, update on public.marketing_vansco_email_contacts to service_role;
grant select, insert, update on public.marketing_vansco_email_campaigns to service_role;

-- There is intentionally NO Vansco bulk-send SQL or job in this foundation.
-- Email delivery will be enabled only after brand-audience isolation and provider events are verified.
