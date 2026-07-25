# Knowledge Hub Intelligent Internal Linking

PR102 adds an approved Website Index and a review-only internal-link recommendation
workflow.

## Deployment

Apply `supabase/migrations/022_intelligent_internal_linking_engine.sql` before
deploying the application. The migration is additive and extends the existing
`knowledge_business_pages` table.

No new environment variables are required.

## Editorial workflow

1. Add active, verified internal destinations to **Knowledge Hub → Website Index**.
2. Generate or review an article, or select **Refresh Suggestions** in the editor.
3. Review the destination, proposed anchor, confidence score, reason, and placement
   context.
4. Edit the anchor if necessary, then accept or reject the suggestion.

Accepting a suggestion records an editorial decision. It does not modify the article,
publish content, or call an external website API.

## Safeguards

- Only relative URLs or URLs on the configured business website are accepted.
- Hidden index entries are excluded.
- A Knowledge Hub destination must reference an approved article; drafts, rejected
  items, archived items, and the current article are excluded.
- Destinations are de-duplicated and results are capped at eight.
- Matching prioritises buying intent and vehicle category mappings over manufacturer
  name overlap.
- Generation, refresh, acceptance, rejection, anchor edits, supersession, and index
  changes are recorded in `knowledge_internal_link_events`.

## Future Wix CMS synchronisation

Website Index entries include `source`, `external_id`, `sync_metadata`, and
`last_synced_at`. These fields allow a later synchronisation process to reconcile Wix
records without changing the internal-link engine. PR102 does not depend on or call
Wix APIs.
