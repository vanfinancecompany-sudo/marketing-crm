-- V2.5 internal real-customer conversation simulation diagnostics.
-- No public assistant endpoint, customer-contact storage, embeddings or Wix integration.

alter table public.knowledge_competence_results
  add column if not exists conversation_intent text,
  add column if not exists secondary_intents text[] not null default '{}'::text[],
  add column if not exists conversation_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(conversation_diagnostics) = 'object'),
  add column if not exists learning_diagnosis text,
  add column if not exists simulation_session_id text;

alter table public.knowledge_competence_reviews
  drop constraint if exists knowledge_competence_reviews_outcome_check;

alter table public.knowledge_competence_reviews
  add constraint knowledge_competence_reviews_outcome_check check (outcome in (
    'pass', 'needs_adjustment', 'incorrect', 'unsafe', 'too_long', 'too_vague',
    'robotic', 'lost_context', 'asked_unnecessary_clarification', 'failed_to_clarify',
    'wrong_product', 'hallucinated_fact'
  ));

alter table public.knowledge_competence_reviews
  add column if not exists intent_understood smallint check (intent_understood between 1 and 5),
  add column if not exists conversation_naturalness smallint check (conversation_naturalness between 1 and 5),
  add column if not exists context_memory smallint check (context_memory between 1 and 5),
  add column if not exists clarification_quality smallint check (clarification_quality between 1 and 5),
  add column if not exists product_separation smallint check (product_separation between 1 and 5),
  add column if not exists conversion_value smallint check (conversion_value between 1 and 5),
  add column if not exists safety smallint check (safety between 1 and 5);

create index if not exists knowledge_competence_results_simulation_session_idx
  on public.knowledge_competence_results (simulation_session_id, created_at)
  where simulation_session_id is not null;

-- Existing RLS remains enabled. Browser access is still prohibited; the protected internal route uses service_role.
