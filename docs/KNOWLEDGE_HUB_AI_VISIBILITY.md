# Knowledge Hub AI Visibility Centre

This feature connects confirmed Wix publications to stored indexing and AI-visibility
evidence. It does not infer, estimate or fabricate rankings, mentions, citations or
detections.

## Deployment

Apply the additive migration:

`supabase/migrations/023_knowledge_hub_ai_visibility.sql`

No new environment variables are required for the evidence framework or manual result
entry. All automated provider adapters remain in `configuration_required` until a
supported evidence integration is implemented and configured.

## Evidence workflow

1. Confirm the approved article's live Wix URL and publication date in the AI
   Visibility Centre. This records publication metadata only; it does not publish to
   Wix.
2. Derive monitoring prompts from the article title, topic intent, FAQs and selected
   Business Brain terminology.
3. Review, edit, disable or add prompts.
4. Record externally verified evidence manually while provider adapters are not
   connected.
5. Review current provider state and the complete historical result log.

Manual results are labelled `manually_verified`. Positive results require evidence,
and a `cited` result additionally requires the citation source URL.

## Counting rules

- **Published pages:** confirmed live Wix URL, publication timestamp, live/synced Wix
  state and manual publication verification.
- **Google indexed:** the latest effective Google Search Console result is `indexed`.
- **AI visible:** at least one latest effective AI-provider prompt result is
  `detected`, `mentioned` or `cited`.
- **Total verified detections:** effective historical `detected`, `mentioned` and
  `cited` events. Superseded results are retained but excluded.
- **Awaiting first check:** no completed result. `checking` and `error` do not count
  as completed evidence.
- **Needs attention:** the configured age threshold has passed and successful stored
  evidence shows `not_indexed` or an eligible AI check with no current detection.
- **Visibility rate:** AI-visible pages divided by pages with at least one completed
  AI-provider result. Unchecked pages and provider errors are excluded.

## Provider architecture

Adapters are prepared for Google Search Console, ChatGPT, Gemini, Perplexity and
Google AI Overviews. The initial adapters deliberately return `error` with
`configuration_required`, update connection history and state that no public
visibility was claimed. A model API response is not treated as public search evidence.

## Wix readiness

Article records support Wix item ID, collection ID, live URL, published timestamp,
last sync, sync status and publication verification. Full Wix publishing and
synchronisation are outside this feature.
