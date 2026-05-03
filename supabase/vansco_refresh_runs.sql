create extension if not exists pgcrypto;

create table if not exists public.vansco_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'manual',
  status text not null default 'running',
  stage text not null default 'starting',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  total_urls integer not null default 0,
  processed_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  remaining_count integer,
  last_batch_size integer,
  last_error text,
  detail_host_preference text not null default 'dragon-first',
  last_result jsonb,
  constraint vansco_refresh_runs_status_check check (status in ('running', 'complete', 'failed', 'paused')),
  constraint vansco_refresh_runs_type_check check (run_type in ('manual', 'scheduled', 'runner', 'unknown'))
);

create index if not exists vansco_refresh_runs_status_idx on public.vansco_refresh_runs (status);
create index if not exists vansco_refresh_runs_started_idx on public.vansco_refresh_runs (started_at desc);
create index if not exists vansco_refresh_runs_updated_idx on public.vansco_refresh_runs (updated_at desc);

alter table public.vansco_refresh_runs enable row level security;

drop policy if exists "Allow anon read Vansco refresh runs" on public.vansco_refresh_runs;
create policy "Allow anon read Vansco refresh runs"
  on public.vansco_refresh_runs
  for select
  to anon, authenticated
  using (true);

-- Writes should go through Marketing CRM API routes using the Supabase service role key.
