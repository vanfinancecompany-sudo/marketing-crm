-- Marketing CRM Phase 4 AI platform. Additive only; V1-V3 and campaign workflows remain intact.

alter table public.knowledge_topics
  add column if not exists estimated_value smallint not null default 3
    check (estimated_value between 1 and 5),
  add column if not exists difficulty smallint not null default 3
    check (difficulty between 1 and 5),
  add column if not exists target_persona text not null default '',
  add column if not exists seasonal boolean not null default false,
  add column if not exists opportunity_reason text not null default '';

create table if not exists public.marketing_ai_assets (
  id uuid primary key default gen_random_uuid(),
  source_article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  channel text not null check (
    channel in (
      'email',
      'facebook',
      'linkedin',
      'google_business_profile',
      'x',
      'sms',
      'meta_ad'
    )
  ),
  title text not null,
  body text not null default '',
  preview_text text not null default '',
  cta text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  warnings text[] not null default '{}',
  generation_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(generation_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  archived_at timestamptz,
  check (
    (status = 'approved' and approved_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
    or (status = 'draft' and approved_at is null and archived_at is null)
  )
);

create table if not exists public.knowledge_website_imports (
  id uuid primary key default gen_random_uuid(),
  website_url text not null,
  status text not null default 'review'
    check (status in ('review', 'saved', 'archived')),
  extracted_sections jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extracted_sections) = 'object'),
  selected_sections text[] not null default '{}',
  analysis_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(analysis_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  saved_at timestamptz,
  archived_at timestamptz
);

create table if not exists public.marketing_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (
    target_type in (
      'knowledge_article',
      'content_asset',
      'email_template',
      'social_post',
      'sms',
      'vehicle_description',
      'youtube',
      'sales_assistant'
    )
  ),
  target_id uuid not null,
  overall_score smallint not null check (overall_score between 0 and 100),
  category_scores jsonb not null
    check (jsonb_typeof(category_scores) = 'object'),
  summary text not null default '',
  recommendations text[] not null default '{}',
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  model text,
  prompt_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prompt_metadata) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.marketing_campaigns
  add column if not exists source_article_id uuid
    references public.knowledge_articles(id) on delete set null,
  add column if not exists source_ai_asset_id uuid
    references public.marketing_ai_assets(id) on delete set null;

create index if not exists knowledge_topics_phase4_planner_idx
  on public.knowledge_topics (status, priority desc, estimated_value desc);

create index if not exists marketing_ai_assets_article_channel_idx
  on public.marketing_ai_assets (source_article_id, channel, updated_at desc);

create index if not exists marketing_ai_assets_status_idx
  on public.marketing_ai_assets (status, updated_at desc);

create index if not exists knowledge_website_imports_status_idx
  on public.knowledge_website_imports (status, created_at desc);

create index if not exists marketing_ai_reviews_target_idx
  on public.marketing_ai_reviews (target_type, target_id, created_at desc);

create index if not exists marketing_campaigns_source_article_idx
  on public.marketing_campaigns (source_article_id)
  where source_article_id is not null;

alter table public.marketing_ai_assets enable row level security;
alter table public.knowledge_website_imports enable row level security;
alter table public.marketing_ai_reviews enable row level security;

-- No browser policies are created. Protected Vercel API routes use the service role.
