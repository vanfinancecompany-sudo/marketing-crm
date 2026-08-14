-- Evidence-fed Knowledge Opportunities.
-- Additive only: records aggregate signals and secondary intent diagnostics.
-- Does not store raw public assistant questions and does not create/publish content automatically.

alter table public.ai_assistant_events
  add column if not exists secondary_intents text[] not null default '{}';

alter table public.knowledge_assistant_opportunities
  add column if not exists live_assistant_question_count integer not null default 0 check (live_assistant_question_count >= 0),
  add column if not exists live_assistant_gap_count integer not null default 0 check (live_assistant_gap_count >= 0),
  add column if not exists live_assistant_retrieval_miss_count integer not null default 0 check (live_assistant_retrieval_miss_count >= 0),
  add column if not exists hub_search_count integer not null default 0 check (hub_search_count >= 0),
  add column if not exists hub_no_result_count integer not null default 0 check (hub_no_result_count >= 0),
  add column if not exists gsc_impressions integer not null default 0 check (gsc_impressions >= 0),
  add column if not exists gsc_clicks integer not null default 0 check (gsc_clicks >= 0),
  add column if not exists gsc_query_count integer not null default 0 check (gsc_query_count >= 0),
  add column if not exists evidence_channels jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_channels) = 'object'),
  add column if not exists evidence_last_refreshed_at timestamptz;

create index if not exists knowledge_assistant_opportunities_live_evidence_idx
  on public.knowledge_assistant_opportunities (
    live_assistant_gap_count desc,
    hub_no_result_count desc,
    gsc_impressions desc
  );

comment on column public.ai_assistant_events.secondary_intents is
  'Non-PII business-intent labels from the existing conversation classifier. Raw public assistant question text is not stored in this table.';

comment on column public.knowledge_assistant_opportunities.evidence_channels is
  'Aggregate evidence provenance for live assistant usage, public Knowledge Hub search and Google Search Console. Evidence does not trigger content publication.';
