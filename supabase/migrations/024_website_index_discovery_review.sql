-- PR104: Website Index Discovery & Review Importer.
-- Discovery never grants approval or makes a destination available to internal linking.

alter table public.knowledge_business_pages
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('approved', 'hidden')),
  add column if not exists verified boolean not null default false,
  add column if not exists verification_source text not null default 'legacy'
    check (verification_source in ('legacy', 'manual', 'website_discovery', 'wix_sync')),
  add column if not exists verified_at timestamptz,
  add column if not exists discovery_candidate_id uuid,
  add column if not exists monitor_in_ai_visibility_when_published boolean not null default true;

-- Existing active Website Index rows were already manually approved in PR102.
update public.knowledge_business_pages
set
  approval_status = case when active then 'approved' else 'hidden' end,
  verified = active,
  verified_at = case when active then coalesce(verified_at, updated_at, now()) else verified_at end
where verification_source = 'legacy';

create table if not exists public.knowledge_website_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  root_url text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled')),
  pages_scanned integer not null default 0 check (pages_scanned >= 0),
  candidates_found integer not null default 0 check (candidates_found >= 0),
  existing_records integer not null default 0 check (existing_records >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  pending_review integer not null default 0 check (pending_review >= 0),
  categories_without_urls integer not null default 0 check (categories_without_urls >= 0),
  broken_links integer not null default 0 check (broken_links >= 0),
  scan_config jsonb not null default '{}'::jsonb check (jsonb_typeof(scan_config) = 'object'),
  error_details text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_website_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.knowledge_website_discovery_runs(id) on delete cascade,
  title text not null,
  url text,
  canonical_url text,
  navigation_text text not null default '',
  meta_description text not null default '',
  source_page text not null,
  discovered_at timestamptz not null default now(),
  http_status integer,
  redirect_chain jsonb not null default '[]'::jsonb check (jsonb_typeof(redirect_chain) = 'array'),
  suggested_category text not null default 'Products'
    check (suggested_category in ('Stock', 'Applications', 'Products', 'Finance', 'Support', 'Knowledge Hub', 'Guides')),
  suggested_priority smallint not null default 3 check (suggested_priority between 1 and 5),
  suggested_description text not null default '',
  suggested_keywords text[] not null default '{}',
  suggested_matching_terms text[] not null default '{}',
  suggested_customer_intent text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  discovery_source text not null default 'website_discovery'
    check (discovery_source = 'website_discovery'),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'merged', 'deleted')),
  verified boolean not null default false,
  available_to_internal_linking boolean not null default false
    check (available_to_internal_linking = false),
  requires_manual_mapping boolean not null default false,
  duplicate_type text not null default 'none'
    check (duplicate_type in ('none', 'normalized_url', 'canonical_url', 'redirect_destination', 'title_similarity', 'candidate')),
  duplicate_of_candidate_id uuid references public.knowledge_website_discovery_candidates(id) on delete set null,
  existing_page_id uuid references public.knowledge_business_pages(id) on delete set null,
  monitor_in_ai_visibility_when_published boolean not null default true,
  review_notes text not null default '',
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.knowledge_business_pages
  add constraint knowledge_business_pages_discovery_candidate_id_fkey
  foreign key (discovery_candidate_id)
  references public.knowledge_website_discovery_candidates(id) on delete set null;

create table if not exists public.knowledge_website_discovery_audit_events (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid references public.knowledge_website_discovery_runs(id) on delete set null,
  candidate_id uuid references public.knowledge_website_discovery_candidates(id) on delete set null,
  website_page_id uuid references public.knowledge_business_pages(id) on delete set null,
  action text not null check (
    action in (
      'scan_started', 'scan_completed', 'scan_failed', 'destination_discovered',
      'approved', 'rejected', 'merged', 'edited', 'deleted'
    )
  ),
  reason text not null default '',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_website_discovery_candidates_queue_idx
  on public.knowledge_website_discovery_candidates (status, discovered_at desc);

create index if not exists knowledge_website_discovery_candidates_url_idx
  on public.knowledge_website_discovery_candidates (canonical_url, url);

create index if not exists knowledge_website_discovery_audit_idx
  on public.knowledge_website_discovery_audit_events (created_at desc, action);

create index if not exists knowledge_business_pages_safe_linking_idx
  on public.knowledge_business_pages (approval_status, verified, active, priority desc);

alter table public.knowledge_website_discovery_runs enable row level security;
alter table public.knowledge_website_discovery_candidates enable row level security;
alter table public.knowledge_website_discovery_audit_events enable row level security;

-- No browser policies. Protected Marketing CRM API routes use the service role.
