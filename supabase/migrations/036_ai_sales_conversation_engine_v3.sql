-- V3 internal sales-conversation review outcomes.
-- Rich diagnostics remain in knowledge_competence_results.conversation_diagnostics.

alter table public.knowledge_competence_reviews
  drop constraint if exists knowledge_competence_reviews_outcome_check;

alter table public.knowledge_competence_reviews
  add constraint knowledge_competence_reviews_outcome_check check (outcome in (
    'pass', 'needs_adjustment', 'incorrect', 'unsafe', 'too_long', 'too_vague',
    'robotic', 'lost_context', 'asked_unnecessary_clarification', 'failed_to_clarify',
    'wrong_product', 'hallucinated_fact', 'too_formal', 'too_salesy',
    'missed_buying_signal', 'weak_next_question', 'repeated_information',
    'failed_to_use_known_fact', 'good_sales_conversation'
  ));

-- Existing RLS and protected service-role access remain unchanged.
-- No public endpoint, customer-contact table, vector extension or Wix integration is added.
