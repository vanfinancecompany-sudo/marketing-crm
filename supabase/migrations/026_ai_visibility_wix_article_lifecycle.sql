-- Preserve historical AI Visibility evidence while tracking the current Wix LIVE set.

alter table public.knowledge_articles
  add column if not exists is_active boolean not null default true,
  add column if not exists unpublished_at timestamptz;

-- Preserve every status currently accepted in production and add one consistent
-- inactive lifecycle value. pg_get_expr retains the existing constraint logic,
-- so rerunning this migration cannot accidentally remove an older valid value.
do $$
declare
  existing_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid)
    into existing_expression
  from pg_constraint c
  where c.conrelid = 'public.knowledge_articles'::regclass
    and c.conname = 'knowledge_articles_wix_sync_status_check';

  if existing_expression is not null
     and position('unpublished' in lower(existing_expression)) = 0 then
    alter table public.knowledge_articles
      drop constraint if exists knowledge_articles_wix_sync_status_check;

    execute format(
      'alter table public.knowledge_articles add constraint knowledge_articles_wix_sync_status_check check ((%s) or wix_sync_status = %L)',
      existing_expression,
      'unpublished'
    );
  end if;
end
$$;

do $$
declare
  existing_expression text;
begin
  select pg_get_expr(c.conbin, c.conrelid)
    into existing_expression
  from pg_constraint c
  where c.conrelid = 'public.knowledge_articles'::regclass
    and c.conname = 'knowledge_articles_wix_publication_status_check';

  if existing_expression is not null
     and position('unpublished' in lower(existing_expression)) = 0 then
    alter table public.knowledge_articles
      drop constraint if exists knowledge_articles_wix_publication_status_check;

    execute format(
      'alter table public.knowledge_articles add constraint knowledge_articles_wix_publication_status_check check ((%s) or wix_publication_status = %L)',
      existing_expression,
      'unpublished'
    );
  end if;
end
$$;

update public.knowledge_articles
set
  is_active = false,
  unpublished_at = coalesce(unpublished_at, last_wix_verification_at, updated_at, now()),
  wix_sync_status = 'unpublished',
  wix_publication_status = 'unpublished',
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
