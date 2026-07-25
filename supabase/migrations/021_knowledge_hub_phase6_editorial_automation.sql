-- Knowledge Hub Phase 6 editorial preparation automation.
-- Additive only. Automation stops at draft and review states.

create table if not exists public.knowledge_automation_settings (
  settings_key text primary key default 'default',
  paused boolean not null default false,
  max_jobs_per_run smallint not null default 3 check (max_jobs_per_run between 1 and 10),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  minimum_draft_score smallint not null default 75 check (minimum_draft_score between 50 and 95),
  daily_draft_limit smallint not null default 3 check (daily_draft_limit between 0 and 20),
  automatic_improvement_attempts smallint not null default 2
    check (automatic_improvement_attempts between 0 and 3),
  scan_interval_hours smallint not null default 24 check (scan_interval_hours between 1 and 168),
  updated_at timestamptz not null default now()
);

insert into public.knowledge_automation_settings (settings_key)
values ('default')
on conflict (settings_key) do nothing;

create table if not exists public.knowledge_automation_opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_type text not null check (
    opportunity_type in (
      'missing_topic',
      'outdated_content',
      'weak_article',
      'duplicate_intent',
      'missing_faq',
      'weak_cta',
      'weak_linking'
    )
  ),
  title text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  source_article_id uuid references public.knowledge_articles(id) on delete cascade,
  source_concept_id uuid references public.knowledge_concepts(id) on delete set null,
  primary_product text not null default 'both'
    check (primary_product in ('finance', 'rent2buy', 'both')),
  customer_journey text not null default 'research'
    check (customer_journey in ('awareness', 'research', 'comparison', 'decision', 'ready_to_apply')),
  business_value smallint not null default 3 check (business_value between 1 and 5),
  conversion_potential smallint not null default 3 check (conversion_potential between 1 and 5),
  editorial_effort smallint not null default 3 check (editorial_effort between 1 and 5),
  priority_score smallint not null default 50 check (priority_score between 0 and 100),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'queued', 'completed', 'dismissed')),
  fingerprint text not null,
  explanation text not null default '',
  manual_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manual_overrides) = 'object'),
  discovered_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (fingerprint),
  check (
    (status = 'approved' and approved_at is not null)
    or (status = 'completed' and completed_at is not null)
    or (status = 'dismissed' and dismissed_at is not null)
    or status in ('draft', 'queued')
  )
);

create table if not exists public.knowledge_automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('cron', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled', 'paused')),
  jobs_claimed integer not null default 0,
  jobs_succeeded integer not null default 0,
  jobs_failed integer not null default 0,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  error_message text
);

create table if not exists public.knowledge_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (
    job_type in (
      'opportunity_scan',
      'topic_discovery',
      'draft_factory',
      'improvement',
      'editorial_refresh',
      'daily_briefing'
    )
  ),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority smallint not null default 50 check (priority between 0 and 100),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  opportunity_id uuid references public.knowledge_automation_opportunities(id) on delete set null,
  article_id uuid references public.knowledge_articles(id) on delete set null,
  attempts smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  explanation text not null default '',
  error_message text,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_automation_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.knowledge_automation_runs(id) on delete set null,
  job_id uuid references public.knowledge_automation_jobs(id) on delete set null,
  opportunity_id uuid references public.knowledge_automation_opportunities(id) on delete set null,
  article_id uuid references public.knowledge_articles(id) on delete set null,
  action text not null,
  reason text not null default '',
  result text not null,
  duration_ms integer,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_automation_briefings (
  id uuid primary key default gen_random_uuid(),
  briefing_date date not null unique,
  completed_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(completed_summary) = 'object'),
  priorities jsonb not null default '[]'::jsonb check (jsonb_typeof(priorities) = 'array'),
  estimated_review_minutes integer not null default 0,
  explanation text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_articles
  add column if not exists automation_state text not null default 'manual'
    check (automation_state in ('manual', 'preparing', 'ready_for_review', 'needs_improvement')),
  add column if not exists source_automation_opportunity_id uuid
    references public.knowledge_automation_opportunities(id) on delete set null;

create index if not exists knowledge_automation_jobs_claim_idx
  on public.knowledge_automation_jobs (status, available_at, priority desc, created_at)
  where status = 'queued';
create index if not exists knowledge_automation_jobs_history_idx
  on public.knowledge_automation_jobs (created_at desc, status, job_type);
create index if not exists knowledge_automation_opportunities_queue_idx
  on public.knowledge_automation_opportunities (status, priority_score desc, discovered_at desc);
create index if not exists knowledge_automation_logs_filter_idx
  on public.knowledge_automation_logs (created_at desc, action, result);
create index if not exists knowledge_articles_automation_state_idx
  on public.knowledge_articles (automation_state, updated_at desc);

create or replace function public.claim_knowledge_automation_jobs(
  p_worker text,
  p_limit integer default 3
)
returns setof public.knowledge_automation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.knowledge_automation_jobs
    where status = 'queued'
      and available_at <= now()
    order by priority desc, created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  )
  update public.knowledge_automation_jobs jobs
  set status = 'running',
      attempts = jobs.attempts + 1,
      locked_at = now(),
      locked_by = left(coalesce(p_worker, 'worker'), 200),
      started_at = now(),
      updated_at = now()
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_knowledge_automation_jobs(text, integer) from public;

alter table public.knowledge_automation_settings enable row level security;
alter table public.knowledge_automation_opportunities enable row level security;
alter table public.knowledge_automation_runs enable row level security;
alter table public.knowledge_automation_jobs enable row level security;
alter table public.knowledge_automation_logs enable row level security;
alter table public.knowledge_automation_briefings enable row level security;

-- No browser policies. Protected Vercel routes use the service role.
