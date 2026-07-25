# Knowledge Hub V2 – Content Intelligence

V2 extends the protected `/knowledge-hub` route without replacing the V1 editor, preview, quality
checklist, draft workflow, approval controls or archive/bulk workflows. Nothing publishes,
schedules, emails, texts or posts content.

## Database

Apply `supabase/migrations/017_knowledge_hub_v2_content_intelligence.sql` after the V1 migration.
The migration is additive:

- adds one-to-five priority, source and finder metadata fields to `knowledge_topics`
- expands `knowledge_settings` with business context, confirmed factual guidance, prohibited
  claims, target audiences, content goals and an editable freshness threshold
- upgrades five V1 templates with specialist prompts and adds `vehicle-review`
- preserves all seven V1 templates, tables, rows and private RLS posture

No customer, stock, campaign, suppression, import, Finance sync or Rent2Buy sync table is changed.

## Business Settings and specialist templates

Business Settings are stored in the existing singleton `knowledge_settings` row. The server includes
them in both Topic Finder and article-generation context. Specialist prompts remain editable rows in
`knowledge_templates` and are saved through the existing protected, service-role API.

The specialist set covers:

- Finance
- Rent2Buy
- Vehicle Review
- Comparison
- Buying Guide
- FAQ

The original Vehicle Guide and Checklist templates remain available.

## Topic Planner and Topic Finder

Topic Planner adds priority and priority filtering to the V1 Topic Library, plus selection for batch
generation. AI Topic Finder uses strict Structured Outputs to return editable suggestions grouped by
category. Suggestions are held in browser state until explicitly selected and saved.

The server checks suggestions against existing topics and each other. Exact and probable
near-duplicates are skipped when suggestions are generated and checked again when selected ideas are
saved.

## Batch generation

Batch generation is deliberately sequential and limited to ten topics per run. Each topic calls the
existing protected generation action separately:

- every successful article is saved immediately as a draft
- a failure is recorded against only that topic
- completed drafts are not rolled back
- topics with an existing non-archived article are excluded
- no draft is approved, exported or published automatically

This avoids a long all-or-nothing serverless request and preserves the V1 review gate.

## Content Intelligence

The dashboard derives explainable analytics from stored Knowledge Hub records:

- article totals by status, category and template
- checklist pass rate and articles with warnings
- approved articles older than the configured freshness threshold
- exact and probable topic/article duplicate pairs
- categories missing active topics or approved articles
- high-priority topics without active article coverage

These are operational indicators, not traffic estimates, SEO rankings or guaranteed AI-visibility
scores.

## API and deployment

V2 continues to use:

- `MARKETING_CUSTOMER_DATABASE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`

Supabase and OpenAI credentials remain server-only. The existing deployment-host diagnostics are
preserved.

## Verification

```bash
npm test
npm run build
git diff --check
```
