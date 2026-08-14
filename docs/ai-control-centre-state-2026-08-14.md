# AI Control Centre aggregate snapshot

Captured: 2026-08-14T19:02:27Z
Query window: 28 days

This file records aggregate operational metrics only. No raw customer messages, search queries, access keys or personal identifiers are included.

## Ask Me adoption

- Launcher impressions: 694
- Unique exposed visitors: 213
- Launcher opens: 4
- Unique open visitors: 3
- Open rate: 1.4%
- Conversations started: 3
- Customer messages: 1
- Conversations with 2+ messages: 0
- Assistant responses: 1
- CTA shown: 0
- CTA clicks: 0

Page breakdown:
- Homepage: 230 impressions, 3 opens, 2 conversations, 0 messages
- Rent2Buy general: 219 impressions, 1 open, 1 conversation, 1 message
- Finance general: 140 impressions, 0 opens
- Finance vehicle: 105 impressions, 0 opens

Note: these are counts inside the 28-day query window. Instrumentation may not have been active for the full 28 days, so do not interpret them as a complete 28-day exposure history.

## Assistant knowledge telemetry

- Assistant responses with retrieval: 1
- Retrieval rate: 100%
- Knowledge gaps: 1
- Knowledge gap rate: 100%

The sample is only one customer response, so the knowledge-gap percentage is not representative of overall assistant quality.

## Public Knowledge Hub search

- Searches: 35
- No-result searches: 7
- Article selections: 4
- Selection rate: 11.4%

## AI visibility

- Published pages: 245
- Checked pages: 235
- Unchecked pages: 10
- Google indexed: 163
- Google pending: 63
- AI-visible pages: 0
- ChatGPT detections: 0
- Gemini detections: 0
- Perplexity detections: 0
- Google AI Overview detections: 0
- Pages needing attention: 8
- Last visibility check: 2026-08-14T15:18:15Z

## Knowledge Opportunities

- Active Rent2Buy opportunities: 1
- Active Finance opportunities: 0
- Unanswered: 1
- Weak: 1
- Draft created: 3
- Evidence-backed opportunities: 0
- Live assistant questions ingested: 0
- Live assistant gaps ingested: 0
- Live assistant retrieval misses ingested: 0
- Hub searches ingested: 0
- Hub no-results ingested: 0
- GSC impressions ingested: 0
- GSC clicks ingested: 0
- Evidence last refreshed: null

This demonstrates that the evidence-refresh loop is not currently feeding the existing assistant/search/GSC evidence into Knowledge Opportunities.

## Assistant Health baselines

Deterministic baseline exists:
- Baseline 1 · Deterministic
- 10,000 conversations
- 27,469 turns
- Health 97.5
- Server baseline ID: 7a744513-5f23-4962-8d5b-ab7f2ec9a637

Live baseline: not saved server-side.

The paid 100-conversation live sample is separately preserved in `docs/live-health-100-2026-08-14.md`. It was run before the retrieval-context fixes later merged in PR #262 and should be labelled pre-retrieval-fix if saved as a server baseline.

## Rows read by the aggregate probe

- Assistant events: 706
- Knowledge Hub search events: 39
- Knowledge articles: 315
- Visibility results: 1,766
- Visibility prompts: 8
- Knowledge opportunities: 148
- Health baselines: 1
- Query was not capped
