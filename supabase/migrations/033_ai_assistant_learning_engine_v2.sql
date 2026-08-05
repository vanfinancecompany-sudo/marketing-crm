-- AI Assistant V2: private, internal knowledge-learning opportunities.
-- Additive only. No public policies, vectors, publishing, or automatic content changes.

alter table public.knowledge_settings
  add column if not exists assistant_confidence_threshold smallint not null default 65
    check (assistant_confidence_threshold between 0 and 100);

alter table public.knowledge_competence_results
  add column if not exists product_context text
    check (product_context in ('finance', 'rent2buy'));

create table if not exists public.knowledge_assistant_opportunities (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('finance', 'rent2buy')),
  title text not null,
  normalised_intent text not null,
  category text not null,
  summary text not null default '',
  status text not null default 'new' check (status in ('new','reviewing','covered_existing','improve_business_brain','improve_existing_article','create_faq','create_article','dismissed','completed')),
  priority_score smallint not null default 0 check (priority_score between 0 and 100),
  priority_level text not null default 'low' check (priority_level in ('critical','high','medium','low')),
  priority_components jsonb not null default '{}'::jsonb check (jsonb_typeof(priority_components) = 'object'),
  question_count integer not null default 0,
  unique_result_count integer not null default 0,
  unanswered_count integer not null default 0,
  weak_answer_count integer not null default 0,
  conflict_count integer not null default 0,
  average_confidence numeric(5,2) not null default 0,
  average_accuracy numeric(4,2),
  average_usefulness numeric(4,2),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  observed_locations text[] not null default '{}',
  candidate_reasons text[] not null default '{}',
  diagnosis text not null default '',
  recommended_action text not null default '',
  related_article_ids uuid[] not null default '{}',
  related_business_section_ids uuid[] not null default '{}',
  suggested_article_title text not null default '',
  suggested_article_brief text not null default '',
  suggested_headings text[] not null default '{}',
  suggested_factual_points text[] not null default '{}',
  suggested_faq jsonb not null default '{}'::jsonb check (jsonb_typeof(suggested_faq) = 'object'),
  faq_destination text check (faq_destination is null or faq_destination in ('business_knowledge','existing_article','new_article')),
  linked_article_id uuid references public.knowledge_articles(id) on delete set null,
  linked_faq_id uuid,
  internal_notes text not null default '',
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product, normalised_intent)
);

create table if not exists public.knowledge_assistant_opportunity_questions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.knowledge_assistant_opportunities(id) on delete cascade,
  competence_result_id uuid not null references public.knowledge_competence_results(id) on delete cascade,
  original_question text not null,
  normalised_question text not null,
  product text not null check (product in ('finance', 'rent2buy')),
  location_reference text,
  created_at timestamptz not null default now(),
  unique (competence_result_id)
);

create table if not exists public.knowledge_assistant_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.knowledge_assistant_opportunities(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  user_action text not null default 'administrator',
  notes text not null default '',
  linked_article_id uuid references public.knowledge_articles(id) on delete set null,
  linked_faq_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_assistant_faq_drafts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.knowledge_assistant_opportunities(id) on delete cascade,
  question text not null,
  answer text not null default '',
  destination text not null check (destination in ('business_knowledge','existing_article','new_article')),
  destination_article_id uuid references public.knowledge_articles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','reviewed','dismissed','implemented')),
  created_by text not null default 'administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_assistant_opportunities_linked_faq_fk') then
    alter table public.knowledge_assistant_opportunities
      add constraint knowledge_assistant_opportunities_linked_faq_fk
      foreign key (linked_faq_id) references public.knowledge_assistant_faq_drafts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_assistant_events_linked_faq_fk') then
    alter table public.knowledge_assistant_opportunity_events
      add constraint knowledge_assistant_events_linked_faq_fk
      foreign key (linked_faq_id) references public.knowledge_assistant_faq_drafts(id) on delete set null;
  end if;
end $$;

create index if not exists knowledge_assistant_opportunities_dashboard_idx on public.knowledge_assistant_opportunities (status, priority_score desc, last_seen_at desc);
create index if not exists knowledge_assistant_opportunities_product_idx on public.knowledge_assistant_opportunities (product, normalised_intent);
create index if not exists knowledge_assistant_questions_opportunity_idx on public.knowledge_assistant_opportunity_questions (opportunity_id, created_at);
create index if not exists knowledge_assistant_events_opportunity_idx on public.knowledge_assistant_opportunity_events (opportunity_id, created_at desc);

alter table public.knowledge_assistant_opportunities enable row level security;
alter table public.knowledge_assistant_opportunity_questions enable row level security;
alter table public.knowledge_assistant_opportunity_events enable row level security;
alter table public.knowledge_assistant_faq_drafts enable row level security;

revoke all on table public.knowledge_assistant_opportunities from public, anon, authenticated;
revoke all on table public.knowledge_assistant_opportunity_questions from public, anon, authenticated;
revoke all on table public.knowledge_assistant_opportunity_events from public, anon, authenticated;
revoke all on table public.knowledge_assistant_faq_drafts from public, anon, authenticated;
grant all on table public.knowledge_assistant_opportunities to service_role;
grant all on table public.knowledge_assistant_opportunity_questions to service_role;
grant all on table public.knowledge_assistant_opportunity_events to service_role;
grant all on table public.knowledge_assistant_faq_drafts to service_role;

comment on table public.knowledge_assistant_opportunity_questions is 'Internal competence-result links. Future public-assistant ingestion must use a separate authenticated server endpoint and must not store customer-identifying data.';
