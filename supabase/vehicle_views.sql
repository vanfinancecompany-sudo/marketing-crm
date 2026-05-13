create table if not exists public.vehicle_views (
  id uuid primary key default gen_random_uuid(),
  registration text not null,
  source text,
  viewed_at timestamptz not null default now()
);

alter table public.vehicle_views enable row level security;

create policy if not exists "Allow anon insert vehicle views"
  on public.vehicle_views
  for insert
  to anon
  with check (registration is not null and registration <> '');

create policy if not exists "Allow anon read vehicle views"
  on public.vehicle_views
  for select
  to anon
  using (true);

create index if not exists vehicle_views_viewed_at_idx
  on public.vehicle_views (viewed_at desc);

create index if not exists vehicle_views_registration_viewed_at_idx
  on public.vehicle_views (registration, viewed_at desc);
