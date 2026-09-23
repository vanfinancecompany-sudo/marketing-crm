create table if not exists public.facebook_group_state (
  group_key text primary key,
  group_url text,
  group_name text,
  finance boolean not null default true,
  rent2buy boolean not null default true,
  state jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists facebook_group_state_updated_at_idx
  on public.facebook_group_state (updated_at desc);

create index if not exists facebook_group_state_products_idx
  on public.facebook_group_state (finance, rent2buy);

alter table public.facebook_group_state enable row level security;

revoke all on table public.facebook_group_state from anon, authenticated;
grant select, insert, update on table public.facebook_group_state to service_role;
