create table if not exists public.site_live_sessions (
  session_id text primary key,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.site_live_sessions enable row level security;

create policy if not exists "Allow anon upsert live sessions"
  on public.site_live_sessions
  for insert
  to anon
  with check (session_id is not null and session_id <> '');

create policy if not exists "Allow anon update live sessions"
  on public.site_live_sessions
  for update
  to anon
  using (session_id is not null and session_id <> '')
  with check (session_id is not null and session_id <> '');

create policy if not exists "Allow anon read live sessions"
  on public.site_live_sessions
  for select
  to anon
  using (true);

create index if not exists site_live_sessions_last_seen_at_idx
  on public.site_live_sessions (last_seen_at desc);
