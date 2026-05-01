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
