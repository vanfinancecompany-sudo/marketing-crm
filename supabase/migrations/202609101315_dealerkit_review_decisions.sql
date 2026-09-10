create table if not exists public.dealerkit_review_decisions (
  id uuid primary key default gen_random_uuid(),
  supplier_stock_id text not null unique,
  registration text not null,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'reviewed', 'ready_to_publish', 'published', 'held')),
  finance_enabled boolean not null default true,
  finance_categories text[] not null default array['all_vans']::text[],
  rent2buy_enabled boolean not null default false,
  rent2buy_categories text[] not null default '{}'::text[],
  excluded_image_ids text[] not null default '{}'::text[],
  primary_image_id text,
  image_order_ids text[] not null default '{}'::text[],
  reviewed_source_updated_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dealerkit_review_decisions_registration_idx
  on public.dealerkit_review_decisions (registration);

alter table public.dealerkit_review_decisions enable row level security;

comment on table public.dealerkit_review_decisions is
  'Server-only orchestration state for DealerKit vehicle review. Stores decisions and source image IDs only, never vehicle image bytes.';
