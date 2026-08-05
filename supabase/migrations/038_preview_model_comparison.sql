-- Protected Preview-only OpenAI model comparison evidence.
-- No public policies, customer data, Wix integration or Production model change.

create table if not exists public.knowledge_model_comparisons (
  id uuid primary key default gen_random_uuid(),
  comparison_id text not null unique,
  submitted_message text not null,
  product_context text not null check (product_context in ('finance', 'rent2buy')),
  scenario_category text,
  conversation_history jsonb not null default '[]'::jsonb check (jsonb_typeof(conversation_history) = 'array'),
  conversation_history_hash text not null,
  input_hash text not null,
  inputs_equivalent boolean not null default false,
  retrieved_source_ids text[] not null default '{}'::text[],
  source_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(source_evidence) = 'array'),
  deterministic_rule_result jsonb not null default '{}'::jsonb check (jsonb_typeof(deterministic_rule_result) = 'object'),
  default_model text not null,
  comparison_model text not null,
  default_result jsonb not null default '{}'::jsonb check (jsonb_typeof(default_result) = 'object'),
  comparison_result jsonb not null default '{}'::jsonb check (jsonb_typeof(comparison_result) = 'object'),
  default_generated_at timestamptz,
  comparison_generated_at timestamptz,
  created_by text not null default 'administrator',
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_model_comparison_reviews (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null unique references public.knowledge_model_comparisons(id) on delete cascade,
  outcome text not null check (outcome in ('default_better', 'comparison_better', 'equivalent', 'both_poor')),
  default_ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(default_ratings) = 'object'),
  comparison_ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(comparison_ratings) = 'object'),
  reviewer_notes text not null default '',
  created_by text not null default 'administrator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_model_comparisons_created_idx on public.knowledge_model_comparisons (created_at desc);
create index if not exists knowledge_model_comparisons_product_idx on public.knowledge_model_comparisons (product_context, scenario_category, created_at desc);

alter table public.knowledge_model_comparisons enable row level security;
alter table public.knowledge_model_comparison_reviews enable row level security;

-- Intentionally no browser policies. Only the existing protected service-role endpoint may read or write these tables.
