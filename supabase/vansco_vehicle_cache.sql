create extension if not exists pgcrypto;

create table if not exists public.vansco_vehicle_cache (
  id uuid primary key default gen_random_uuid(),
  stock_url text not null unique,
  vansco_id text,
  registration text,
  title text,
  image_url text,
  source_status text not null default 'unknown',
  vehicle_type text not null default 'unknown',
  first_seen_at timestamptz not null default now(),
  last_seen_in_url_list_at timestamptz,
  last_successfully_checked_at timestamptz,
  last_attempted_at timestamptz,
  attempt_count integer not null default 0,
  fail_count integer not null default 0,
  last_error text,
  is_currently_on_vansco boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint vansco_vehicle_cache_source_status_check check (source_status in ('available', 'reserved', 'sold', 'deposit_taken', 'unknown')),
  constraint vansco_vehicle_cache_vehicle_type_check check (vehicle_type in ('van', 'car', 'unknown'))
);

create index if not exists vansco_vehicle_cache_registration_idx on public.vansco_vehicle_cache (registration);
create index if not exists vansco_vehicle_cache_vansco_id_idx on public.vansco_vehicle_cache (vansco_id);
create index if not exists vansco_vehicle_cache_current_idx on public.vansco_vehicle_cache (is_currently_on_vansco);
create index if not exists vansco_vehicle_cache_last_success_idx on public.vansco_vehicle_cache (last_successfully_checked_at);
create index if not exists vansco_vehicle_cache_priority_idx on public.vansco_vehicle_cache (is_currently_on_vansco, registration, fail_count, last_successfully_checked_at);

alter table public.vansco_vehicle_cache enable row level security;

create policy if not exists "Allow anon read Vansco cache"
  on public.vansco_vehicle_cache
  for select
  to anon, authenticated
  using (true);

-- Writes should go through Marketing CRM API routes using the service role key.
-- If Supabase policy syntax on your project does not support IF NOT EXISTS for policies,
-- create the table first, then add equivalent read policy manually in Supabase SQL editor.
