# Ask Me lean engine — handover (21 Nov 2026)

Status: **Stages A–E complete on feature branches (E = on-demand knowledge retrieval, 21 Nov 2026 evening). Ready for independent review; not ready to switch on for customers until the owner confirms the fact wording and an end-to-end widget test is done (see Outstanding).** Nothing is merged or deployed to production. The lean engine is **off for customers** (`ASKME_ENGINE` unset = legacy).

Audit: "Ask Me AI Assistant — Technical Audit" (21 Nov 2026). Audit references: marketing-crm `fcfdb59`, vanfinance-co `c382892`, rent2buy-vans `0dc84b5`.

## Repositories and branches

| Repo | Branch | Base | Latest |
| --- | --- | --- | --- |
| marketing-crm | `feature/askme-lean-backend-20261121` | `main` @ `fcfdb59` | `bd727e0` (code; handover commit follows) |
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

## Stage D — golden suite and benchmark (done)

`scripts/askme-golden-suite.mjs`: 20 cases (the 7 agreed questions + rephrasings: bad credit, CCJ, self-employed, postcode coverage, monthly cost, Transit search, follow-up turn, car page, reserved van, unverifiable quote). Checks reply content (required facts/figures, forbidden refusals, approval promises, cross-product words) and expected actions. Dummy vehicle fixtures; test visitors (`askme-test-golden-*`), excluded from telemetry.

Run 21 Nov 2026 ~14:45 UTC from a Vercel sandbox in London (lhr1) against CRM Preview `marketing-r8ehfelp0` (commit `54babb7`), same deployment, same model (`gpt-6.1-sol` per Preview env), legacy engine = legacy WITH Stage A fixes:

| Engine | Passed | Message p50 | Message p95 | Model-path median | Session start p50 | Avg tokens (in/out) |
| --- | --- | --- | --- | --- | --- | --- |
| Lean | **20/20** | **1.31 s** | **3.99 s** | 1.9 s | 0.19 s | 616 / 85 |
| Legacy (+Stage A) | 12/20 | 2.57 s | 4.47 s (max 10.3 s) | 3.25 s | 0.21 s | not reported by legacy |

Lean timings breakdown (from diagnostics): verified pricing/spec answers 0.22–0.28 s end to end (no model); model call 1.3–3.9 s; checks ~1 ms; session persistence 40–75 ms. Legacy failures: no actions (pricing, reserved van), "find a van" without a follow-up question, reserved van answered "I can't confirm", coverage reply without asking for location.

For comparison, the audit (21 Nov, before any change, production) measured 2.8–4.3 s model answers with 6 of 8 test questions failing.

Not measured: customer-visible streaming (not implemented), cold starts in isolation, legacy token use.

Fix after the run: spec answers on car pages said "This van has a automatic gearbox" (shared legacy helper) — now "This car has an automatic gearbox" (`lib/publicVehiclePricing.js`, test added).

## Stage E — on-demand knowledge retrieval (done, marketing-crm)

Goal: restore full Knowledge Hub / Business Brain grounding in the lean engine without losing speed.

What it does (`lib/askme/knowledgeRetrieval.js`, wired in `lib/askme/leanEngine.js` and `api/ai-assistant-customer.js`):

- Reuses the existing approved corpus: `loadKnowledge` (now exported from `api/marketing-ai-assistant-competence.js`) → `getCachedAssistantKnowledge` (5-minute cache) → `preparedKnowledgeFor(product)` (strict Finance / Rent2Buy separation, unchanged). Active rows of `knowledge_business_pages` are cached separately (5 minutes) and offered as "related website pages".
- Ranking: an in-memory BM25 index built once per cached corpus. Every meaningful word counts, weighted by rarity. (The legacy ranker keeps only whitelisted "focus terms", so "do I need insurance before delivery" was searched as just "delivery".) Small synonym map (docs/paperwork → documents, insure → insurance, cancel → termination, etc.).
- Multi-part questions are split ("…, and do I need insurance…") and each part gets up to 3 passages (max 6). Single questions get up to 4 passages of ≤650 characters each, at most 2 per source, and must pass a relevance floor (coverage ≥ 0.3 of the question's specificity, score ≥ 0.35 of the best match). Unrelated questions get nothing.
- Follow-ups: a thin follow-up ("does that include the gearbox?") also searches with the previous customer turn. A self-contained question searches alone. "What do I need to bring to apply?" is treated as a documents question.
- No extra model call and no extra database round trip on a warm instance: retrieval runs before the single model call, and p95 retrieval time was 30 ms live. Retrieval failures never block an answer.
- Prompt authority order: (1) verified facts, (2) live vehicle and verified calculator quote, (3) approved knowledge passages [K], (4) related website pages. A lower source never overrides a higher one; on conflict the reply follows the higher source and says the team can confirm. If nothing covers the question: "the team will confirm", never a guess. The £-figure, approval-promise and cross-product checks still run over all evidence, retrieved passages included.
- The direct (no-model) price/spec answer is now only for plain price/spec questions. A question on a vehicle page that also mentions warranty, insurance, delivery, collection, documents, the agreement, cancelling or returns goes to the model with the same verified figures plus knowledge. Live bug found and fixed: "Does the warranty cover the gearbox?" had been answered "This van has a manual gearbox."
- Diagnostics (test traffic only): path `model_with_knowledge`, passage titles, headings and scores, pages, corpus size, cache hits, `retrieval_ms`.
- Tests: `tests/askme-knowledge-retrieval.test.js` (11) and `tests/askme-lean-engine.test.js` (12). Full CRM suite: only the 111 pre-existing failures.

Golden suite: `scripts/askme-golden-suite.mjs` now has 36 cases (20 original + 16 knowledge: warranty coverage and exclusions, insurance, finance and Rent2Buy documents, new business, VAT, deposit, Rent2Buy early termination, delivery, collection, multi-part, follow-up turn, multi-turn, two unanswerable questions). `ASKME_SUITE=golden|knowledge|all`. Lean cases also assert a minimum number of retrieved passages. The summary splits latency by path.

Live run 1 (21 Nov 2026, Vercel sandbox lhr1 → CRM Preview `marketing-muyes7zun`, commit `5058ee3`, model `gpt-6.1-sol`, same deployment for both engines):

| Engine | Passed | Message p50 | Message p95 | Direct price/spec answers | Model answers (with knowledge) | Retrieval p95 | Avg tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lean + retrieval | 35/36 | 1.42 s | 3.15 s | p50 0.28 s (n=9) | p50 1.62 s, p95 3.15 s (n=26) | 30 ms | 1,082 / 80 |
| Legacy (+Stage A) | 27/36 | 2.82 s | 4.85 s | — | — | — | not reported |

- Lean's only failure (K1, the warranty/gearbox shortcut) is fixed in `508e306`. Legacy failed the same K1, plus missing actions on pricing and reserved vans, "find a van" with no follow-up question, and a coverage reply that didn't ask for a location.
- Cost: input grew from ~616 to ~1,080 tokens per model answer (the passages), and output is unchanged (~80). Direct price/spec answers still use no model.
- Speed versus the Stage D baseline (p50 1.31 s / p95 3.99 s): p50 is about the same, p95 is better, and the knowledge path is well under the 5-second target.
- Answer quality, read by hand: warranty exclusions, insurance before collection, Rent2Buy documents (3 bank statements, 2 proofs of address, licence), new business (3 months trading), VAT, deposit (from £99, lender confirms), Rent2Buy early termination, delivery (7–10 working days), collection (Southampton only) and the off-topic questions (boats → "vans only"; Bitcoin → team confirms) were all grounded and correct for the right product.
- Weak in run 1, fixed in `bd727e0`, re-run below: the multi-part question answered insurance well but gave a generic documents line; the multi-turn "what would I need to bring to apply?" pulled passages from the earlier price turn.

Live run 2 (knowledge set, lean, CRM Preview `marketing-l8wymlz9y`, commit `bd727e0`, fresh sandbox): **16/16 passed**. Message p50 2.27 s, p95 3.88 s. Average tokens 1,126 in / 76 out, with 4–6 passages per answer.
- The warranty/gearbox question is now answered from the warranty knowledge.
- The multi-part question gives both the documents list and the insurance answer.
- "What would I need to bring to apply?" after a price question now lists ID, address and income documents.
- Run 2 started on a cold instance, so it includes the first knowledge load from Supabase (~1.3–1.4 s, once per instance per 5-minute cache). On a warm instance retrieval is under 30 ms, which is why run 1's model-path p50 was 1.62 s.

Testing note: the CRM allows 15 requests a minute and **200 requests a day per IP**. A full two-engine run (~155 requests) uses most of a day's allowance from one IP. A second run from the same sandbox gets 429s, so use a fresh sandbox, or `ASKME_SUITE=knowledge` / `ASKME_ENGINES=lean`.

## Outstanding (priority order)

0. **Knowledge retrieval follow-ups (Stage E):**
   - (a) Thin follow-ups are sometimes over-cautious. After "Do your vans come with a warranty?", "Does that include the gearbox?" got "the team can check", while the standalone question is answered from the warranty knowledge. Consider letting the model see the passages retrieved for the previous turn as well.
   - (b) Keep the knowledge cache warm (a scheduled ping or a longer TTL) so the first question on a cold instance doesn't pay ~1.4 s for the Supabase load.
   - (c) Business pages are only offered as links (the table holds no page text). Page bodies would need indexing if they should be quoted.
   - (d) Semantic (embedding) retrieval was not added. The BM25 ranker passed every live knowledge case, so embeddings are only worth trying if real conversations show misses. Compare on the same suite before switching.
1. **Owner review of fact wording** — `ASKME_FACT_REVIEW_FLAGS` in `lib/askme/businessFacts.js` (holding deposit vs reservation payment; CCJ wording; "new-start businesses" from website copy; legacy deposit-amount guardrail now satisfied by approved facts).
2. **End-to-end widget test on Previews.** Website Previews call the PRODUCTION CRM by default (`JASMINE_PUBLIC_ENDPOINT`). Either point Preview-branch-scoped `JASMINE_PUBLIC_ENDPOINT` at the CRM Preview (protected; needs a bypass approach) or merge the CRM branch first with `ASKME_ENGINE` unset (no customer change) and then test the website Previews against production with `askme-test-` visitors + `ASKME_ENGINE=lean_test`. Owner approval needed either way.
3. **Verified quote end-to-end.** Production CRM already has `RENT2BUY_QUOTE_VERIFIER_ENABLED` and `RENT2BUY_QUOTE_SIGNING_SECRET` (names checked, values not read); this feature branch's Preview does not, so on Preview every token resolves as "unverified" (that path was tested live). Verified-quote answers are unit-tested only until tested against production config.
4. Streaming responses (proxy + widget) for ~1 s time-to-first-words on model answers.
5. Stock search tool for "find me a van" so recommendations come from verified current stock (today: asks use/size/budget and offers Browse).
6. Regional hosting: functions run in the default US region; moving CRM + website functions next to Supabase/UK users is a separate approved change (verify Supabase region first).
7. WhatsApp adapter (later): map phone number → session, product choice prompt, `capabilities.buttons=false` (actions rendered as text links), authenticate the WhatsApp webhook; reuse `answerCustomerMessage()` unchanged.
8. Starter questions (separate final stage, after 1–3).

## Exact next steps for Codex

1. `git fetch` all three branches; re-run unit tests: marketing-crm `node --test` (expect only the 111 pre-existing failures), vanfinance-co `node --test tests/*.test.mjs` (1 pre-existing), rent2buy-vans `node --test tests/*.test.mjs` (3 pre-existing).
2. Re-run the golden suite against the latest CRM Preview: `ASKME_BASE_URL=<preview> ASKME_SHARE_URL=<vercel share link> [ASKME_SUITE=all|golden|knowledge] [ASKME_ENGINES=lean,legacy] node scripts/askme-golden-suite.mjs` (needs outbound access to *.vercel.app; ~11 min for all 36 cases on both engines because of the 15 req/min limit; mind the 200/day per-IP limit). Expect lean 36/36.
3. After owner approval only: merge marketing-crm first (lean stays off), then the two website branches, then enable `ASKME_ENGINE=lean` and watch telemetry; rollback = unset `ASKME_ENGINE`.
