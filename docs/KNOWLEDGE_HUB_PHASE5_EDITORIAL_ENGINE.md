# Knowledge Hub Phase 5 — AI Editorial Engine

Phase 5 adds a reusable editorial intelligence layer without changing the V1–V4 article,
Business Brain, campaign, approval or archive contracts. It does not publish, send, post or
automatically accept content changes.

## Architecture

- `lib/editorialIntelligence.js` owns deterministic normalization, weighted scoring, health,
  approval queue and knowledge coverage rules.
- `api/marketing-editorial-engine.js` is a protected server-only API. It uses the existing
  `MARKETING_CUSTOMER_DATABASE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY` and optional `OPENAI_MODEL` environment variables.
- `buildAiPlatformPrompt` remains the single Business Brain prompt assembler. The editorial
  engine supplies the selected task, saved article, allowed destinations, allowed article/page
  targets and coverage concepts to it.
- `services/editorialEngine.js` exposes the browser client using the existing Marketing access
  header pattern.
- `components/KnowledgeHubV5Panels.jsx` contains modular queue, coverage, score, health, intent,
  recommendation, proposal and history panels.
- `020_knowledge_hub_phase5_editorial_engine.sql` is additive. No earlier migration is modified.

## Editorial assessment

One strict structured AI response produces:

- Business Intent and confidence
- structured CTA recommendations
- contextual internal-link recommendations
- Business Brain-supported recommendations
- thirteen scored editorial categories
- strengths, weaknesses, lost points and suggested improvements
- business concept coverage
- risk warnings

The application validates the response before storage. CTA destinations are restricted to saved
Business Pages, the configured website and destinations confirmed in Preferred CTAs. Internal
links are restricted to approved articles and saved Business Pages, with unique anchors, minimum
relevance and a six-link limit. Business recommendations are discarded unless their cited excerpt
exists in the referenced Business Brain section.

The deterministic scorer applies weights totalling 100%. Critical warnings, Business Accuracy
below 50 or Business Brain Compliance below 50 block publication readiness. The AI cannot approve
an article.

## Manual control

- Intent, CTA and internal-link recommendations can be overridden and are preserved separately.
- A one-click improvement first creates a review-only proposal.
- Only the explicit **Apply to Draft** action changes an article.
- Applying a proposal returns the article to `draft`, records a revision and refreshes its
  assessment.
- Existing Save Draft, Approve, Archive, bulk approval and V3 Reviewer controls remain available.
- Missing, stale or blocked editorial analysis produces an explicit warning; approval remains a
  user decision.

## Recalculation and history

Generated and saved articles are automatically assessed. Existing unscored articles can be
processed with **Analyse Unscored Articles**. Article changes use a stable content fingerprint.
Business Brain updates create a global editorial event and mark existing assessments stale.

Immutable assessment snapshots retain score history. Article revision snapshots record user edits,
reviewed AI improvements, approvals, archives and score recalculations. The schema includes
publication event support for Phase 6, but Phase 5 creates no publishing action.

## Database

Migration `020_knowledge_hub_phase5_editorial_engine.sql` adds:

- `knowledge_business_pages`
- `knowledge_concepts` with the eleven requested initial business concepts
- `knowledge_article_intents`
- `knowledge_article_editorial_assessments`
- `knowledge_article_editorial_overrides`
- `knowledge_article_concepts`
- `knowledge_article_revisions`
- `knowledge_article_improvement_proposals`
- `knowledge_editorial_events`

All tables use RLS with no browser policies. Protected Vercel routes use the existing service role.

## Deployment

1. Apply migration `020_knowledge_hub_phase5_editorial_engine.sql`.
2. Confirm the existing server variables are present in the Vercel project:
   `MARKETING_CUSTOMER_DATABASE_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL`; the existing default is `gpt-4.1-mini`.
4. Deploy and use **Analyse Unscored Articles** once for articles created before Phase 5.

No new environment variable is required.
