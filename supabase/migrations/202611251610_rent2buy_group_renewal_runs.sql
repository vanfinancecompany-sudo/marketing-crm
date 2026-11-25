-- Rent2Buy Facebook group renewals. Never changes facebook_group_state.
create table if not exists public.rent2buy_group_renewal_runs (
  run_date date primary key,                     -- one run per London day (duplicate-run protection)
  checked_at timestamptz not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  outcomes jsonb not null default '{}'::jsonb check (jsonb_typeof(outcomes) = 'object'),  -- skipped/failed/needs_attention per group
  stopped jsonb                                  -- account restriction / security challenge: day stopped
);
create table if not exists public.rent2buy_group_renewal_settings (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  max_daily integer not null default 30 check (max_daily between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into public.rent2buy_group_renewal_settings (id) values (1) on conflict (id) do nothing;
alter table public.rent2buy_group_renewal_runs enable row level security;
alter table public.rent2buy_group_renewal_settings enable row level security;
revoke all on public.rent2buy_group_renewal_runs from public, anon, authenticated;
revoke all on public.rent2buy_group_renewal_settings from public, anon, authenticated;
grant select, insert, update on public.rent2buy_group_renewal_runs to service_role;
grant select, insert, update on public.rent2buy_group_renewal_settings to service_role;
