-- Install the duplicate-candidate RPC functions after recovery migration 028.
-- Safe to run repeatedly.

create extension if not exists pg_trgm;

create or replace function public.find_knowledge_topic_duplicate_candidates(
  p_title text,
  p_canonical_intent text default null,
  p_category text default null,
  p_exclude_id uuid default null,
  p_limit integer default 10
)
returns table (
  topic_id uuid,
  title text,
  category text,
  status text,
  canonical_intent text,
  article_angle text,
  title_similarity real,
  intent_similarity real,
  exact_title boolean,
  exact_intent boolean,
  duplicate_risk text
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      lower(trim(coalesce(p_title, ''))) as title_text,
      lower(trim(coalesce(nullif(p_canonical_intent, ''), p_title, ''))) as intent_text,
      nullif(trim(p_category), '') as category_text
  )
  select
    t.id,
    t.title,
    t.category,
    t.status,
    t.canonical_intent,
    t.article_angle,
    similarity(lower(coalesce(t.title, '')), c.title_text)::real,
    similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text)::real,
    lower(trim(coalesce(t.title, ''))) = c.title_text,
    lower(trim(coalesce(t.canonical_intent, t.intent, t.title, ''))) = c.intent_text,
    case
      when lower(trim(coalesce(t.title, ''))) = c.title_text
        or lower(trim(coalesce(t.canonical_intent, t.intent, t.title, ''))) = c.intent_text
        then 'duplicate'
      when similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text) >= 0.82
        then 'likely_duplicate'
      when similarity(lower(coalesce(t.title, '')), c.title_text) >= 0.72
        or similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text) >= 0.68
        then 'related'
      else 'clear'
    end
  from public.knowledge_topics t
  cross join candidate c
  where (p_exclude_id is null or t.id <> p_exclude_id)
    and (
      lower(trim(coalesce(t.title, ''))) = c.title_text
      or lower(trim(coalesce(t.canonical_intent, t.intent, t.title, ''))) = c.intent_text
      or similarity(lower(coalesce(t.title, '')), c.title_text) >= 0.55
      or similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text) >= 0.55
    )
    and (
      c.category_text is null
      or t.category = c.category_text
      or similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text) >= 0.82
    )
  order by
    case
      when lower(trim(coalesce(t.title, ''))) = c.title_text
        or lower(trim(coalesce(t.canonical_intent, t.intent, t.title, ''))) = c.intent_text then 0
      when similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text) >= 0.82 then 1
      else 2
    end,
    greatest(
      similarity(lower(coalesce(t.title, '')), c.title_text),
      similarity(lower(coalesce(t.canonical_intent, t.intent, t.title, '')), c.intent_text)
    ) desc,
    t.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.find_knowledge_topic_duplicate_candidates(text, text, text, uuid, integer) from public;

create or replace function public.find_knowledge_article_duplicate_candidates(
  p_title text,
  p_canonical_intent text default null,
  p_category text default null,
  p_exclude_id uuid default null,
  p_limit integer default 10
)
returns table (
  article_id uuid,
  title text,
  category text,
  status text,
  canonical_intent text,
  article_angle text,
  title_similarity real,
  intent_similarity real,
  exact_title boolean,
  exact_intent boolean,
  duplicate_risk text
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      lower(trim(coalesce(p_title, ''))) as title_text,
      lower(trim(coalesce(nullif(p_canonical_intent, ''), p_title, ''))) as intent_text,
      nullif(trim(p_category), '') as category_text
  )
  select
    a.id,
    a.title,
    a.category,
    a.status,
    a.canonical_intent,
    a.article_angle,
    similarity(lower(coalesce(a.title, '')), c.title_text)::real,
    similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text)::real,
    lower(trim(coalesce(a.title, ''))) = c.title_text,
    lower(trim(coalesce(a.canonical_intent, a.title, ''))) = c.intent_text,
    case
      when lower(trim(coalesce(a.title, ''))) = c.title_text
        or lower(trim(coalesce(a.canonical_intent, a.title, ''))) = c.intent_text
        then 'duplicate'
      when similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text) >= 0.82
        then 'likely_duplicate'
      when similarity(lower(coalesce(a.title, '')), c.title_text) >= 0.72
        or similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text) >= 0.68
        then 'related'
      else 'clear'
    end
  from public.knowledge_articles a
  cross join candidate c
  where (p_exclude_id is null or a.id <> p_exclude_id)
    and (
      lower(trim(coalesce(a.title, ''))) = c.title_text
      or lower(trim(coalesce(a.canonical_intent, a.title, ''))) = c.intent_text
      or similarity(lower(coalesce(a.title, '')), c.title_text) >= 0.55
      or similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text) >= 0.55
    )
    and (
      c.category_text is null
      or a.category = c.category_text
      or similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text) >= 0.82
    )
  order by
    case
      when lower(trim(coalesce(a.title, ''))) = c.title_text
        or lower(trim(coalesce(a.canonical_intent, a.title, ''))) = c.intent_text then 0
      when similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text) >= 0.82 then 1
      else 2
    end,
    greatest(
      similarity(lower(coalesce(a.title, '')), c.title_text),
      similarity(lower(coalesce(a.canonical_intent, a.title, '')), c.intent_text)
    ) desc,
    a.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.find_knowledge_article_duplicate_candidates(text, text, text, uuid, integer) from public;

notify pgrst, 'reload schema';
