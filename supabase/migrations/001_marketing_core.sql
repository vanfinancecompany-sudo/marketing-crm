-- Marketing CRM Phase 4 core schema
-- Additive only: does not modify existing CRM tables.

create extension if not exists pgcrypto;

create table if not exists public.marketing_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null unique,
  first_name text not null default '',
  last_name text not null default '',
  company text not null default '',
  email text,
  email_normalized text,
  phone text,
  phone_normalized text,
  postcode text not null default '',
  pipeline text not null default 'unknown'
    check (pipeline in ('finance', 'rent2buy', 'both', 'unknown')),
  source text not null default 'other',
  sources text[] not null default '{}',
  tags text[] not null default '{}',
  notes text not null default '',
  marketing_status text not null default 'active'
    check (marketing_status in ('active', 'unsubscribed', 'suppressed')),
  email_ready boolean not null default false,
  sms_ready boolean not null default false,
  facebook_ready boolean not null default false,
  duplicate_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_imports (
  id uuid primary key default gen_random_uuid(),
  filename text,
  source text not null default 'csv',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  rows_imported integer not null default 0,
  contacts_created integer not null default 0,
  contacts_updated integer not null default 0,
  duplicates_merged integer not null default 0,
  possible_duplicates integer not null default 0,
  rejected_rows integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.marketing_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.marketing_imports(id) on delete cascade,
  source_row integer,
  customer_id text,
  status text not null default 'processed',
  rejection_reason text,
  raw_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_merge_log (
  id uuid primary key default gen_random_uuid(),
  primary_contact_id uuid not null references public.marketing_contacts(id) on delete cascade,
  merged_contact_id uuid,
  merge_reason text not null,
  matched_on text,
  merged_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null,
  audience_name text,
  pipeline text,
  filters jsonb not null default '{}'::jsonb,
  contact_count integer not null default 0,
  filename text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.marketing_saved_audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  filters jsonb not null default '{}'::jsonb,
  estimated_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_marketing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_contacts_set_updated_at on public.marketing_contacts;
create trigger marketing_contacts_set_updated_at
before update on public.marketing_contacts
for each row execute function public.set_marketing_updated_at();

drop trigger if exists marketing_saved_audiences_set_updated_at on public.marketing_saved_audiences;
create trigger marketing_saved_audiences_set_updated_at
before update on public.marketing_saved_audiences
for each row execute function public.set_marketing_updated_at();
