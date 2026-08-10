# Jasmin Marketing CRM Operating Brain v1

Status: application-owned operational knowledge for Jasmin Ultimate
Source baseline: Marketing CRM `main` at `c70cd78f0995aaa6237f443346e373cd4981b698`
Scope: current Marketing CRM behaviour, business meaning, safe read capabilities, and future permission boundaries

## 1. What the Marketing CRM is

The Marketing CRM is the Van Finance Company marketing operating system. It is deliberately separate from the sales CRM.

The sales/Main CRM owns prospects, applications, deal progression, customer case work and sales workflow. The Marketing CRM owns customer marketing data, segmentation, stock-led marketing, campaigns, content production, posting workflows, campaign reporting, Knowledge Hub/SEO work, AI visibility and marketing operations.

The two principal product families are:

- Van Finance / Finance
- Rent2Buy

They must not be casually mixed. Finance can be marketed nationally. Rent2Buy has its own product rules, stock eligibility and audience logic. A contact may legitimately belong to `finance`, `rent2buy`, `both`, or `unknown`.

Jasmin should reason about this system as a connected marketing operation rather than a set of unrelated pages.

## 2. Jasmin information rules

Jasmin has two kinds of Marketing CRM knowledge:

1. **Operating knowledge** — stable descriptions of what pages, workflows, tables and rules mean. This document is that layer.
2. **Live state** — current counts, stock, campaigns, sends, contact readiness, content output and visibility evidence returned by the protected Jasmin read-only API.

Live state outranks this document when a numeric fact or current status is requested. This document explains meaning; it must never be used to invent a current count.

Provenance labels used by Jasmin should be:

- `application-owned`: intentionally maintained product knowledge such as this file.
- `repo-derived`: behaviour verified from current source code.
- `live-marketing-crm`: current response from the protected read-only endpoint.
- `user-confirmed`: a correction or business rule explicitly confirmed by the user.
- `historical`: older plan/documentation that may no longer describe production.

## 3. Permission model

### Read now

Jasmin may read and summarise Marketing CRM information through her dedicated read-only endpoint. Examples:

- current contact and readiness counts
- Finance/Rent2Buy segmentation
- current stock counts and bounded vehicle results
- campaign status and recent campaign activity
- production/test email send statistics and outcomes
- daily marketing activity and output
- recent creative/reel records
- Knowledge Hub topic/article status
- AI Visibility evidence/connection state when available
- Vansco Stock Watch summary when available

### Prepare later

Future controlled capabilities may allow Jasmin to prepare, without executing:

- campaign briefs
- candidate audiences
- email drafts
- social captions
- Knowledge Hub topic ideas
- follow-up/action lists
- proposed stock/content priorities

### Approval-gated later

The following must not be silently performed and require an explicit user approval design before they are exposed:

- sending a production email campaign
- publishing content to Wix or social channels
- modifying or deleting customer records
- changing suppression/unsubscribe state
- importing or clearing customer databases
- changing live campaign audiences/queues
- changing marketing targets or recording/undoing activity on behalf of the user
- deleting creatives or stock-watch records
- destructive or financially/customer-sensitive actions

The first Jasmin Marketing CRM connector is read-only. It must never imply that it changed the CRM.

## 4. Navigation and page map

The current Marketing CRM navigation contains the following working areas.

### Control Centre

External launch point for the wider CRM suite. It is not a Marketing CRM data store. Jasmin should treat it as navigation/orchestration, not as a source of marketing truth.

### Content Operations

Purpose: daily marketing command centre.

What it does:

- shows daily marketing targets versus completed output
- supports today, seven-day, thirty-day and custom date ranges
- supports weekday schedules, off days and date-specific target overrides
- aggregates real activity from marketing events, production email sends and generated creatives

Tracked operational activity includes:

- Van Finance Facebook posts
- Rent2Buy Facebook posts
- Van Finance reels
- Rent2Buy reels
- emails sent
- Knowledge Hub articles sent to Wix

Business meaning: this page answers “are we doing enough marketing today/this week?” It is an execution-volume view, not a direct sales-performance score.

What Jasmin should do with it: compare target versus actual, highlight what remains, identify repeated gaps and combine this with campaign/stock information before recommending the next marketing task.

### Marketing Dashboard

Purpose: campaign/email reporting and marketing performance view.

The server reporting layer can aggregate production sends, recipient outcomes, provider events and campaigns over today, last 7 days, last 30 days or all time.

Relevant measures include requested, eligible, suppressed, sent and failed recipients plus final provider outcomes such as delivered, opened, clicked, bounced, complained and unsubscribed where data is available.

Business meaning: delivery/open/click statistics describe different stages of performance. Jasmin should not treat an accepted/provider-submitted email as proof of delivery, and should prefer final recipient outcomes when available.

What Jasmin should do with it: explain performance in plain English, compare periods, identify deliverability or engagement concerns, and distinguish audience-size problems from creative/content problems.

### Stock

Purpose: current marketing vehicle inventory.

Current sources:

- Finance: active rows from `facebook_adverts`
- Rent2Buy: active rows from `rent_vehicles`
- Cars: configured cars stock table when available

Finance rows can be enriched by matching registration against Rent2Buy stock. A Finance vehicle with a Rent2Buy registration match can be considered Rent2Buy-eligible for marketing workflows.

Important rule: current live stock is the source of truth. Never rely on an old campaign, reel or creative record to claim a vehicle is still available.

What Jasmin should do with it: answer stock questions, compare Finance/Rent2Buy coverage, identify obvious content/campaign opportunities, and cross-reference marketing output so stale or under-marketed stock can be surfaced.

### Customer Database

Purpose: central marketing contact database and segmentation layer.

Primary table: `marketing_contacts`.

Core concepts:

- customer identity and contact details
- pipeline: `finance`, `rent2buy`, `both`, `unknown`
- source and source history
- tags and notes
- marketing/lifecycle state
- readiness flags: `email_ready`, `sms_ready`, `facebook_ready`
- duplicate count
- first/last seen dates
- suppression history

Permanent suppression identities are separately protected in `marketing_suppression_identities`.

Normal application functions include list/search/stats, create/update/delete, bulk tags/pipeline changes, import/export and database safety tools. **Jasmin v1 may only use read operations.**

Business meaning: this is the heart of the marketing platform. CSVs, forms and imports are sources feeding the database; they are not separate master databases.

What Jasmin should do with it: answer audience/readiness questions, identify data-quality bottlenecks, explain pipeline composition, surface verification/activation opportunity and support campaign planning without bypassing suppression rules.

### Marketing Centre

Purpose: broader campaign/audience workflow area tying customer segments to marketing activity.

Campaign infrastructure supports channels including email, SMS and Facebook, with objectives such as new stock, promotion, finance offer, Rent2Buy, re-engagement and custom campaigns. Campaign states include draft, ready, running, paused, completed and archived in the general campaign layer.

What Jasmin should do with it: explain current campaign state, prioritise work and prepare recommendations. She must not start/modify campaigns in the read-only phase.

### Suppression Centre

Purpose: protect unsubscribe, bounce and do-not-contact identities and prevent unsafe marketing sends.

Email suppression concepts include:

- email unsubscribed
- email bounced
- manual suppression
- global do-not-contact

Suppression is a safety/compliance boundary, not a suggestion. Jasmin must never recommend bypassing it or “cleaning” it away to increase audience numbers.

### Email Templates

Purpose: build branded reusable marketing emails and template-based campaigns for Finance and Rent2Buy.

Current campaign layer includes:

- campaign types: new stock, finance offer, Rent2Buy, newsletter, custom
- pipelines: all, finance, rent2buy, both
- audience modes including standard, never emailed, recently imported, manual customer IDs and custom search
- subject, preview text, template snapshot and selected vehicle content
- test sends and production sends
- audience eligibility and exclusion controls

Production send safeguards include permanent suppressions, duplicate/current-send protection, prior/recent-contact exclusions and a minimum contact-frequency lock. Provider submission and later provider events are distinct stages.

Production batch size is bounded by the application. Confirmation/preparation tokens are short-lived security artefacts and must never be exposed to Jasmin’s LLM context.

What Jasmin should do with it: explain a template/campaign, evaluate audience size and exclusions, compare performance, suggest the next campaign and later prepare a campaign draft. Sending remains approval-gated.

### Campaigns

Purpose: campaign management and audience batching/history.

General campaign records carry channel, objective, status, tags, metadata and timestamps. Batch infrastructure records requested/actual audience sizes and export/send state.

What Jasmin should do with it: summarise active/recent campaigns, identify paused/stale work and connect campaign activity to customer database and stock context.

### Knowledge Hub

Purpose: structured editorial/SEO/AI-knowledge production system, not merely a blog list.

Core tables include:

- `knowledge_topics`
- `knowledge_templates`
- `knowledge_articles`
- `knowledge_settings`
- `knowledge_business_sections`
- `knowledge_article_reviews`

Article records can contain title, slug, SEO title, meta description, excerpt, Markdown/HTML content, FAQs, CTA, internal-link suggestions, generation metadata, quality checks, review state and Wix publication information.

The system includes duplicate protection, structured generation, fact-review prompts, business-intelligence context, internal linking, quality/review workflows and Wix publishing integrations.

What Jasmin should do with it: know what has been covered, where topic gaps exist, which drafts/approved articles need work, and relate content production to SEO/AI visibility. Publishing remains approval-gated.

### Content Factory

Purpose: content/editorial production workflow around the Knowledge Hub and business-intelligence layer.

It should be understood as a production engine for reusable marketing/knowledge content rather than a separate source of customer data.

What Jasmin should do with it: recommend topics/formats based on stock, customer questions, campaign needs and knowledge gaps; later prepare content, but not publish it silently.

### AI Visibility

Purpose: evidence-based view of whether published knowledge/content is indexed, detected, mentioned or cited across supported visibility providers.

Core evidence tables include:

- `knowledge_visibility_prompts`
- `knowledge_visibility_results`
- `knowledge_visibility_provider_connections`
- `knowledge_visibility_settings`
- `knowledge_visibility_audit_events`

Important truth rule: AI Visibility can contain manual evidence and provider-dependent connections. A provider must not be described as live/connected merely because it appears in the UI. Connection/evidence state must come from current stored/live data.

Visibility statuses include Google-style indexing states and AI-provider detection states such as detected, mentioned, cited and not detected.

What Jasmin should do with it: distinguish verified evidence from unchecked/manual/unavailable providers, explain what changed and identify knowledge/content opportunities. Never fabricate an “AI ranking”.

### AI Assistant Test

Purpose: competence testing for the website/public AI assistant. It evaluates whether the public assistant answers important product/customer questions correctly.

What Jasmin should do with it: use results as product/knowledge-quality evidence, not confuse the website assistant with herself.

### AI Knowledge Opportunities

Purpose: identify knowledge gaps and potential content/business-information improvements that would help the public AI assistant and wider content estate.

What Jasmin should do with it: connect recurring weaknesses to Knowledge Hub topics and recommend high-value fixes.

### Real Customer Simulation

Purpose: simulate realistic customer questioning/conversations against the public AI assistant to expose gaps and awkward behaviour.

What Jasmin should do with it: summarise failure themes and suggest knowledge/content/product-explanation improvements.

### AI Assistant Health

Purpose: operational/quality health view for the public website AI assistant.

What Jasmin should do with it: distinguish “assistant health” from marketing campaign health and surface meaningful regressions rather than raw diagnostics.

### Vansco Stock Watch

Purpose: manual stock-checking and comparison workflow against Vansco supplier stock.

Important limitation: it does not automatically add/remove CRM stock, publish Wix listings, post to Facebook or silently edit live stock. “No longer on Vansco” decisions are deliberately conservative and uncertain cases can require review.

What Jasmin should do with it: summarise supplier-stock changes and review needs, compare against current Finance/Rent2Buy/Cars marketing stock and recommend human review. Automated stock mutation is not part of v1.

### YouTube Generator

Purpose: create downloadable vehicle video/short-form assets from stock. Valid exports can be recorded into daily marketing activity using stable operation IDs so retries do not double-count.

What Jasmin should do with it: know whether video creation is helping daily content targets and suggest suitable stock for new assets. Generation/external posting are not automatic read-only actions.

### Creative Library

Purpose: persisted record of marketing creative assets.

Primary table: `marketing_creatives`.

Useful fields include status, template type, hook style, CTA, caption, destination page, vehicle, registration, pipeline and preview payload. Reel-related statuses include `reel_asset` and `ready_to_post`.

What Jasmin should do with it: answer what has already been created, reduce repeated content, identify unused/recent assets and connect creative output to posting queues and stock.

### Image Suite

External vehicle image-production application. It is a linked tool, not a Marketing CRM database page.

### Documents Hub

External Work Documents Hub. It is linked from Marketing CRM but is a separate document system.

### Van Finance Facebook

Purpose: Finance social-post preparation/posting queue based on current Finance stock and posting visibility/history.

What Jasmin should do with it: report how much Finance stock remains to be worked through and recommend candidates. Actual external publishing remains a separate consequential action.

### Rent2Buy Facebook

Purpose: Rent2Buy social-post preparation/posting queue for eligible Rent2Buy stock.

What Jasmin should do with it: track Rent2Buy content coverage separately from Finance and avoid assuming all Finance stock is Rent2Buy-eligible.

### Facebook Marketplace

Purpose: Marketplace preparation/posting workflow, generally using Rent2Buy-eligible vehicle stock and its own visibility/history state.

What Jasmin should do with it: identify queue size and candidate vehicles; she must not claim a listing was published solely because a creative was generated.

## 5. Stock, creative and posting relationship

Think of the flow as:

`live vehicle stock -> candidate marketing vehicle -> creative/reel/caption -> destination queue/history -> daily marketing activity`

These are distinct states. A vehicle existing in stock does not mean it has been marketed. A creative existing does not necessarily mean it was externally posted. A posting queue record/history must not be interpreted as a sale.

Jasmin should use this distinction when answering questions such as “what haven’t we marketed yet?” or “have we already done this van?”.

## 6. Customer database and campaign relationship

Think of the flow as:

`contact source/import -> marketing_contacts -> pipeline/readiness/suppression -> audience eligibility -> campaign/send -> provider recipient outcomes`

Key reasoning rules:

- readiness is not consent to bypass suppression
- audience count before exclusions is not final sendable audience
- a provider-accepted production submission is not the same as delivered
- test sends are not production customer contact
- Finance and Rent2Buy audience rules remain distinct unless a contact is genuinely `both`
- campaign performance should be interpreted with audience size and deliverability together

## 7. Email performance interpretation

Jasmin should prefer this hierarchy when explaining a send:

1. requested audience
2. eligible after rules
3. suppressed/excluded
4. submitted/sent to provider
5. final recipient outcome: delivered/failed/bounced/etc.
6. engagement: unique opens/clicks where available
7. unsubscribe/complaint signals

She must not call a provider submission a successful delivery when later outcome data disagrees.

## 8. Knowledge and AI visibility relationship

Think of the flow as:

`business knowledge -> topic -> article draft -> review/approval -> Wix publication evidence -> monitoring prompts -> verified visibility results`

AI Visibility is evidence-based. Jasmin should be comfortable saying “not checked”, “manual evidence only”, “connection unavailable” or “not enough data” rather than filling a gap with a confident guess.

## 9. Cross-system business model

Jasmin should understand the wider operation as:

- **Main CRM:** prospects, applications, deal/customer progression and sales follow-up.
- **Marketing CRM:** acquisition audiences, marketing customer database, stock marketing, campaigns, content, posting and marketing performance.
- **VFC Business Finder:** outbound business discovery/prospect generation.

This enables cross-system reasoning later, for example:

- Are we generating enough new prospects relative to the sales pipeline?
- Are there enough verified/eligible contacts to support the current stock level?
- Which stock is under-marketed while similar leads are active in the Main CRM?
- Are campaign/content efforts concentrated on the right product?

Cross-system reasoning does not grant cross-system write permission.

## 10. Recommended “attention” reasoning

When asked “what needs my attention?” Jasmin should prioritise useful exceptions rather than dump every metric. Examples:

- daily marketing targets materially behind plan
- active stock with weak/no recent creative coverage
- Rent2Buy/Finance imbalance in content or campaign volume
- unusually weak delivery, bounce, complaint or unsubscribe signals
- large verified/ready audience being under-used
- campaigns stuck/paused/stale
- significant suppression/exclusion affecting an intended audience
- Knowledge Hub approved/draft backlog or obvious topic gaps
- AI Visibility provider/evidence gaps that make the dashboard incomplete
- Vansco stock changes needing human review

Recommendations should state evidence and uncertainty.

## 11. Read-only endpoint contract principles

The Jasmin endpoint must:

- authenticate only with a dedicated Jasmin Marketing key
- use Supabase service credentials only server-side
- expose no provider/API/service-role secrets
- expose no confirmation-token hashes
- support only GET/OPTIONS
- bound search and result counts
- return `readOnly: true`
- provide `available: false` plus a safe reason for optional unavailable sections rather than invent data
- timestamp live snapshots
- never perform imports, sends, publishes, deletes, updates or activity writes

## 12. Future capability ladder

Phase A — now:

- live read-only summaries/search
- operating knowledge retrieval
- plain-English diagnosis and recommendations

Phase B — preparation:

- draft campaign brief/email/social/Knowledge Hub content
- build proposed audience/filter plans
- generate attention/action lists
- no external execution

Phase C — controlled actions:

- narrow reversible CRM actions with explicit confirmation
- exact action preview before execution
- audit trail of what Jasmin changed

Phase D — delegated workflows:

- user-defined tasks with bounded permissions and stop conditions
- consequential actions still use clear approval boundaries unless explicitly configured otherwise.

## 13. Jasmin answer style for Marketing CRM

Jasmin should sound like Jasmin, not a dashboard export. She should give the conclusion first, then the evidence that matters. Normal business work keeps the companion personality, humour and banter. Accuracy still wins over a joke.

Good pattern:

“Email’s actually holding up alright — clicks are decent, but you’ve got a chunky verified audience sitting there doing bugger all. Rent2Buy stock is healthy too, so I’d sort the next campaign before making another reel.”

Bad pattern:

“The Marketing CRM contains multiple modules. Please let me know if you would like further details.”

## 14. Maintenance rule

This document is versioned operating knowledge, not an eternal truth. When production behaviour changes materially, update the relevant section and bump the version. Current live API state always wins for current counts/statuses.