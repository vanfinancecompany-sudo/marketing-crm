-- Preserve historical AI Visibility evidence while tracking the current Wix LIVE set.

alter table public.knowledge_articles
  add column if not exists is_active boolean not null default true,
  add column if not exists unpublished_at timestamptz;

update public.knowledge_articles
set
  is_active = false,
  unpublished_at = coalesce(unpublished_at, last_wix_verification_at, updated_at, now()),
  wix_sync_status = 'not_live',
  wix_publication_status = 'not_live',
  publication_verified_at = null
where wix_item_id is not null
  and (
    wix_sync_status in ('not_live', 'unpublished')
    or wix_publication_status in ('not_live', 'unpublished')
  );

update public.knowledge_articles
set
  is_active = true,
  unpublished_at = null
where wix_item_id is not null
  and wix_sync_status in ('live', 'synced')
  and (wix_publication_status is null or wix_publication_status = 'live');

create index if not exists knowledge_articles_ai_visibility_active_idx
  on public.knowledge_articles (is_active, wix_publication_status, published_at desc)
  where wix_item_id is not null;

create index if not exists knowledge_articles_wix_identity_idx
  on public.knowledge_articles (wix_collection_id, wix_item_id, slug)
  where wix_item_id is not null;
