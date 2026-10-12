-- Private Vansco Vehicle Ads selection overlay for the DealerKit GVA feed.
-- No public read/write access. The Marketing CRM API uses server-only service credentials.
create table if not exists public.vansco_google_vehicle_ads_selection (
  id text primary key check (id = 'vansco'),
  mode text not null default 'all' check (mode in ('all', 'selected')),
  selected_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.vansco_google_vehicle_ads_selection enable row level security;

comment on table public.vansco_google_vehicle_ads_selection is
  'Vehicle Ads filter overlay. Mode all leaves DealerKit feed unchanged; selected limits feed to saved Google vehicle ids.';
