# Knowledge Hub Phase 6 — AI Editorial Automation

Phase 6 adds asynchronous editorial preparation to the existing Knowledge Hub. It preserves the
V1–V5 article, Business Brain, scoring and approval contracts. Automation can discover, prepare,
assess and propose improvements, but it cannot approve, publish, schedule, send, post or modify the
website.

## Architecture

- `lib/editorialAutomation.js` owns deterministic safety rules, opportunity scanning,
  deduplication, prioritisation, quality thresholds, briefing summaries and retry timing.
- `api/marketing-editorial-automation.js` is the protected management API used by the CRM. It
  loads automation state, saves bounded settings, pauses or resumes processing, queues scans,
  records manual opportunity decisions, and cancels or retries queued work.
- `api/marketing-editorial-automation-worker.js` is the protected background worker. Vercel invokes
  it hourly; each invocation claims a bounded batch through an atomic Supabase function.
- Existing Knowledge Hub generation and Phase 5 editorial analysis functions are reused. Business
  Brain prompt assembly, structured AI validation, duplicate safeguards, revision history and
  scoring therefore remain the single source of truth.
- `components/KnowledgeHubV6Panels.jsx` adds the daily briefing, opportunity review, queue history,
  execution log, pause controls and cost/quality settings within the existing Knowledge Hub page.
- `021_knowledge_hub_phase6_editorial_automation.sql` is additive. No prior migration is changed.

## Processing model

The queue supports priority ordering, idempotency keys, retry limits, delayed retries, cancellation
before execution, pause/resume, run history, result details, execution logs and duration tracking.
Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so concurrent workers cannot process the same queued
job. A failed job receives a capped exponential retry delay and retains its error history.
Worker leases older than twenty minutes are safely returned to the queue and logged, allowing a
later invocation to recover from a terminated serverless execution.

The hourly worker creates idempotent recurring jobs:

- Opportunity scan at the configured scan interval
- AI topic discovery once per day
- Daily briefing once per day

**Scan & Discover Now** only queues work. It does not wait for AI generation and does not block the
browser.

## Editorial modules

### Opportunity Scanner

The deterministic scanner evaluates active articles, latest Phase 5 assessments, topics, the
coverage map and Business Brain concepts. It identifies stale articles, low scores, duplicate
search intent, missing FAQs, weak CTAs, weak internal linking and uncovered knowledge. Every
opportunity stores its reason, evidence, priority factors and a source-version fingerprint.

### Topic Discovery

The existing structured Topic Finder creates distinct ideas focused on useful UK van buying
decisions and suitable customer applications. Exact and strong near-duplicates are merged. Ideas
are classified and saved only as draft opportunities; the user must approve preparation.

### Draft Factory

Only a manually approved missing-topic opportunity can queue article preparation. The factory uses
the existing specialist template, Business Brain prompt builder, structured generation validator,
duplicate protection and Phase 5 assessment engine. It also prepares metadata, FAQs, CTAs and
internal-link recommendations through those existing services.

New automation-created drafts may receive a bounded number of automatic improvement passes. Every
pass creates a revision and a scored assessment. A draft is marked `ready_for_review` only when it
meets the configured score threshold and has no blocking or critical warning. Otherwise it is
marked `needs_improvement`. Neither state is approval.

### Improvement Engine

For an existing user draft, automation reassesses the article and creates a review-only improvement
proposal. It does not apply or overwrite the user's content. The user retains the existing
**Apply to Draft** action and can ignore or reject the proposal.

### Daily Briefing and Approval Queue

The briefing summarises completed work, ranks review priorities by editorial priority and estimates
review time. Prepared articles flow into the existing Phase 5 approval queue and retain the existing
manual draft → review → approval workflow.

## Safety boundary

The shared safety policy rejects automation actions for:

- Publication or approval
- Publication scheduling
- Website modification
- Email campaigns or sending
- SMS sending
- Social posting

No worker code contains an approval or publishing action. The user is the only authority that can
approve an article. Cancellation, dismissal, manual overrides, revision history and immutable
execution logs keep automated work reviewable, explainable and reversible.

## Database

Migration `021_knowledge_hub_phase6_editorial_automation.sql` adds:

- `knowledge_automation_settings`
- `knowledge_automation_opportunities`
- `knowledge_automation_runs`
- `knowledge_automation_jobs`
- `knowledge_automation_logs`
- `knowledge_automation_briefings`
- `knowledge_articles.automation_state`
- `knowledge_articles.source_automation_opportunity_id`
- `claim_knowledge_automation_jobs`

The new tables use RLS with no browser policies. Protected Vercel routes use the existing Supabase
service role.

## Deployment

1. Apply `supabase/migrations/021_knowledge_hub_phase6_editorial_automation.sql`.
2. Confirm the existing server variables are present in the Vercel project:
   `MARKETING_CUSTOMER_DATABASE_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`.
3. Optionally set `OPENAI_MODEL`; the existing default remains unchanged.
4. Add a strong `CRON_SECRET` for the Production environment. Vercel sends it as the bearer token
   when invoking the hourly cron route. Add it to Preview too if the worker will be invoked there.
5. Deploy. Confirm the Vercel cron for `/api/marketing-editorial-automation-worker` is registered,
   then use **Scan & Discover Now** or wait for the hourly run.

`CRON_SECRET` is the only new environment variable. The management route continues to use the
existing Marketing access key. The worker accepts that same key for an authenticated manual
invocation, while scheduled Vercel calls use `CRON_SECRET`.

Default controls limit each worker run to three jobs, automated draft creation to three per day,
automatic new-draft improvement to two passes and retries to three attempts. These values are
editable in the CRM within bounded safe ranges. Setting the daily draft limit to zero disables
automated draft creation without disabling scanning and briefings.
