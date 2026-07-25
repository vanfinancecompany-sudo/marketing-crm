# Knowledge Hub V3 – Business Intelligence

V3 adds a reusable Business Intelligence foundation to the protected Knowledge Hub. It preserves
the existing Topic Planner, Topic Finder, batch generation, editor, preview, transparent quality
checklist, draft workflow, approval controls and archive/bulk actions.

Nothing in V3 publishes content or changes an article automatically.

## Database

Apply `supabase/migrations/018_knowledge_hub_v3_business_intelligence.sql` after migrations 016 and
017. The additive migration creates:

- `knowledge_business_sections` for structured, reusable business context
- `knowledge_article_reviews` for immutable advisory review snapshots

Both tables have RLS enabled with no browser policies, matching the existing Knowledge Hub's
protected service-role API pattern. No existing table, workflow status or unrelated CRM module is
changed.

The migration seeds these section definitions:

1. Company Profile
2. Products
3. Brand Voice
4. Writing Rules
5. Compliance
6. FAQs
7. Customer Personas
8. Sales Knowledge
9. Business Vocabulary
10. Preferred CTAs

Existing V2 Business Settings are copied into relevant blank sections. V2 fields remain in place as
backward-compatible fallbacks.

## Reusable Prompt Builder

`lib/businessIntelligence.js` owns the shared contracts for:

- section definitions and normalization
- legacy Business Settings fallback
- reusable Business Intelligence context assembly
- specialist prompt composition
- prompt-version and section-key metadata
- AI Reviewer response parsing

Article generation now assembles the selected specialist, completed active Business Knowledge
sections, requested topic/audience/tone and global safeguards before calling OpenAI. Topic Finder
also consumes the same Business Knowledge context. The generated article records which sections and
specialist were used in `generation_metadata.business_intelligence`.

Future AI modules can call the same builder without depending on Knowledge Hub page components.

## AI Reviewer and Article Quality Score

AI Reviewer is available only for a saved draft. It uses strict Structured Outputs and returns:

- an overall score from 0–100
- Brand consistency, Readability, SEO, CTA quality and Compliance scores
- evidence-based reasons and findings
- strengths, issues and recommendations

Every review is inserted into `knowledge_article_reviews`. Running a new review creates a new
snapshot and keeps the previous history. The latest score appears in Article Library and the editor.

The reviewer has no article update path. It cannot rewrite content, apply recommendations, approve,
archive or publish. Unsaved editor changes must be saved as a draft before review.

## Existing workflow

The article workflow remains:

`draft → human review/edit → manual approval → optional archive`

The existing transparent checklist remains independent of the advisory AI score. Bulk approval and
archive behaviour are unchanged. No publishing state or action is introduced.

## Environment

V3 reuses the existing server-only variables:

- `MARKETING_CUSTOMER_DATABASE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`

No additional deployment variable is required.

## Verification

```bash
npm test
npm run build
git diff --check
```
