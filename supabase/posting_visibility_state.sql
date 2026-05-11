create table if not exists public.posting_visibility_state (
  page_key text primary key,
  hidden_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.posting_visibility_state enable row level security;

create policy if not exists "Allow anon read posting visibility state"
  on public.posting_visibility_state
  for select
  to anon
  using (true);

create policy if not exists "Allow anon upsert posting visibility state"
  on public.posting_visibility_state
  for insert
  to anon
  with check (page_key in ('vanFinanceFacebook', 'rent2BuyFacebook', 'marketplace'));

create policy if not exists "Allow anon update posting visibility state"
  on public.posting_visibility_state
  for update
  to anon
  using (page_key in ('vanFinanceFacebook', 'rent2BuyFacebook', 'marketplace'))
  with check (page_key in ('vanFinanceFacebook', 'rent2BuyFacebook', 'marketplace'));

insert into public.posting_visibility_state (page_key, hidden_ids)
values
  ('vanFinanceFacebook', '[]'::jsonb),
  ('rent2BuyFacebook', '[]'::jsonb),
  ('marketplace', '[]'::jsonb)
on conflict (page_key) do nothing;
