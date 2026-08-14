-- Evidence-fed Knowledge Opportunities.
-- Additive only: records live demand signals and protected question variants for manual knowledge review.
-- Customer wording is sourced server-side from the already-redacted assistant session history; browser telemetry cannot supply it.

alter table public.ai_assistant_events
  add column if not exists secondary_intents text[] not null default '{}',
  add column if not exists customer_question text
    check (customer_question is null or char_length(customer_question) between 1 and 500);

create or replace function public.capture_ai_assistant_event_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'assistant_response'
     and new.customer_question is null
     and new.customer_session_id is not null
     and new.response_mode in ('ai_generated', 'ai_product_comparison', 'application_guidance', 'vehicle_pricing') then
    select left(history_item.elem ->> 'content', 500)
      into new.customer_question
    from public.ai_customer_sessions as session_row
    cross join lateral jsonb_array_elements(coalesce(session_row.conversation_history, '[]'::jsonb))
      with ordinality as history_item(elem, ord)
    where session_row.id = new.customer_session_id
      and history_item.elem ->> 'role' = 'user'
    order by history_item.ord desc
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_ai_assistant_event_question_trigger on public.ai_assistant_events;
create trigger capture_ai_assistant_event_question_trigger
before insert on public.ai_assistant_events
for each row execute function public.capture_ai_assistant_event_question();

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
  'Business-intent labels from the existing conversation classifier.';

comment on column public.ai_assistant_events.customer_question is
  'Protected learning evidence: the latest customer question copied server-side from already-redacted assistant session history. Public/browser telemetry cannot write this field.';

comment on column public.knowledge_assistant_opportunities.evidence_channels is
  'Protected evidence provenance for live assistant usage, redacted customer question variants, public Knowledge Hub search and Google Search Console. Evidence does not trigger content publication.';
