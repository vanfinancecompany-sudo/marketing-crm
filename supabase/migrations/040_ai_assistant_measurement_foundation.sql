-- AI + Knowledge measurement foundation.
-- Additive analytics only. No customer/application records are created and no public table access is granted.

create table if not exists public.ai_assistant_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'launcher_impression',
    'launcher_open',
    'launcher_close',
    'conversation_start',
    'customer_message',
    'assistant_response',
    'cta_shown',
    'cta_click'
  )),
  visitor_hash text,
  customer_session_id uuid references public.ai_customer_sessions(id) on delete set null,
  page_type text check (page_type in ('finance_vehicle', 'finance_general', 'rent2buy_general', 'homepage')),
  product_context text check (product_context in ('finance', 'rent2buy')),
  conversation_intent text,
  retrieval_required boolean,
  retrieval_performed boolean,
  retrieval_used boolean,
  knowledge_gap boolean,
  knowledge_sources jsonb not null default '[]'::jsonb check (jsonb_typeof(knowledge_sources) = 'array'),
  cta_action_key text,
  cta_label text,
  message_number integer check (message_number between 1 and 100),
  response_mode text,
  created_at timestamptz not null default now()
);

create index if not exists ai_assistant_events_created_at_idx
  on public.ai_assistant_events (created_at desc);
create index if not exists ai_assistant_events_type_created_at_idx
  on public.ai_assistant_events (event_type, created_at desc);
create index if not exists ai_assistant_events_session_idx
  on public.ai_assistant_events (customer_session_id, created_at);
create index if not exists ai_assistant_events_visitor_idx
  on public.ai_assistant_events (visitor_hash, created_at)
  where visitor_hash is not null;
create index if not exists ai_assistant_events_knowledge_sources_idx
  on public.ai_assistant_events using gin (knowledge_sources);

create table if not exists public.knowledge_hub_search_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('search_submitted', 'result_selected')),
  search_request_id uuid not null,
  visitor_hash text,
  query_text text not null check (char_length(query_text) between 1 and 500),
  normalised_query text not null check (char_length(normalised_query) between 1 and 500),
  result_count integer check (result_count between 0 and 1000),
  selected_article_id uuid references public.knowledge_articles(id) on delete set null,
  selected_rank integer check (selected_rank between 1 and 1000),
  category text,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_hub_search_events_created_at_idx
  on public.knowledge_hub_search_events (created_at desc);
create index if not exists knowledge_hub_search_events_type_created_at_idx
  on public.knowledge_hub_search_events (event_type, created_at desc);
create index if not exists knowledge_hub_search_events_query_idx
  on public.knowledge_hub_search_events (normalised_query, created_at desc);
create index if not exists knowledge_hub_search_events_article_idx
  on public.knowledge_hub_search_events (selected_article_id, created_at desc)
  where selected_article_id is not null;

alter table public.ai_assistant_events enable row level security;
alter table public.knowledge_hub_search_events enable row level security;

revoke all on table public.ai_assistant_events from anon, authenticated;
revoke all on table public.knowledge_hub_search_events from anon, authenticated;

comment on table public.ai_assistant_events is
  'Privacy-minimised event telemetry for the public AI assistant. Raw browser identifiers and raw customer messages are not stored here.';
comment on table public.knowledge_hub_search_events is
  'Public Knowledge Hub search telemetry foundation. Search text must be redacted/sanitised by the future search endpoint before insertion.';
