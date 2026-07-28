-- Fix PostgreSQL record assignment in the Knowledge Hub duplicate-intent guard.
-- Safe to run after a partial or failed migration 026.

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
