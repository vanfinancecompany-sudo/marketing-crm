# Knowledge Hub duplicate protection

## Purpose

Strengthen duplicate detection before the Knowledge Hub is expanded to hundreds of articles, without changing existing Wix article URLs or introducing subcategories yet.

## This foundation adds

- `canonical_intent` on topics and articles
- `article_angle` on topics and articles
- `duplicate_override_reason` for deliberate exceptions
- legacy backfill using the existing title so no record is left blank
- indexed full-catalogue duplicate matching, including archived topics
- exact-intent database protection across every save path
- a reusable matcher that returns `duplicate`, `likely_duplicate`, `related` or `clear`
- article metadata inheritance from the linked topic

## Deliberate rollout order

1. Apply the additive migration in Preview Supabase.
2. Confirm all existing topics and articles remain present.
3. Run the duplicate-candidate function against representative topics.
4. Add the CRM controls that display canonical intent, article angle and closest matches.
5. Apply the same matcher to manual topic saves, AI Topic Finder saves, generation and approval.
6. Require a visible override reason for a deliberate distinct angle.
7. Test Preview before applying the migration to Production.

## Matcher example

```sql
select *
from public.find_knowledge_topic_duplicate_candidates(
  'Can I get van finance after a CCJ?',
  'Eligibility for van finance with a CCJ',
  'Credit',
  null,
  10
);
```

## Behaviour

- Exact normalised title or canonical intent: `duplicate`
- Intent similarity of at least 0.82: `likely_duplicate`
- Title similarity of at least 0.72 or intent similarity of at least 0.68: `related`
- Otherwise: `clear`

The database trigger blocks only an exact canonical-intent duplicate. Similarity results are intended for the CRM review screen so the editor can distinguish a genuine duplicate from a valid related angle.

## Archived topics

Archived topics remain in duplicate history. This prevents an old subject being silently recreated. A deliberate replacement can still be saved by supplying a distinct canonical intent/article angle or recording an override reason.

## Subcategories

Subcategories and topic clusters are intentionally deferred. They can be added later without changing the current Wix dynamic article page or article URLs, even after hundreds of articles exist.

## Safety

- additive migration only
- no records deleted
- no Wix IDs, slugs or URLs changed
- no automatic publishing
- no existing category values changed
- no subcategory migration included
