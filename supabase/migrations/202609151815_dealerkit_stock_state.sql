-- DealerKit registration-first source memory.
--
-- This table is deliberately separate from operator Stock Watch decisions and
-- monitor telemetry. It stores the last positively observed DealerKit identity
-- for each registration so a known vehicle can still be resolved if a later
-- DealerKit workflow removes it from /integrators/stock.

create table if not exists public.dealerkit_stock_state (
  registration text primary key,
  supplier_stock_id text not null,
  last_status text not null default 'unknown',
  source_status text not null default 'unknown',
  title text,
  source_url text,
  image_url text,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  vehicle_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists dealerkit_stock_state_supplier_id_idx
  on public.dealerkit_stock_state (supplier_stock_id);

create index if not exists dealerkit_stock_state_last_seen_idx
  on public.dealerkit_stock_state (last_seen_at desc);

alter table public.dealerkit_stock_state enable row level security;

comment on table public.dealerkit_stock_state is
  'Server-only last-known DealerKit identity/state keyed by normalized vehicle registration. Used to resolve stock lifecycle transitions without treating an incomplete bulk feed as proof of absence.';

-- Seed the state table from the DealerKit observations already captured by the
-- Stock Watch monitor. This makes previously seen registrations such as AF71TVY
-- resolvable immediately after the migration rather than waiting for a new poll.
with observed as (
  select
    regexp_replace(upper(coalesce(vehicle ->> 'registration', '')), '[^A-Z0-9]', '', 'g') as registration,
    coalesce(vehicle ->> 'supplierStockId', '') as supplier_stock_id,
    coalesce(
      nullif(lower(vehicle ->> 'status'), ''),
      nullif(lower(vehicle ->> 'availability'), ''),
      nullif(lower(vehicle ->> 'sourceStatus'), ''),
      'unknown'
    ) as last_status,
    coalesce(nullif(vehicle ->> 'sourceStatus', ''), nullif(vehicle ->> 'status', ''), 'unknown') as source_status,
    nullif(vehicle ->> 'title', '') as title,
    nullif(vehicle ->> 'sourceUrl', '') as source_url,
    nullif(vehicle #>> '{primaryImage,url}', '') as image_url,
    nullif(vehicle ->> 'sourceUpdatedAt', '')::timestamptz as source_updated_at,
    coalesce(run.completed_at, run.started_at, now()) as seen_at,
    vehicle as vehicle_snapshot
  from public.stock_watch_monitor_runs run
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(run.snapshot -> 'provider' -> 'vehicles') = 'array'
        then run.snapshot -> 'provider' -> 'vehicles'
      else '[]'::jsonb
    end
  ) as vehicle
  where run.provider_id = 'dealerkit'
    and coalesce(vehicle ->> 'registration', '') <> ''
    and coalesce(vehicle ->> 'supplierStockId', '') <> ''
),
ranked as (
  select
    observed.*,
    min(seen_at) over (partition by registration) as first_seen_at,
    row_number() over (partition by registration order by seen_at desc) as recency_rank
  from observed
  where registration <> ''
),
latest as (
  select * from ranked where recency_rank = 1
)
insert into public.dealerkit_stock_state (
  registration,
  supplier_stock_id,
  last_status,
  source_status,
  title,
  source_url,
  image_url,
  source_updated_at,
  first_seen_at,
  last_seen_at,
  vehicle_snapshot,
  updated_at
)
select
  registration,
  supplier_stock_id,
  last_status,
  source_status,
  title,
  source_url,
  image_url,
  source_updated_at,
  first_seen_at,
  seen_at,
  vehicle_snapshot,
  seen_at
from latest
on conflict (registration) do update set
  supplier_stock_id = excluded.supplier_stock_id,
  last_status = excluded.last_status,
  source_status = excluded.source_status,
  title = excluded.title,
  source_url = excluded.source_url,
  image_url = excluded.image_url,
  source_updated_at = excluded.source_updated_at,
  first_seen_at = least(public.dealerkit_stock_state.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(public.dealerkit_stock_state.last_seen_at, excluded.last_seen_at),
  vehicle_snapshot = excluded.vehicle_snapshot,
  updated_at = greatest(public.dealerkit_stock_state.updated_at, excluded.updated_at)
where excluded.last_seen_at >= public.dealerkit_stock_state.last_seen_at;

-- No browser policies are intentionally created. The service-role Marketing CRM
-- API is the only reader/writer for this source-memory table.
