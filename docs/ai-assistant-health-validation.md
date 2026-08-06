# AI Assistant Health validation

Open `/ai-assistant-health` and unlock it with the existing Marketing CRM access key.

## Deterministic regression

The deterministic runner executes 1–10,000 synthetic conversations in batches of 100. It reuses the approved Business Brain and Knowledge Hub reads plus the existing product filter, conversation memory, V4 journey state, V5 recovery, V6 orchestrator, lexical ranking and application CTA logic.

It deliberately makes:

- zero OpenAI calls;
- zero geocoding calls;
- zero Supabase writes;
- zero customer records.

For factual turns, the runner selects the highest-ranked approved passage with a deterministic evidence renderer. This validates routing and grounding invariants; it is not a substitute for judging model wording.

Save a completed result as the browser's PR baseline, then compare a later run against it. Exported JSON includes the deployment commit, run timestamp, aggregate metrics and up to 100 failed-scenario diagnostics.

## Live AI Validation

Live validation is server-blocked unless `VERCEL_ENV=preview`. It samples 50–100 scenarios distributed across the existing scenario library and uses the server-configured `OPENAI_MODEL`. The run uses the same protected endpoint and knowledge pipeline with persistence disabled.

Cost estimates are returned only when both reviewed server-side rates are configured for the selected model:

- `OPENAI_INPUT_COST_PER_MILLION_USD`
- `OPENAI_OUTPUT_COST_PER_MILLION_USD`

If either rate is absent, token usage and latency are still recorded but cost is shown as unavailable. Update these Preview variables when the configured model or official pricing changes. Do not place them in browser variables.

For local automated testing only, live-mode access can be enabled with `AI_HEALTH_ALLOW_LOCAL_LIVE=true` while `NODE_ENV` is not `production`. The dashboard never sends a model identifier or API key from the browser.

## Interpreting scores

The overall health score weights product separation and knowledge retrieval most heavily, followed by context retention and application progression. A safe knowledge-gap response counts as correct retrieval behaviour only for scenarios explicitly categorised as unsupported or unknown. Failed scenarios identify the exact turn and invariant that failed.

The deterministic result measures behavioural integrity. The smaller live result adds model latency, token usage, estimated cost and response-quality scoring. Review both before deployment rather than treating either score alone as approval.
