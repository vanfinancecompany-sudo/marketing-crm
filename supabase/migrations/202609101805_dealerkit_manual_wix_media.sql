create table if not exists public.dealerkit_review_manual_media (
  id uuid primary key default gen_random_uuid(),
  supplier_stock_id text not null,
  registration text not null,
  site_scope text not null
    check (site_scope in ('van_finance', 'rent2buy')),
  purpose text not null
    check (purpose in ('van_finance_replacement', 'rent2buy_template')),
  wix_site_id text not null,
  wix_file_id text not null,
  wix_url text not null default '',
  display_name text not null default '',
  size_in_bytes bigint,
  operation_status text not null default 'PENDING',
  wix_hash text,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wix_site_id, wix_file_id)
);

create index if not exists dealerkit_review_manual_media_registration_idx
  on public.dealerkit_review_manual_media (registration, created_at desc);

create index if not exists dealerkit_review_manual_media_supplier_stock_idx
  on public.dealerkit_review_manual_media (supplier_stock_id, created_at desc);

alter table public.dealerkit_review_manual_media enable row level security;

revoke all on table public.dealerkit_review_manual_media from anon, authenticated;
grant select, insert, update, delete on table public.dealerkit_review_manual_media to service_role;

comment on table public.dealerkit_review_manual_media is
  'Server-only metadata for manually uploaded DealerKit review images already stored in Wix Media. Never stores image bytes.';
