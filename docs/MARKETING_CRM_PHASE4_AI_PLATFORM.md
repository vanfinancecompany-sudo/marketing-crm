# Marketing CRM Phase 4 — AI Marketing Platform

Phase 4 connects Knowledge Hub, Business Intelligence and Campaign Engine without replacing their existing workflows. Business Brain remains the single shared source for company facts, products, brand voice, writing rules, compliance, FAQs, personas, sales knowledge, vocabulary and preferred CTAs.

## Architecture

- `lib/businessIntelligence.js` owns prompt construction through `buildAiPlatformPrompt`. The V3 `buildBusinessIntelligencePrompt` interface remains backward compatible and delegates to it.
- `lib/aiMarketingPlatform.js` contains reusable, side-effect-free channel definitions, completeness scoring, SEO checks, planner grouping, internal-link suggestions and structured response validation.
- `api/marketing-ai-platform.js` is a protected, server-only orchestration route. It reads the existing `MARKETING_CUSTOMER_DATABASE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` and optional `OPENAI_MODEL`.
- `services/aiMarketingPlatform.js` follows the existing Marketing CRM access-header and JSON-response patterns.
- `pages/ContentFactoryPage.jsx` provides Content Factory, SEO Intelligence, Business Brain completeness and Website Intelligence.
- Topic Planner remains inside Knowledge Hub. Create Campaign From Article remains inside Marketing Centre.

The shared prompt builder accepts a module, selected specialist, requested task and source material. This contract can support Knowledge Hub, Campaign Engine, Email Templates, Social Posts, SMS, Vehicle Descriptions, YouTube and Sales Assistant without changing Business Brain storage.

## Manual workflow safeguards

- Content Factory accepts approved Knowledge Articles only.
- Each channel is generated in a separate AI request and separate database row.
- Generated assets always start as `draft`.
- Draft edits invalidate the previous review fingerprint.
- An asset cannot be approved until AI Review has scored the current content.
- AI Review saves advisory scores, recommendations and warnings. It never edits or approves.
- Website analysis saves a `review` import. Applying reviewed sections only appends missing structured entries and never overwrites existing Business Brain content.
- Create Campaign From Article creates an email campaign in `draft` with an uncalculated audience. It does not create a batch or send.
- SEO and internal-link intelligence are suggestions only.
- “Recently Published” in Topic Planner is a planning label based on manual Knowledge Article approval. No publishing action exists.

There is no automatic publishing, emailing, posting or SMS action.

## Database

Apply `supabase/migrations/019_marketing_crm_phase4_ai_platform.sql` after migration 018.

The migration is additive:

- adds value, difficulty, persona, seasonal and opportunity fields to `knowledge_topics`;
- creates private RLS-enabled `marketing_ai_assets`;
- creates private RLS-enabled `knowledge_website_imports`;
- creates reusable private RLS-enabled `marketing_ai_reviews`;
- adds nullable Knowledge Article and AI asset source references to `marketing_campaigns`.

No prior migration, existing status check, public policy or customer-facing table is replaced.

## Deployment

No new environment variable is required. Phase 4 uses the same variables as V3:

- `MARKETING_CUSTOMER_DATABASE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; defaults to the existing `gpt-4.1-mini`)

Apply migration 019 before exercising the new page in a Preview deployment. The Vercel build itself does not connect to Supabase.

## Verification

Run:

```bash
npm test
npm run build
git diff --check
```

The repository does not define a separate lint script. Vite’s production transform and Node’s test runner provide the current syntax/module validation used by the project.
