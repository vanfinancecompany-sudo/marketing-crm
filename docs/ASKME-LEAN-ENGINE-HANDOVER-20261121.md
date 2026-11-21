# Ask Me lean engine — handover (21 Nov 2026)

Status: **Stages A–C implemented and unit-tested; Stage D (live golden suite + benchmark) in progress.** Nothing is merged or deployed to production. The lean engine is **off for customers** (`ASKME_ENGINE` unset = legacy).

Audit: "Ask Me AI Assistant — Technical Audit" (21 Nov 2026). Audit references: marketing-crm `fcfdb59`, vanfinance-co `c382892`, rent2buy-vans `0dc84b5`.

## Repositories and branches

| Repo | Branch | Base | Latest |
| --- | --- | --- | --- |
| marketing-crm | `feature/askme-lean-backend-20261121` | `main` @ `fcfdb59` | see `git log` |
| vanfinance-co | `feature/vfc-askme-lean-integration-20261121` | `vfc/staging` @ `c382892` | `3568e08` |
| rent2buy-vans | `feature/r2b-askme-lean-integration-20261121` | `main` @ `0dc84b5` | `abb2e04` |

Overlapping older drafts (not merged, superseded by this work; do not merge alongside it): marketing-crm #694, #695, #696; vanfinance-co #177; rent2buy-vans #61.

## Stage A — accuracy foundation (done, marketing-crm)

- `lib/askme/businessFacts.js` — versioned (`2026-11-21.1`) owner-approved facts for Finance and Rent2Buy, plus `ASKME_FACT_REVIEW_FLAGS` listing wording that needs owner confirmation.
- `lib/askme/vehicleContext.js` — the live page vehicle as citable evidence; listing figures labelled as illustrations; reserved/unavailable status stated.
- `lib/askme/selectedQuote.js` — the customer's on-page Rent2Buy quote, trusted only after the existing CRM verifier (`api/_rent2buy-quote-verify-handler.mjs`: HMAC, expiry, registration, recalculation against the current source). Never reconstructs figures.
- `lib/publicVehiclePricing.js` — product-aware pricing normalisation: VFC's `monthly`/`retail` keys now reach the CRM as finance pricing (root cause of "please check the website" refusals); `£X N/A` prices accepted with VAT status kept; Rent2Buy replies treat "upfront" as initial rental, give initial + monthly together, label listing figures as an advertised illustration, quote a verified selection exactly, and say so when a selection can't be verified.
- `lib/publicAssistantFoundation.js` — `normalisePageContext` passes product to pricing, adds `vehicle_kind`, and accepts an opaque `selected_quote_token` on Rent2Buy pages only.
- `api/ai-assistant-customer.js` — resolves the selected quote per message and passes it to the pricing reply and the engine.
- `api/marketing-ai-assistant-competence.js` (legacy engine) — verified facts, vehicle and quote are always added as citable sources, so answers built from them are no longer discarded by `enforceGroundedConversationReply`; eligibility questions ("can I apply with poor credit / if self-employed") are no longer misrouted to the canned application-mode reply (the universal classifier labelled them `ready_to_apply`).
- Tests: `tests/askme-stage-a-accuracy.test.js` (12 tests). One existing assertion in `tests/public-vehicle-pricing.test.js` updated for the new "advertised illustration" wording.

Full suite: 2,495 tests, 111 failing — identical to the 111 failing on unchanged `main` before this work (pre-existing, unrelated: Wix/SEO/editorial areas). No new failures.

## Stage B — lean engine (done, marketing-crm `54babb7`)

- `lib/askme/contract.js` — channel-independent `AskMeRequest` / `AskMeResponse`. Websites are the first adapter (`api/ai-assistant-customer.js`); WhatsApp later needs only its own adapter (transport, auth, phone-number → conversation mapping, product choice), calling `answerCustomerMessage()` with `channel: "whatsapp"`, `page_type: null`, `capabilities.buttons` as supported. No WhatsApp code exists yet.
- `lib/askme/leanEngine.js` — `answerCustomerMessage()`: verified vehicle pricing answered directly (no model); otherwise ONE model call (`OPENAI_WIX_MAIN_MODEL`, default `gpt-6-sol`, reasoning low, small 2-field JSON schema, `store:false`) with verified facts + live vehicle + verified quote + last 8 turns; then narrow checks (approval promises, cross-product words, any £ figure not present in the evidence) → safe reply + contact action on failure; actions built server-side from verified data only (reserved vehicles never get apply; verified Rent2Buy quote carries `r2b_quote`).
- Removed from the lean path: regex classifier chain, keyword retrieval, citation-or-discard, reword-a-canned-reply call, competence-result DB write, learning analysis. Kept: origin check, rate limits, session load/update, prompt-leak guard, homepage product choice, guarantor rule, sensitive-data redaction, telemetry (non-test).
- Tests: `tests/askme-lean-engine.test.js` (11).

### Feature flag and rollback

- `ASKME_ENGINE` unset / `legacy` → legacy engine for everyone (current behaviour).
- `ASKME_ENGINE=lean` → lean engine for all traffic. Rollback = unset it (no deploy needed beyond env change + redeploy as Vercel requires).
- Test traffic: `analytics_visitor_id` starting `askme-test-` on **Preview** deployments uses lean (or legacy with `askme_engine:"legacy"` in the body) and gets `diagnostics` timings; its telemetry is never written and its session is marked `journey_state.test_traffic=true`. On production, test visitors stay legacy unless `ASKME_ENGINE=lean_test`.

## Stage C — website integrations (done)

- vanfinance-co `3568e08`: `lib/jasmineVehicleContext.mjs` + `/api/jasmine-vehicle` send the canonical CRM vehicle shape (finance keys, VAT status, listed specs, availability from the page's own reservation check, no apply link when reserved/sold) and now serve car pages (`?type=car`); widget sends car context, passes the verified quote token on VFC Rent2Buy pages, renders `actions` as in-panel buttons; proxy keyword overrides removed; calculator publishes its verified token. Test: `tests/askme-vehicle-context.test.mjs` (added to build). Suite: 186/187 (1 pre-existing failure `vehicle-feature-cms`).
- rent2buy-vans `abb2e04`: calculator publishes only its verified quote token (`askme-quote-selection` event); widget sends it and renders actions; proxy keyword overrides removed. Suite: 120/123 (3 pre-existing failures, identical to `main`).
- Launchers, labels, positions, mobile scroll-to-reveal and the three-button mobile bars are unchanged. Starter questions NOT implemented.

## Must not change

Pricing matrix or quote calculations; quote verification rules; application eligibility criteria or routes; Supabase schema/security; session, rate-limit and telemetry tables; launcher buttons, labels, mobile scroll-to-reveal and the three-button mobile bars.

## Next steps (in order)

1. Stage D: run `scripts/askme-golden-suite.mjs` against the CRM Preview (both engines) — results below once recorded.
2. Website Previews currently call the PRODUCTION CRM (`JASMINE_PUBLIC_ENDPOINT` default). To test end-to-end in the widgets, point a Preview-branch-scoped `JASMINE_PUBLIC_ENDPOINT` at the CRM Preview (needs a protection bypass) — not done; owner approval needed for env changes.
