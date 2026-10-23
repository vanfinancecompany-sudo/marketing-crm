-- REVIEW ONLY. DO NOT APPLY TO LIVE SUPABASE YET.
-- Immutable, complete, source-verified DealerKit snapshots for Rent2Buy quote checks.
-- The existing Stock Watch refresh may optionally insert ONE complete manifest
-- behind RENT2BUY_QUOTE_SNAPSHOT_CAPTURE_ENABLED. Quote requests are READ ONLY.
create table if not exists public.dealerkit_rent2buy_quote_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_checked_at timestamptz not null unique,
  captured_at timestamptz not null default now(),
  stock_count integer not null check (stock_count between 1 and 2000),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{64}$'),
  vehicle_manifest jsonb not null check (jsonb_typeof(vehicle_manifest) = 'array'),
  constraint manifest_count_consistent check (jsonb_array_length(vehicle_manifest) = stock_count)
);
create index if not exists dealerkit_rent2buy_quote_snapshots_latest_idx
  on public.dealerkit_rent2buy_quote_snapshots (snapshot_checked_at desc);
alter table public.dealerkit_rent2buy_quote_snapshots enable row level security;
revoke all on public.dealerkit_rent2buy_quote_snapshots from anon, authenticated;
grant select, insert on public.dealerkit_rent2buy_quote_snapshots to service_role;
-- No UPDATE or DELETE grants to application roles. Old rows need an independently
-- reviewed retention policy before any cleanup job is enabled.
comment on table public.dealerkit_rent2buy_quote_snapshots is
'Immutable complete DealerKit stock manifest; a fresh valid row must exist for Rent2Buy quote verification. Not last-known stock state.';
