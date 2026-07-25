-- Knowledge Hub V3 Business Intelligence. Additive only; V1/V2 data and workflow remain intact.

create table if not exists public.knowledge_business_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text not null unique
    check (section_key in (
      'company_profile',
      'products',
      'brand_voice',
      'writing_rules',
      'compliance',
      'faqs',
      'customer_personas',
      'sales_knowledge',
      'business_vocabulary',
      'preferred_ctas'
    )),
  title text not null,
  description text,
  content text not null default '',
  entries jsonb not null default '[]'::jsonb
    check (jsonb_typeof(entries) = 'array'),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_article_reviews (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  overall_score smallint not null check (overall_score between 0 and 100),
  category_scores jsonb not null
    check (jsonb_typeof(category_scores) = 'object'),
  summary text not null,
  strengths text[] not null default '{}',
  issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(issues) = 'array'),
  recommendations text[] not null default '{}',
  model text,
  prompt_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_business_sections_order_idx
  on public.knowledge_business_sections (active, sort_order);

create index if not exists knowledge_article_reviews_article_created_idx
  on public.knowledge_article_reviews (article_id, created_at desc);

alter table public.knowledge_business_sections enable row level security;
alter table public.knowledge_article_reviews enable row level security;

-- These tables intentionally have no browser policies. The protected server route uses the
-- service role, matching the existing private Knowledge Hub tables.

insert into public.knowledge_business_sections
  (section_key, title, description, sort_order)
values
  (
    'company_profile',
    'Company Profile',
    'Who the business is, where it operates and the facts that define it.',
    1
  ),
  (
    'products',
    'Products',
    'Products, services, schemes and confirmed customer propositions.',
    2
  ),
  (
    'brand_voice',
    'Brand Voice',
    'How the business should sound and how customers should feel.',
    3
  ),
  (
    'writing_rules',
    'Writing Rules',
    'Formatting, clarity, terminology and content rules for every AI module.',
    4
  ),
  (
    'compliance',
    'Compliance',
    'Confirmed guidance, prohibited claims and facts that require review.',
    5
  ),
  (
    'faqs',
    'FAQs',
    'Approved customer questions and answers that AI may rely on.',
    6
  ),
  (
    'customer_personas',
    'Customer Personas',
    'Named audiences, their needs and the language that suits them.',
    7
  ),
  (
    'sales_knowledge',
    'Sales Knowledge',
    'Useful objections, qualifying information and practical next steps.',
    8
  ),
  (
    'business_vocabulary',
    'Business Vocabulary',
    'Preferred business terms and the meanings AI must apply consistently.',
    9
  ),
  (
    'preferred_ctas',
    'Preferred CTAs',
    'Approved calls to action for different customer intents.',
    10
  )
on conflict (section_key) do update set
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Carry V2 settings into the new reusable sections only where a section has not been completed.
update public.knowledge_business_sections as section
set
  content = concat_ws(
    E'\n',
    nullif(settings.business_name, ''),
    nullif(settings.website_url, ''),
    nullif(settings.business_description, '')
  ),
  updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'company_profile'
  and settings.settings_key = 'default'
  and btrim(section.content) = '';

update public.knowledge_business_sections as section
set content = coalesce(settings.products_services, ''), updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'products'
  and settings.settings_key = 'default'
  and btrim(section.content) = '';

update public.knowledge_business_sections as section
set content = coalesce(settings.default_tone, ''), updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'brand_voice'
  and settings.settings_key = 'default'
  and btrim(section.content) = '';

update public.knowledge_business_sections as section
set
  entries = coalesce(
    (
      select jsonb_agg(jsonb_build_object('label', 'Content goal', 'value', goal))
      from unnest(settings.content_goals) as goal
    ),
    '[]'::jsonb
  ),
  updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'writing_rules'
  and settings.settings_key = 'default'
  and section.entries = '[]'::jsonb;

update public.knowledge_business_sections as section
set
  content = concat_ws(
    E'\n',
    nullif(settings.factual_guidance, ''),
    nullif(settings.prohibited_claims, '')
  ),
  updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'compliance'
  and settings.settings_key = 'default'
  and btrim(section.content) = '';

update public.knowledge_business_sections as section
set
  entries = coalesce(
    (
      select jsonb_agg(jsonb_build_object('label', 'Persona', 'value', audience))
      from unnest(
        case
          when cardinality(settings.target_audiences) > 0 then settings.target_audiences
          when nullif(settings.default_audience, '') is not null
            then array[settings.default_audience]
          else '{}'::text[]
        end
      ) as audience
    ),
    '[]'::jsonb
  ),
  updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'customer_personas'
  and settings.settings_key = 'default'
  and section.entries = '[]'::jsonb;

update public.knowledge_business_sections as section
set
  entries = case
    when nullif(settings.default_cta, '') is null then '[]'::jsonb
    else jsonb_build_array(
      jsonb_build_object('label', 'Default CTA', 'value', settings.default_cta)
    )
  end,
  updated_at = now()
from public.knowledge_settings as settings
where section.section_key = 'preferred_ctas'
  and settings.settings_key = 'default'
  and section.entries = '[]'::jsonb;
