# Knowledge Hub V1

Knowledge Hub is a protected Marketing CRM React route at `/knowledge-hub`. It uses the shared
sidebar, page layout, field, button, notice, panel and status styles already used by the app.

## Architecture

- `pages/KnowledgeHubPage.jsx` provides the dashboard, Topic Library, generation form, Article
  Library, Article Editor, preview, quality checklist and settings.
- `services/knowledgeHub.js` sends protected requests with the existing Marketing CRM access key.
- `api/marketing-knowledge-hub.js` validates that access key, uses the existing server-side
  Supabase service-role pattern and performs all database and AI work.
- `lib/knowledgeHub.js` contains the structured response parser, duplicate detection, Markdown
  conversion, editor validation and transparent quality safeguards.

No browser receives the Supabase service-role key. The migration creates no anon/public RLS
policies.

## Database

Apply `supabase/migrations/016_knowledge_hub_v1.sql` to the Marketing CRM Supabase project. It is
additive and does not change customer, import, matching, export, campaign, suppression, activity,
Finance sync or Rent2Buy sync tables.

The migration creates:

- `knowledge_topics`
- `knowledge_templates`
- `knowledge_articles`
- `knowledge_settings`

It also seeds the seven editable article templates required by V1.

## AI response

Generation uses the deployment's `OPENAI_API_KEY` and optional `OPENAI_MODEL`. The server requests
strict JSON containing title, slug, SEO fields, excerpt, Markdown, HTML, FAQ entries, CTA, internal
link suggestions and generation metadata. The response is validated before a draft is inserted.

Prompts explicitly reject invented rates, approval guarantees, vehicle availability, prices, legal
claims and company policies. Uncertain business-specific facts must be marked for review.

## Verification

```bash
npm test
npm run build
```

Wix export, batch article generation, publishing, scheduling, social posting, email/SMS sending,
analytics and Reel Factory integration remain out of scope.
