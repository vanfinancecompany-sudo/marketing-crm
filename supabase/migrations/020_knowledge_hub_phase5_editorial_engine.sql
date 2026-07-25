-- Knowledge Hub Phase 5 editorial intelligence. Additive only; V1-V4 remain intact.

create table if not exists public.knowledge_business_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique,
  title text not null,
  url text not null,
  product text not null default 'general'
    check (product in ('finance', 'rent2buy', 'both', 'general')),
  page_type text not null default 'business_page',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_concepts (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null unique,
  label text not null,
  aliases text[] not null default '{}',
  primary_product text not null default 'both'
    check (primary_product in ('finance', 'rent2buy', 'both')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_article_intents (
  article_id uuid primary key references public.knowledge_articles(id) on delete cascade,
  primary_product text not null check (primary_product in ('finance', 'rent2buy', 'both')),
  secondary_product text not null default '',
  customer_journey text not null
    check (customer_journey in ('awareness', 'research', 'comparison', 'decision', 'ready_to_apply')),
  search_intent text not null
    check (search_intent in ('informational', 'commercial', 'transactional')),
  conversion_goal text not null default '',
  confidence_score smallint not null check (confidence_score between 0 and 100),
  manual_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(manual_overrides) = 'object'),
  source_content_hash text not null,
  model text,
  prompt_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prompt_metadata) = 'object'),
  analysed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_article_editorial_assessments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  source_content_hash text not null,
  effective_intent jsonb not null default '{}'::jsonb
    check (jsonb_typeof(effective_intent) = 'object'),
  structured_ctas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(structured_ctas) = 'array'),
  internal_links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(internal_links) = 'array'),
  business_recommendations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(business_recommendations) = 'array'),
  category_scores jsonb not null default '{}'::jsonb
    check (jsonb_typeof(category_scores) = 'object'),
  overall_score smallint not null check (overall_score between 0 and 100),
  grade smallint not null check (grade between 1 and 5),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  publication_status text not null
    check (publication_status in ('ready', 'review', 'needs_improvement', 'blocked')),
  strengths text[] not null default '{}',
  weaknesses text[] not null default '{}',
  lost_points jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lost_points) = 'array'),
  suggested_improvements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(suggested_improvements) = 'array'),
  review_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_summary) = 'object'),
  coverage_concepts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(coverage_concepts) = 'array'),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  model text,
  prompt_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prompt_metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_article_editorial_overrides (
  article_id uuid primary key references public.knowledge_articles(id) on delete cascade,
  structured_ctas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(structured_ctas) = 'array'),
  internal_links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(internal_links) = 'array'),
  dismissed_recommendations text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_article_concepts (
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  concept_id uuid not null references public.knowledge_concepts(id) on delete cascade,
  assessment_id uuid references public.knowledge_article_editorial_assessments(id) on delete set null,
  relevance_score smallint not null check (relevance_score between 0 and 100),
  evidence text not null default '',
  source text not null default 'ai' check (source in ('ai', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (article_id, concept_id)
);

create table if not exists public.knowledge_article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  change_source text not null check (
    change_source in (
      'user_edit',
      'ai_improvement',
      'business_brain_update',
      'score_recalculation',
      'approval',
      'archive',
      'import'
    )
  ),
  change_summary text not null default '',
  article_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(article_snapshot) = 'object'),
  editorial_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(editorial_snapshot) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (article_id, revision_number)
);

create table if not exists public.knowledge_article_improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  assessment_id uuid references public.knowledge_article_editorial_assessments(id) on delete set null,
  recommendation_key text not null,
  title text not null,
  description text not null default '',
  target_field text not null,
  proposed_changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proposed_changes) = 'object'),
  status text not null default 'review'
    check (status in ('review', 'applied', 'rejected')),
  model text,
  prompt_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prompt_metadata) = 'object'),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rejected_at timestamptz,
  check (
    (status = 'applied' and applied_at is not null and rejected_at is null)
    or (status = 'rejected' and rejected_at is not null and applied_at is null)
    or (status = 'review' and applied_at is null and rejected_at is null)
  )
);

create table if not exists public.knowledge_editorial_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in ('business_brain_update', 'publication', 'system')
  ),
  article_id uuid references public.knowledge_articles(id) on delete cascade,
  section_key text,
  summary text not null default '',
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

insert into public.knowledge_concepts (concept_key, label, aliases, primary_product)
values
  ('bad_credit', 'Bad Credit', array['poor credit', 'adverse credit'], 'finance'),
  ('ford_transit', 'Ford Transit', array['transit van'], 'both'),
  ('limited_companies', 'Limited Companies', array['limited company', 'ltd company'], 'both'),
  ('electric_vans', 'Electric Vans', array['electric van', 'ev van'], 'both'),
  ('vat', 'VAT', array['value added tax', 'vat qualifying'], 'both'),
  ('hire_purchase', 'Hire Purchase', array['hp finance'], 'finance'),
  ('lease_purchase', 'Lease Purchase', array['lease purchase finance'], 'finance'),
  ('rent2buy', 'Rent2Buy', array['rent to buy', 'rent 2 buy'], 'rent2buy'),
  ('finance_applications', 'Finance Applications', array['finance application', 'apply for finance'], 'finance'),
  ('affordability', 'Affordability', array['affordable', 'monthly budget'], 'both'),
  ('documentation', 'Documentation', array['documents', 'proof of income', 'paperwork'], 'both')
on conflict (concept_key) do nothing;

create index if not exists knowledge_article_editorial_assessments_article_idx
  on public.knowledge_article_editorial_assessments (article_id, created_at desc);

create index if not exists knowledge_article_editorial_assessments_queue_idx
  on public.knowledge_article_editorial_assessments (publication_status, grade desc, overall_score desc);

create index if not exists knowledge_article_concepts_concept_idx
  on public.knowledge_article_concepts (concept_id, relevance_score desc);

create index if not exists knowledge_article_revisions_article_idx
  on public.knowledge_article_revisions (article_id, revision_number desc);

create index if not exists knowledge_article_improvement_proposals_article_idx
  on public.knowledge_article_improvement_proposals (article_id, status, created_at desc);

create index if not exists knowledge_editorial_events_created_idx
  on public.knowledge_editorial_events (event_type, created_at desc);

alter table public.knowledge_business_pages enable row level security;
alter table public.knowledge_concepts enable row level security;
alter table public.knowledge_article_intents enable row level security;
alter table public.knowledge_article_editorial_assessments enable row level security;
alter table public.knowledge_article_editorial_overrides enable row level security;
alter table public.knowledge_article_concepts enable row level security;
alter table public.knowledge_article_revisions enable row level security;
alter table public.knowledge_article_improvement_proposals enable row level security;
alter table public.knowledge_editorial_events enable row level security;

-- No browser policies are created. Protected Vercel API routes use the service role.
