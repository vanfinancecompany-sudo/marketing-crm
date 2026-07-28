# Knowledge Hub duplicate protection

## Purpose

Strengthen duplicate detection before the Knowledge Hub is expanded to hundreds of articles, without changing existing Wix article URLs or introducing subcategories yet.

## This foundation adds

- `canonical_intent` on topics and articles
- `article_angle` on topics and articles
- `duplicate_override_reason` for deliberate exceptions
- legacy backfill using the existing topic intent first, then the title, so no record is left blank
- indexed full-catalogue duplicate matching, including archived topics
- database protection against exact and extremely similar duplicate topic intent across every save path
- reusable topic and article matchers returning `duplicate`, `likely_duplicate`, `related` or `clear`
- article metadata inheritance from the linked topic

## Deliberate rollout order

1. Apply the additive migration in Preview Supabase.
2. Confirm all existing topics and articles remain present.
3. Run both duplicate-candidate functions against representative topics and articles.
4. Add the CRM controls that display canonical intent, article angle and closest matches.
5. Apply the matcher visibly to manual topic saves, AI Topic Finder saves, generation and approval.
6. Require a visible override reason for a deliberate distinct angle.
7. Test Preview before applying the migration to Production.

## Topic matcher example

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

## Article matcher example

```sql
select *
from public.find_knowledge_article_duplicate_candidates(
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

The database trigger blocks exact canonical-intent duplicates and exceptionally close intent matches at 0.92 or above unless an editor records an override reason. Lower-confidence matches remain review warnings so a valid related angle is not automatically rejected.

## Archived topics

Archived topics remain in duplicate history. This prevents an old subject being silently recreated. A deliberate replacement can still be saved by supplying a genuinely distinct canonical intent/article angle or recording an override reason.

## Preview checks

Use subjects that cover each outcome:

1. Exact same title and intent — must be blocked.
2. Different title with the same canonical intent — must be blocked.
3. Very close intent wording — must be blocked unless an override reason is recorded.
4. Related subject with a clearly different article angle — should appear as `related` but remain saveable.
5. Match against an archived topic — must still appear in results.
6. Unrelated subject in the same category — should return `clear` or no candidate.
7. Unrelated subject in a different category — should not be incorrectly blocked.

No existing record should be edited, archived or deleted during these checks.

## Subcategories

Subcategories and topic clusters are intentionally deferred. They can be added later without changing the current Wix dynamic article page or article URLs, even after hundreds of articles exist.

## Safety

- additive migration only
- no records deleted
- no Wix IDs, slugs or URLs changed
- no automatic publishing
- no existing category values changed
- no subcategory migration included