# Ask Me lean engine — handover (21 Nov 2026)

Status: **Stage A complete in the Marketing CRM. Stages B–D in progress.** Nothing is merged or deployed to production.

Audit: "Ask Me AI Assistant — Technical Audit" (21 Nov 2026). Audit references: marketing-crm `fcfdb59`, vanfinance-co `c382892`, rent2buy-vans `0dc84b5`.

## Repositories and branches

| Repo | Branch | Base | Latest |
| --- | --- | --- | --- |
| marketing-crm | `feature/askme-lean-backend-20261121` | `main` @ `fcfdb59` | see `git log` |
| vanfinance-co | `feature/vfc-askme-lean-integration-20261121` | `vfc/staging` @ `c382892` | not started |
| rent2buy-vans | `feature/r2b-askme-lean-integration-20261121` | `main` @ `0dc84b5` | not started |

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

## Must not change

Pricing matrix or quote calculations; quote verification rules; application eligibility criteria or routes; Supabase schema/security; session, rate-limit and telemetry tables; launcher buttons, labels, mobile scroll-to-reveal and the three-button mobile bars.

## Next steps (in order)

1. Stage B: lean engine behind a disabled-by-default flag.
2. Stage C: VFC car pages + canonical vehicle shape; Rent2Buy widget passes the verified quote token; remove proxy regex answer overrides; render actions in both widgets.
3. Stage D: golden-question suite and old-vs-new timings on a Preview.
