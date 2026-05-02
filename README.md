# Marketing CRM

## Reel Factory Vehicle Cooldown

Reel Factory uses the `reel_vehicle_usage` metadata table to avoid reusing the same Finance or Rent2Buy vehicle for 5 days when generating reels. Finance and Rent2Buy cooldowns are tracked separately. This does not hide, delete, or modify stock records.

Run this SQL in the Marketing CRM Supabase project:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.reel_vehicle_usage (
  id uuid primary key default gen_random_uuid(),
  reel_type text not null check (reel_type in ('finance', 'rent2buy')),
  vehicle_key text not null,
  registration text,
  vehicle_title text,
  used_at timestamptz not null default now(),
  source text default 'generate'
);

create index if not exists reel_vehicle_usage_type_used_idx
on public.reel_vehicle_usage(reel_type, used_at desc);

create index if not exists reel_vehicle_usage_type_vehicle_used_idx
on public.reel_vehicle_usage(reel_type, vehicle_key, used_at desc);
```

If the table is missing, Reel Factory will still generate reels but will show a setup warning and skip cooldown tracking until the SQL is applied.

## Vansco Stock Watch

`Vansco Stock Watch` is a manual checking tool only.

It:
- checks `https://www.vansco.co.uk/all-stock/` only when a user clicks `Check Vansco Stock`
- compares Vansco vehicles against separate Marketing CRM stock groups for:
  - Finance Vans
  - Rent2Buy Vans
  - Cars
- stores watch metadata and workflow decisions in Supabase

It does **not**:
- auto-run on a timer
- auto-add vehicles to CRM
- auto-remove vehicles from CRM
- auto-publish to Wix
- auto-post to Facebook
- auto-edit existing stock rows

### Supabase SQL

```sql
create table if not exists public.vansco_stock_watch (
  id uuid primary key default gen_random_uuid(),
  pipeline text not null check (pipeline in ('finance', 'rent2buy', 'cars')),
  vehicle_key text not null,
  title text,
  registration text,
  image_url text,
  stock_url text not null,
  price text,
  mileage text,
  year text,
  vehicle_category text,
  source_status text not null default 'unknown'
    check (source_status in ('available', 'reserved', 'sold', 'deposit_taken', 'unknown')),
  match_status text not null default 'missing'
    check (match_status in ('missing', 'listed', 'needs_review', 'no_longer_on_vansco', 'reserved_still_listed')),
  workflow_status text not null default 'new'
    check (
      workflow_status in (
        'new',
        'review_later',
        'added_to_crm',
        'added_to_wix',
        'removed_from_crm',
        'removed_from_wix',
        'keep_listed',
        'not_listing_mileage',
        'not_listing_price',
        'not_listing_spec',
        'ignored'
      )
    ),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_checked_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline, vehicle_key)
);

create index if not exists vansco_stock_watch_pipeline_idx
  on public.vansco_stock_watch (pipeline);

create index if not exists vansco_stock_watch_match_status_idx
  on public.vansco_stock_watch (match_status);

create index if not exists vansco_stock_watch_workflow_status_idx
  on public.vansco_stock_watch (workflow_status);

create index if not exists vansco_stock_watch_source_status_idx
  on public.vansco_stock_watch (source_status);

create index if not exists vansco_stock_watch_first_seen_desc_idx
  on public.vansco_stock_watch (first_seen_at desc);

create index if not exists vansco_stock_watch_pipeline_used_idx
  on public.vansco_stock_watch (pipeline, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vansco_stock_watch_updated_at on public.vansco_stock_watch;

create trigger vansco_stock_watch_updated_at
before update on public.vansco_stock_watch
for each row execute function public.set_updated_at();
```

If the table already exists, update the `match_status` constraint to allow `needs_review`:

```sql
alter table public.vansco_stock_watch
  drop constraint if exists vansco_stock_watch_match_status_check;

alter table public.vansco_stock_watch
  add constraint vansco_stock_watch_match_status_check
  check (match_status in ('missing', 'listed', 'needs_review', 'no_longer_on_vansco', 'reserved_still_listed'));
```

### Safety note

`No longer on Vansco` is now intentionally conservative and high-confidence only.

- it requires a valid CRM registration
- it requires a complete enough Vansco registration set
- it requires high registration confidence from the manual scan

If that confidence is not high enough, the record is stored as `needs_review` with:

`Cannot safely verify removal. Review manually.`

### Cars stock table note

The Finance and Rent2Buy checks use the existing app tables:
- `facebook_adverts`
- `rent_vehicles`

The Cars tab tries these table names in order:
- `cars_stock`
- `car_stock`
- `cars`
- `car_vehicles`

If your cars stock uses a different table name, update the candidate list in:

`services/vanscoStockWatch.js`
