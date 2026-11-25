-- Independent, read-only daily planning snapshots. Never changes group records.
create table if not exists public.rent2buy_group_renewal_runs (
  run_date date primary key,
  checked_at timestamptz not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object')
);
alter table public.rent2buy_group_renewal_runs enable row level security;
revoke all on public.rent2buy_group_renewal_runs from public, anon, authenticated;
grant select, insert on public.rent2buy_group_renewal_runs to service_role;
