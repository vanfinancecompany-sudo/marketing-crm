-- Recovery migration for environments where migration 026 failed before the new columns were committed.
-- Safe to run repeatedly.

create extension if not exists pg_trgm;

alter table public.knowledge_topics
  add column if not exists canonical_intent text,
  add column if not exists article_angle text,
  add column if not exists duplicate_override_reason text;

alter table public.knowledge_articles
  add column if not exists canonical_intent text,
  add column if not exists article_angle text,
  add column if not exists duplicate_override_reason text;

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
  new.canonical_intent := coalesce(
    nullif(trim(new.canonical_intent), ''),
    nullif(trim(new.intent), ''),
    new.title
  );
  candidate_intent := lower(trim(new.canonical_intent));

  select t.*
    into existing_topic
  from public.knowledge_topics t
  where t.id <> coalesce(new.id, gen_random_uuid())
    and (
      lower(trim(coalesce(t.canonical_intent, t.intent, t.title))) = candidate_intent
      or similarity(
        lower(coalesce(t.canonical_intent, t.intent, t.title)),
        candidate_intent
      ) >= 0.92
    )
  order by
    (lower(trim(coalesce(t.canonical_intent, t.intent, t.title))) = candidate_intent) desc,
    similarity(
      lower(coalesce(t.canonical_intent, t.intent, t.title)),
      candidate_intent
    ) desc,
    (t.status <> 'archived') desc,
    t.updated_at desc
  limit 1;

  if found then
    candidate_similarity := similarity(
      lower(coalesce(existing_topic.canonical_intent, existing_topic.intent, existing_topic.title)),
      candidate_intent
    );
  end if;

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
