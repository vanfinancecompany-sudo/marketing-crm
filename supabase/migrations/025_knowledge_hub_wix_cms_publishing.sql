-- PR107: Knowledge Hub -> Wix CMS draft publishing.
-- Additive only. Draft creation never confirms a public publication.

alter table public.knowledge_articles
  add column if not exists featured_image text,
  add column if not exists wix_draft_url text,
  add column if not exists wix_payload_version text,
  add column if not exists wix_last_error text not null default '';

create unique index if not exists knowledge_articles_wix_item_idx
  on public.knowledge_articles (wix_collection_id, wix_item_id)
  where wix_item_id is not null;

-- Existing service-role-only access remains unchanged.
