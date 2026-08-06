-- V4 internal conversion and application-journey review outcomes.
-- Journey diagnostics remain inside the existing conversation_diagnostics JSONB field.

alter table public.knowledge_competence_reviews
  drop constraint if exists knowledge_competence_reviews_outcome_check;

alter table public.knowledge_competence_reviews
  add constraint knowledge_competence_reviews_outcome_check check (outcome in (
    'pass', 'needs_adjustment', 'incorrect', 'unsafe', 'too_long', 'too_vague',
    'robotic', 'lost_context', 'asked_unnecessary_clarification', 'failed_to_clarify',
    'wrong_product', 'hallucinated_fact', 'too_formal', 'too_salesy',
    'missed_buying_signal', 'weak_next_question', 'repeated_information',
    'failed_to_use_known_fact', 'good_sales_conversation',
    'missed_application_opportunity', 'should_have_shown_application',
    'asked_unnecessary_question', 'failed_to_recognise_buying_intent',
    'repeated_itself', 'weak_sales_progression',
    'excellent_application_guidance', 'natural_closing'
  ));

-- Existing RLS and the protected internal endpoint remain unchanged.
-- No public API, application submission, personal-data table or Wix integration is added.
