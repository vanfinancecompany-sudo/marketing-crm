-- Stock Watch Monitor Agent
-- Provider-agnostic monitoring, persistent incident history, and trace logging.

create extension if not exists pgcrypto;

create table if not exists public.stock_watch_action_logs (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  pipeline text not null,
  action text not null,
  registration text,
  authority text,
  site_id text,
  status text not null default 'started',
  http_status integer,
  duration_ms integer,
  matched_records integer,
  changed_records integer,
  failure_count integer,
  result jsonb,
  error text
);

create index if not exists stock_watch_action_logs_created_idx on public.stock_watch_action_logs(created_at desc);
create index if not exists stock_watch_action_logs_pipeline_idx on public.stock_watch_action_logs(pipeline, created_at desc);
create index if not exists stock_watch_action_logs_registration_idx on public.stock_watch_action_logs(registration, created_at desc);
create index if not exists stock_watch_action_logs_trace_idx on public.stock_watch_action_logs(trace_id);

create table if not exists public.stock_watch_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  health text not null default 'unknown',
  provider_id text not null,
  provider_label text,
  issue_count integer not null default 0,
  warning_count integer not null default 0,
  critical_count integer not null default 0,
  ai_used boolean not null default false,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  snapshot jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists stock_watch_monitor_runs_started_idx on public.stock_watch_monitor_runs(started_at desc);
create index if not exists stock_watch_monitor_runs_health_idx on public.stock_watch_monitor_runs(health, started_at desc);

create table if not exists public.stock_watch_monitor_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  status text not null default 'open',
  occurrences integer not null default 1,
  pipeline text,
  severity text not null,
  code text not null,
  title text not null,
  evidence jsonb not null default '{}'::jsonb,
  likely_cause text,
  look_here text,
  directions jsonb not null default '[]'::jsonb,
  ai_diagnosis text,
  ai_model text,
  ai_diagnosed_at timestamptz,
  last_run_id uuid references public.stock_watch_monitor_runs(id) on delete set null
);

create index if not exists stock_watch_monitor_issues_open_idx on public.stock_watch_monitor_issues(status, severity, last_seen_at desc);
create index if not exists stock_watch_monitor_issues_code_idx on public.stock_watch_monitor_issues(code, last_seen_at desc);

alter table public.stock_watch_action_logs enable row level security;
alter table public.stock_watch_monitor_runs enable row level security;
alter table public.stock_watch_monitor_issues enable row level security;

-- No browser policies are intentionally created. These tables are private and are
-- read/written only by server-side service-role routes in the Marketing CRM.
