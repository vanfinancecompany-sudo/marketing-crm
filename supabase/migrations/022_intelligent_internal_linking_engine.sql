-- PR102: approved Website Index and review-only intelligent internal linking.
-- Additive only. No link is inserted into article content automatically.

alter table public.knowledge_business_pages
  add column if not exists category text not null default 'Products'
    check (category in ('Stock', 'Applications', 'Products', 'Finance', 'Support', 'Knowledge Hub', 'Guides')),
  add column if not exists keywords text[] not null default '{}',
  add column if not exists vehicle_types text[] not null default '{}',
  add column if not exists customer_intent text[] not null default '{}',
  add column if not exists priority smallint not null default 3 check (priority between 1 and 5),
  add column if not exists description text not null default '',
  add column if not exists knowledge_article_id uuid
    references public.knowledge_articles(id) on delete set null,
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'wix')),
  add column if not exists external_id text,
  add column if not exists sync_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sync_metadata) = 'object'),
  add column if not exists last_synced_at timestamptz,
  add column if not exists status text generated always as (
    case when active then 'Active' else 'Hidden' end
  ) stored;

create unique index if not exists knowledge_business_pages_article_unique_idx
  on public.knowledge_business_pages (knowledge_article_id)
  where knowledge_article_id is not null;

create unique index if not exists knowledge_business_pages_external_unique_idx
  on public.knowledge_business_pages (source, external_id)
  where external_id is not null;

create index if not exists knowledge_business_pages_index_filter_idx
  on public.knowledge_business_pages (active, category, priority desc, title);

create table if not exists public.knowledge_internal_link_suggestions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  assessment_id uuid references public.knowledge_article_editorial_assessments(id) on delete set null,
  website_page_id uuid not null references public.knowledge_business_pages(id) on delete cascade,
  target_type text not null check (target_type in ('website_page', 'knowledge_article')),
  target_article_id uuid references public.knowledge_articles(id) on delete cascade,
  destination_title text not null,
  destination_url text not null,
  anchor_text text not null,
  original_anchor_text text not null,
  confidence_score smallint not null check (confidence_score between 0 and 100),
  reason text not null,
  context text not null default '',
  source_content_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, source_content_hash, website_page_id),
  check (
    (target_type = 'knowledge_article' and target_article_id is not null)
    or (target_type = 'website_page' and target_article_id is null)
  ),
  check (
    (status in ('accepted', 'rejected') and decided_at is not null)
    or (status in ('pending', 'superseded') and decided_at is null)
  )
);

create table if not exists public.knowledge_internal_link_events (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid references public.knowledge_internal_link_suggestions(id) on delete set null,
  article_id uuid references public.knowledge_articles(id) on delete set null,
  website_page_id uuid references public.knowledge_business_pages(id) on delete set null,
  action text not null check (
    action in (
      'generated',
      'refreshed',
      'accepted',
      'rejected',
      'anchor_edited',
      'superseded',
      'index_saved',
      'index_hidden'
    )
  ),
  reason text not null default '',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_internal_link_suggestions_article_idx
  on public.knowledge_internal_link_suggestions (article_id, status, confidence_score desc, created_at desc);

create index if not exists knowledge_internal_link_events_article_idx
  on public.knowledge_internal_link_events (article_id, created_at desc);

alter table public.knowledge_internal_link_suggestions enable row level security;
alter table public.knowledge_internal_link_events enable row level security;

-- No browser policies. Protected Marketing CRM routes use the Supabase service role.
