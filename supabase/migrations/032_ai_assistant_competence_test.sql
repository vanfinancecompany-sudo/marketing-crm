-- Internal AI Assistant Competence Test evidence only.
-- No public assistant, embeddings, vectors or permanent knowledge chunks.

create table if not exists public.knowledge_competence_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('single', 'conversation', 'test_set')),
  status text not null default 'running' check (status in ('running', 'completed', 'cancelled', 'failed')),
  total_questions integer not null default 0,
  completed_questions integer not null default 0,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null default 'administrator'
);

create table if not exists public.knowledge_competence_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.knowledge_competence_runs(id) on delete cascade,
  test_question_id text,
  mode text not null check (mode in ('single', 'conversation', 'test_set')),
  question text not null,
  conversation jsonb not null default '[]'::jsonb check (jsonb_typeof(conversation) = 'array'),
  answer text not null default '',
  product_detected text not null default 'unknown' check (product_detected in ('finance', 'rent2buy', 'both', 'unknown')),
  confidence smallint not null default 0 check (confidence between 0 and 100),
  confidence_reason text not null default '',
  knowledge_gap boolean not null default false,
  conflict_detected boolean not null default false,
  sources_used jsonb not null default '[]'::jsonb check (jsonb_typeof(sources_used) = 'array'),
  response_time_ms integer not null default 0,
  retrieval_time_ms integer not null default 0,
  generation_time_ms integer not null default 0,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_competence_reviews (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.knowledge_competence_results(id) on delete cascade,
  outcome text not null check (outcome in ('pass', 'needs_adjustment', 'incorrect', 'unsafe', 'too_long', 'too_vague')),
  accuracy smallint check (accuracy between 1 and 5),
  helpfulness smallint check (helpfulness between 1 and 5),
  conversion smallint check (conversion between 1 and 5),
  brevity smallint check (brevity between 1 and 5),
  reviewer_notes text not null default '',
  created_by text not null default 'administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (result_id)
);

create index if not exists knowledge_competence_results_run_idx on public.knowledge_competence_results (run_id, created_at);
create index if not exists knowledge_competence_reviews_outcome_idx on public.knowledge_competence_reviews (outcome, created_at desc);

alter table public.knowledge_competence_runs enable row level security;
alter table public.knowledge_competence_results enable row level security;
alter table public.knowledge_competence_reviews enable row level security;

create or replace function public.increment_competence_run_progress(target_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.knowledge_competence_runs
  set completed_questions = completed_questions + 1
  where id = target_run_id and status = 'running';
$$;

revoke all on function public.increment_competence_run_progress(uuid) from public, anon, authenticated;
grant execute on function public.increment_competence_run_progress(uuid) to service_role;

-- Intentionally no browser policies. The protected internal route uses the service role.
