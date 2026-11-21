-- Allow anonymous, fixed-ID starter-question click telemetry.
-- This adds one event type without changing existing analytics semantics or data.
-- The website and CRM handlers never store raw question text in this event.

ALTER TABLE public.ai_assistant_events
  ADD CONSTRAINT ai_assistant_events_event_type_check_v2
  CHECK (event_type = ANY (ARRAY[
    'launcher_impression',
    'launcher_open',
    'launcher_close',
    'conversation_start',
    'customer_message',
    'assistant_response',
    'cta_shown',
    'cta_click',
    'suggested_question_click'
  ])) NOT VALID;

ALTER TABLE public.ai_assistant_events
  VALIDATE CONSTRAINT ai_assistant_events_event_type_check_v2;

ALTER TABLE public.ai_assistant_events
  DROP CONSTRAINT ai_assistant_events_event_type_check;

ALTER TABLE public.ai_assistant_events
  RENAME CONSTRAINT ai_assistant_events_event_type_check_v2 TO ai_assistant_events_event_type_check;
