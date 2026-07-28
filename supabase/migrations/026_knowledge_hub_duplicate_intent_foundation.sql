-- Knowledge Hub duplicate-intent foundation.
-- Additive only: no existing topics, articles, Wix IDs or URLs are deleted or renamed.

create extension if not exists pg_trgm;

alter table public.knowledge_topics
  add column if not exists canonical_intent text,
  add column if not exists article_angle text,
  add column if not exists duplicate_override_reason text;

alter table public.knowledge_articles
  add column if not exists canonical_intent text,
  add column if not exists article_angle text,
  add column if not exists duplicate_override_reason text;

-- Preserve every existing record while giving legacy topics a usable intent value.
update public.knowledge_topics
set canonical_intent = coalesce(nullif(trim(intent), ''), title)
where nullif(trim(canonical_intent), '') is null;

update public.knowledge_articles a
set canonical_intent = coalesce(nullif(trim(t.canonical_intent), ''), nullif(trim(t.intent), ''), t.title, a.title),
    article_angle = coalesce(nullif(trim(a.article_angle), ''), nullif(trim(t.article_angle), ''))
from public.knowledge_topics t
where a.topic_id = t.id
  and nullif(trim(a.canonical_intent), '') is null;

update public.knowledge_articles
set canonical_intent = title
where nullif(trim(canonical_intent), '') is null;

create index if not exists knowledge_topics_canonical_intent_idx
  on public.knowledge_topics (lower(trim(canonical_intent)));

create index if not exists knowledge_topics_canonical_intent_trgm_idx
  on public.knowledge_topics using gin (lower(canonical_intent) gin_trgm_ops);

create index if not exists knowledge_articles_canonical_intent_idx
  on public.knowledge_articles (lower(trim(canonical_intent)));

create index if not exists knowledge_articles_canonical_intent_trgm_idx
  on public.knowledge_articles using gin (lower(canonical_intent) gin_trgm_ops);

-- Reusable full-catalogue topic matcher. Archived topics are deliberately included so
-- a retired subject remains visible instead of silently returning as a new idea.
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
    end as duplicate_risk
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

-- Equivalent article matcher for the final approval/publishing safeguard.
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
    end as duplicate_risk
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

-- Final database safeguard for exact or extremely similar duplicate intent. A deliberate
-- exception is possible only when the editor records why the article angle is genuinely distinct.
create or replace function public.guard_knowledge_topic_duplicate_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_topic public.knowledge_topics%rowtype;
  candidate_intent text;
  candidate_similarity real;
begin
  new.canonical_intent := coalesce(nullif(trim(new.canonical_intent), ''), nullif(trim(new.intent), ''), new.title);
  candidate_intent := lower(trim(new.canonical_intent));

  select t,
         similarity(lower(coalesce(t.canonical_intent, t.intent, t.title)), candidate_intent)
    into existing_topic, candidate_similarity
  from public.knowledge_topics t
  where t.id <> coalesce(new.id, gen_random_uuid())
    and (
      lower(trim(coalesce(t.canonical_intent, t.intent, t.title))) = candidate_intent
      or similarity(lower(coalesce(t.canonical_intent, t.intent, t.title)), candidate_intent) >= 0.92
    )
  order by
    (lower(trim(coalesce(t.canonical_intent, t.intent, t.title))) = candidate_intent) desc,
    similarity(lower(coalesce(t.canonical_intent, t.intent, t.title)), candidate_intent) desc,
    (t.status <> 'archived') desc,
    t.updated_at desc
  limit 1;

  if found and nullif(trim(new.duplicate_override_reason), '') is null then
    raise exception using
      errcode = '23505',
      message = format(
        'Duplicate Knowledge Hub intent detected. Existing topic: "%s" (%s). Add a genuinely distinct article angle and an override reason before saving.',
        existing_topic.title,
        existing_topic.status
      ),
      detail = format('Intent similarity: %s', round(candidate_similarity::numeric, 3));
  end if;

  return new;
end;
$$;

drop trigger if exists knowledge_topics_duplicate_intent_guard on public.knowledge_topics;
create trigger knowledge_topics_duplicate_intent_guard
before insert or update of title, intent, canonical_intent, article_angle, duplicate_override_reason
on public.knowledge_topics
for each row execute function public.guard_knowledge_topic_duplicate_intent();

-- Keep article intent metadata aligned with its saved topic unless an editor has deliberately
-- supplied a more specific article-level value.
create or replace function public.populate_knowledge_article_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_topic public.knowledge_topics%rowtype;
begin
  if new.topic_id is not null then
    select * into source_topic
    from public.knowledge_topics
    where id = new.topic_id;
  end if;

  new.canonical_intent := coalesce(
    nullif(trim(new.canonical_intent), ''),
    nullif(trim(source_topic.canonical_intent), ''),
    nullif(trim(source_topic.intent), ''),
    source_topic.title,
    new.title
  );
  new.article_angle := coalesce(
    nullif(trim(new.article_angle), ''),
    nullif(trim(source_topic.article_angle), '')
  );

  return new;
end;
$$;

drop trigger if exists knowledge_articles_intent_population on public.knowledge_articles;
create trigger knowledge_articles_intent_population
before insert or update of topic_id, title, canonical_intent, article_angle
on public.knowledge_articles
for each row execute function public.populate_knowledge_article_intent();