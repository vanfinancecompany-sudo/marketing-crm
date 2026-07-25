-- Knowledge Hub V1. Additive only; existing marketing/customer tables are untouched.
create extension if not exists pgcrypto;

create table if not exists public.knowledge_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  primary_keyword text,
  secondary_keywords text[] not null default '{}',
  intent text,
  notes text,
  status text not null default 'idea'
    check (status in ('idea', 'ready', 'generated', 'archived')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key text unique not null,
  description text,
  prompt text not null,
  default_tone text,
  default_audience text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.knowledge_topics(id) on delete set null,
  template_id uuid references public.knowledge_templates(id) on delete set null,
  title text not null,
  slug text not null,
  category text,
  article_type text,
  seo_title text,
  meta_description text,
  excerpt text,
  content_markdown text,
  content_html text,
  faq_json jsonb not null default '[]'::jsonb,
  cta text,
  internal_link_suggestions jsonb not null default '[]'::jsonb,
  quality_checks jsonb not null default '[]'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'exported', 'archived')),
  approved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_settings (
  settings_key text primary key default 'default',
  business_name text,
  website_url text,
  default_cta text,
  default_tone text,
  default_audience text,
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_topics_status_idx on public.knowledge_topics (status);
create index if not exists knowledge_topics_category_idx on public.knowledge_topics (category);
create unique index if not exists knowledge_topics_title_normalized_idx
  on public.knowledge_topics (lower(trim(title)));
create index if not exists knowledge_articles_topic_idx on public.knowledge_articles (topic_id);
create index if not exists knowledge_articles_status_idx on public.knowledge_articles (status);
create index if not exists knowledge_articles_category_type_idx
  on public.knowledge_articles (category, article_type);
create index if not exists knowledge_articles_created_at_idx
  on public.knowledge_articles (created_at desc);
create unique index if not exists knowledge_articles_slug_idx
  on public.knowledge_articles (lower(slug));

alter table public.knowledge_topics enable row level security;
alter table public.knowledge_templates enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.knowledge_settings enable row level security;

-- Deliberately no public or anon policies. The Marketing CRM already protects permanent
-- data through authenticated server endpoints using the Supabase service role.

insert into public.knowledge_templates
  (name, key, description, prompt, default_tone, default_audience)
values
  ('FAQ / customer question', 'faq', 'Directly answer a customer question.', 'Answer the customer question directly, then explain the important details in a scannable FAQ-led article.', 'Helpful, clear and factual', 'UK van buyers'),
  ('Finance guide', 'finance-guide', 'Explain a van finance subject.', 'Write a practical van finance guide without promising approval or rates.', 'Professional and reassuring', 'UK van buyers'),
  ('Rent2Buy guide', 'rent2buy-guide', 'Explain a Rent2Buy subject.', 'Write a practical Rent2Buy guide. Mark uncertain business terms for review.', 'Plain English and supportive', 'Customers considering Rent2Buy'),
  ('Buying guide', 'buying-guide', 'Help a customer decide.', 'Write a decision-focused buying guide with trade-offs and practical checks.', 'Helpful and impartial', 'UK van buyers'),
  ('Vehicle guide', 'vehicle-guide', 'Explain a vehicle type or model.', 'Write a useful vehicle guide. Do not invent stock or prices.', 'Knowledgeable and practical', 'Van buyers and trades'),
  ('Comparison', 'comparison', 'Compare options fairly.', 'Write a balanced comparison using clear criteria and trade-offs.', 'Balanced and factual', 'Customers comparing options'),
  ('Checklist', 'checklist', 'Create an actionable checklist.', 'Write an actionable checklist with brief explanations and a clear next step.', 'Concise and practical', 'UK van buyers')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  prompt = excluded.prompt,
  default_tone = excluded.default_tone,
  default_audience = excluded.default_audience,
  active = true,
  updated_at = now();

insert into public.knowledge_settings
  (settings_key, business_name, website_url, default_cta, default_tone, default_audience)
values
  (
    'default',
    'Van Finance Company',
    'https://www.vanfinancecompany.co.uk',
    'View available vans and apply when you are ready.',
    'Helpful, clear and factual',
    'UK van buyers'
  )
on conflict (settings_key) do nothing;
