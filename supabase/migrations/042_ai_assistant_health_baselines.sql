-- Persistent AI Assistant Health baselines.
-- Validation runs remain write-free. A baseline is saved only by an explicit protected administrator action.

create table if not exists public.ai_assistant_health_baselines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  mode text not null check (mode in ('deterministic', 'live')),
  commit_sha text,
  conversations integer not null check (conversations between 1 and 10000),
  turns integer not null default 0 check (turns >= 0),
  overall_ai_health_score numeric(5,2),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  generated_at timestamptz,
  created_by text not null default 'Marketing CRM administrator',
  created_at timestamptz not null default now()
);

create index if not exists ai_assistant_health_baselines_mode_created_idx
  on public.ai_assistant_health_baselines (mode, created_at desc);

alter table public.ai_assistant_health_baselines enable row level security;
revoke all on table public.ai_assistant_health_baselines from public, anon, authenticated;
grant all on table public.ai_assistant_health_baselines to service_role;

comment on table public.ai_assistant_health_baselines is
  'Protected, explicitly saved AI Assistant Health reports. Validation execution itself remains write-free; this table stores only administrator-approved baseline snapshots.';
