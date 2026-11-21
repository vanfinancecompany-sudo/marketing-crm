# Ask Me lean engine — handover (21 Nov 2026)

Status: **All three policy wordings are owner-approved. Connected hosted Preview rehearsal is in progress.** For the current release gates and measured results, see Independent review at the end of this handover.

Audit: "Ask Me AI Assistant — Technical Audit" (21 Nov 2026). Audit references: marketing-crm `fcfdb59`, vanfinance-co `c382892`, rent2buy-vans `0dc84b5`.

## Repositories and branches

| Repo | Branch | Base | Latest |
| --- | --- | --- | --- |
| marketing-crm | `feature/askme-lean-backend-20261121` | `main` @ `fcfdb59` | `5dc2110` (reviewed code) |
| vanfinance-co | `feature/vfc-askme-lean-integration-20261121` | `vfc/staging` @ `c382892` | `09a7cec` |
| rent2buy-vans | `feature/r2b-askme-lean-integration-20261121` | `main` @ `0dc84b5` | `ce51ad6` |

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

## Original handover next steps (superseded by Independent review)

1. `git fetch` all three branches; re-run unit tests: marketing-crm `node --test` (expect only the 111 pre-existing failures), vanfinance-co `node --test tests/*.test.mjs` (1 pre-existing), rent2buy-vans `node --test tests/*.test.mjs` (3 pre-existing).
2. Re-run the golden suite against the latest CRM Preview: `ASKME_BASE_URL=<preview> ASKME_SHARE_URL=<vercel share link> [ASKME_SUITE=all|golden|knowledge] [ASKME_ENGINES=lean,legacy] node scripts/askme-golden-suite.mjs` (needs outbound access to *.vercel.app; ~11 min for all 36 cases on both engines because of the 15 req/min limit; mind the 200/day per-IP limit). Expect lean 36/36.
3. After owner approval only: merge marketing-crm first (lean stays off), then the two website branches, then enable `ASKME_ENGINE=lean` and watch telemetry; rollback = unset `ASKME_ENGINE`.

## Independent review — 21 Nov 2026

**Release decision: hold for owner wording approval and a connected hosted Preview rehearsal.** The warranty defect was reproduced and corrected. The exact feature commits below were pushed. Their branch CI created Previews. Production branches, domains, environment and application routing were left untouched.

| Repository | Feature branch | Reviewed code commit | Release base confirmed |
| --- | --- | --- | --- |
| Marketing CRM | `feature/askme-lean-backend-20261121` | `5dc21107ce23973d66cc92aa90aa98c5e82f85e9` | `main` at `fcfdb598d9893123fb806406d6ee6ba4c3ae148a` |
| Van Finance Company | `feature/vfc-askme-lean-integration-20261121` | `09a7cec0b78865337d969456549a62035fc57a4b` | `vfc/staging` at `c382892b9e1dc2863213e4afc1ce62798cf3eae7` |
| Rent2Buy Vans | `feature/r2b-askme-lean-integration-20261121` | `ce51ad6c4265f3ff09cb9595142d88bfdb321f53` | `main` at `0dc84b5b86f0b94a79728bf019b3b3401259200d` |

The branch CI Previews were Marketing CRM `dpl_EQJNm19dpYGD2DX4dWBPpQsWWqGK`, Van Finance Company project `van-finance-company-vfc` deployment `dpl_FSawGBcSmKgXkwFGmwYgasEfkN9L`, and standalone Rent2Buy Vans project `rent2buy-vans` deployment `dpl_ExCNZvx5MDTHQ1hcHk5zPTAzCJ55`. The hosted CRM benchmark and local browser fixture checks use different endpoints.

### Live CRM accuracy and response times

Same-deployment comparison on protected CRM Preview `dpl_HXWBJ7CicYTXn1UQut5Ths1BLi8H` at `40a3762`, 36 cases per engine. Latency is the wall-clock time for the final message of each case from the test client to the CRM response. It includes network time to the CRM and excludes the website proxy and widget rendering.

| Engine | Original assertions | Obvious failures after reading the replies | Reply p50 | Reply p95 | Conversation start p50 |
| --- | ---: | --- | ---: | ---: | ---: |
| Lean | 36 passed, 0 failed | K13 warranty follow-up and Q3c van-search follow-up both deferred instead of helping | 1.66 s | 2.75 s | 0.22 s |
| Legacy with Stage A | 28 passed, 8 failed | The original checks also missed the K13 warranty deferral | 3.04 s | 6.04 s | 0.23 s |

The lean median was 45% lower and the p95 was 54% lower. Verified price/specification replies used no model and had a 0.32 s median. The original K13 assertion accepted any nonempty reply. It now requires a positive, qualified gearbox coverage answer. The legacy K1 answer on a vehicle page was an unrelated gearbox specification.

Eight natural-language and multi-turn cases on `9161edf` scored 6/8. It handled Finance documents and insurance, Rent2Buy area, proofs, application and guarantor rules, and a question about an unsupported payment method. Both warranty follow-ups still failed because general warranty FAQs crowded out the passage that describes coverage. The first fix had restored the topic but still missed the component-level evidence.

The latest protected Preview at `5dc2110` passed **6/6 targeted live cases** using GPT-6 Sol. I1 and I8 covered the warranty follow-up on vehicle and general pages. Q3c, K1, K12 and K13 checked stock-search continuity, direct warranty coverage, documents plus insurance, and the original follow-up. The top source for the gearbox follow-up on both page types was *What Warranty Coverage is Included with Your Van Purchase?* under *What Does the In-House Warranty Cover?*. The reply now explains general gearbox cover during normal use and qualifies exact vehicle terms. The stock-search follow-up asks a practical question about carrying needs and acknowledges the budget without turning it into a quoted payment. The full 36-by-two comparison was done at `40a3762`; it should be rerun at the approved release head from a fresh permitted test egress before activation. The existing 15/minute and 200/day limits continue to apply.

Final targeted replies took 1.60–2.77 s over the network. On a cold knowledge-cache observation the first reply took 3.68 s, including 1.37 s of retrieval and cache population. The final targeted warm retrieval observations were 7–22 ms. A wider warm sample at `9161edf` was 2–48 ms. Leave the five-minute in-process cache in place. It coalesces overlapping loads, prepares separate product corpora, and expires on a bounded schedule. The observations do not justify scheduled pings or new infrastructure.

The approved-knowledge checks covered Finance and Rent2Buy document differences, warranty exclusions, insurance, Finance delivery, Southampton-only Rent2Buy collection, and early termination under the customer's agreement. Unknown payment terms safely referred to the team. A generic multipart Finance documents reply could still give a fuller address and income checklist before conditional self-employment details. The live test of explicit ID, address and income wording answered that correctly. Business-page search supplies related-page metadata, and the approved passages provide the substantive evidence.

### Widget, quote and telemetry verification

Ran each actual Next.js widget in a local isolated Preview-mode configuration with synthetic stock, an in-memory CRM session/telemetry store and a test-only quote signer. The suite used the real CRM route handler, pricing matrix and quote verifier. Live model and approved-corpus behaviour were verified independently on the protected CRM Preview.

- Van Finance Company showed the fixture listing illustration of £280/month and opened the existing application with `ZZ25XYZ` selected. The car reply identified the automatic gearbox and emitted the existing apply link for `ZZ25CAR`. The finance widget answers from the advertised listing. It does not read a customer's separate on-page Hire Purchase calculator selection.
- Standalone Rent2Buy used the selected 48-month, 1,000-mile-per-month quote. The calculator, chat and application displayed £5,256 upfront and £384 monthly including VAT. The chat action carried the same signed token and registration as the calculator. The application reverified the quote and reached the postcode step. A reserved vehicle offered Browse and no application action. VFC and Rent2Buy context regressions also cover blocked stock.
- At a 390px responsive viewport both existing mobile launchers opened and closed after the scroll reveal. The desktop actions opened the expected application routes. No application or postcode was submitted.
- Reconciled launcher impressions, opens and closes from telemetry drafts `e343cee` and `7d86f77` by incorporating their final instrumentation into the two lean feature branches. Kept viewport and obstruction checks. Lean action clicks now use the existing CRM event and carry an action key and session association. Requests omit the quote token, action URL and free text. Both same-origin forwarders returned HTTP 200 for the launcher events in the local fixture. A real browser application click produced `cta_click` in the isolated CRM event store. Completion attribution is outside this check.
- Signed quote URLs are preserved through both CRM response envelopes. The existing verifier rejects invalid signatures, expiry, registration mismatch and a changed pricing-source revision. Conversation IDs are opaque, hashed for storage, expire after 24 hours of inactivity and are checked with product/page context. The public test prefix is ignored for diagnostic access and suppression of telemetry in normal Production modes. Test-only diagnostics remain available under the existing explicit Preview/test configuration. An ungrounded or failed model reply returns safe copy and an approved contact action. The model and website proxy do not have a dedicated short upstream deadline, so verify the widget experience during a slow or unavailable upstream in the hosted rehearsal.

Full local test results on Node 24 for exact original tips and reviewed code:

| Repository | Original tip | Reviewed code |
| --- | --- | --- |
| CRM | 2,402 passed, 116 failed of 2,518 | 2,406 passed, 116 failed of 2,522 |
| VFC | 184 passed, 4 failed of 188 | 186 passed, 4 failed of 190 |
| Rent2Buy Vans | 118 passed, 5 failed of 123 | 121 passed, 5 failed of 126 |

The targeted CRM Ask Me and quote-verifier run passed 43/43. Absolute full-suite failures differ from Opus's run. The failure identities were unchanged on all three repositories when compared to the same-environment original tips.

### Customer-visible behaviour with the lean flag off

- CRM Stage A changes the legacy replies too. Normalised Finance retail and monthly figures and specs reach the legacy formatter. Corrected Rent2Buy initial and monthly figures are labelled as illustrative unless a selected quote is verified. Verified selections are rechecked before the legacy reply and failed verification asks the customer to return to the calculator. Eligibility intent takes the knowledge path, and versioned business facts, verified vehicle context and quote evidence are citable by the legacy engine. VFC's approved policy and Rent2Buy amount wording therefore need sign-off before a flag-off release.
- Both sites stop replacing CRM replies with hard-coded keyword copy. The VFC widget loads canonical finance vehicle and car context and works on the integrated Rent2Buy vehicle paths. The VFC proxy resolves start context from its stock source. Both sites pass the Rent2Buy selection token and suppress offers for known unavailable vehicle contexts through the existing availability checks. These changes affect legacy replies when the website branches are released.
- The restored launcher analytics run either way. The mobile reveal, surrounding buttons and desktop launcher stay as implemented in the existing design. The widgets can render structured actions when supplied. The lean model and new knowledge-ranking path require the engine flag or an authorised Preview test session.
- The exact case on legacy can still give an unrelated vehicle specification for a warranty question. The fallback for ungrounded model statements, and VFC listing prices versus its separate finance calculator, should both be included in the flag-off regression rehearsal. A standalone Recently viewed card outside Ask Me displayed a reserved fixture with an Apply label. The chat itself withheld Apply. Browser rehearsal should check the existing reserved-stock journeys separately.

### Owner approvals and release sequence

Confirm these three wording decisions before deploying any flag-off customer-visible changes:

1. Preferred label for the £200 Rent2Buy payment. The brief says **holding deposit**, and the published copy says **vehicle reservation payment**. Keep it clearly separate from the £1,000 + VAT minimum initial rental.
2. Whether Finance should explicitly say that applicants with CCJs or previous refusals can apply. Retain the condition that a lender assesses affordability and status and approval is never guaranteed.
3. Whether to retain the published **new-start businesses considered** wording in the verified Finance facts. Confirm the intended scope without introducing a minimum-trading or approval promise.

The existing legacy evidence guard can accept the approved Rent2Buy figures as business knowledge. That behaviour is distinct from the three wording decisions.

After explicit owner approval:

1. Verify the exact feature heads and unchanged release bases. Complete the branch-scoped hosted rehearsal first. Point both protected website Previews to the protected CRM Preview using the existing authenticated server-to-server path. Give the quote issuer, verifier and application form demonstrably matching Preview-only fixture settings. Repeat the full 36-case tests on the approved CRM head. Verify desktop and mobile actions, a changed signed quote, unavailable stock, and CRM telemetry. Existing hosted previews are not evidence of this connected quote path. Keep production routes, keys and data out of the rehearsal.
2. Merge the CRM candidate into `marketing-crm/main` first with `ASKME_ENGINE` unset or `legacy`. Confirm the owner has approved the legacy-visible changes and the normal CRM release. Check that ordinary customer traffic gets legacy responses without diagnostics.
3. Release the standalone website through `rent2buy-vans/main` after its approved Preview review. Smoke-test its application and quote handoffs and analytics before moving on.
4. Integrate the VFC candidate into `vanfinance-co/vfc/staging` only. Verify the exact staging commit on a `van-finance-company-vfc` Preview, obtain explicit release approval, and build a fresh Production-target deployment from that exact commit with Production environment variables and domain assignment skipped. Record the commit and deployment ID. Check `/api/readiness` for VFC Production identity, `application.submissionMode = live`, application integration ready, address lookup configured, email configured and `productionReady = true`. Verify postcode lookup and both `/application-received` and `/finance-application-received` before and after moving the public domains. Assign customer domains only to the verified Production-target build.
5. Enable the CRM's existing `ASKME_ENGINE=lean` switch only after both websites pass the application and telemetry checks. It enables lean for both sites. Watch reply failures, eligibility and warranty responses, latency, CTA clicks, quote/carry-through errors and successful application rates against the pre-release baseline.

**Rollback.** For a lean-only regression switch CRM to `legacy` and create the approved Production rebuild. Verify that customers receive legacy replies. Flag-off CRM and widget behaviour remains in place. If a shared behaviour causes the incident, revert the responsible change on the correct release lineage and re-run the flag-off and application checks before releasing the corrected build. Preserve restored telemetry if it is unrelated. A whole-site VFC traffic rollback requires separate owner direction and a confirmed known-good Production deployment. A Preview deployment must never receive a public VFC alias.

### Owner approval recorded — 21 Nov 2026

The owner approved all three outstanding policy wordings. Verified facts v2026-11-21.2 lead with **£200 vehicle reservation payment (holding deposit)**, separate from the initial rental. Finance applicants with CCJs or previous refusals can apply, subject to status, affordability and lender criteria. New-start businesses can be considered on the same basis. This approval covers wording and protected Preview rehearsal. Production release still requires a separate decision.


## Assistant continuation — final CRM Preview benchmark (21 Nov 2026)

After Codex's Work usage limit interrupted the hosted rehearsal, the assistant located Codex's **still-running Vercel London sandbox** (session `sbx_fpBRSdzHNDGgtYS4Bra5z6G6X8MK`) and observed the existing comparison through completion. **This was continuation of the already-running test, not a new test with modified fixtures.** Output was `/tmp/askme-final-verified.jsonl` in the ephemeral session. Target was the protected Marketing CRM Preview `marketing-emlchp0nx-stuart-westons-projects.vercel.app`, deployed from exact feature **code commit `ebbcafc32eaa7f52cc8de63b065cbdb01d36a90c`**.

| Same-Preview engine | Passed | Failed | Message p50 | Message p95 | HTTP errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lean with knowledge | **36/36** | 0 | **1,630 ms** | **3,487 ms** | 0 |
| Legacy with Stage A | **28/36** | 8 | **3,007 ms** | **5,015 ms** | 0 |

Legacy failed Q1, Q1b, Q1c, Q3, Q4d, R2, R2b and K1. All 36 lean rows had `pass=true` and no non-200 response. The answers for K1 and K13 were manually inspected and correctly explained general gearbox warranty coverage with vehicle-specific qualification. K12 addressed documents using approved knowledge; R2 correctly distinguished an advertised Rent2Buy illustration from a selected verified quote; K16 did not invent Bitcoin payment acceptance. These are CRM-client measurements; **website proxy, browser widget rendering and actual application submission are excluded**.

Additional read-only checks: the current hosted VFC and standalone Rent2Buy protected Preview vehicle pages for synthetic registration `ZZ25XYZ` both returned HTTP 200 and rendered expected synthetic vehicle content. This confirms page availability, **not** a newly completed interactive quote → chat → application rehearsal after the latest CRM fix. Earlier Codex hosted checks succeeded before its final routing correction; the latest end-to-end payment question still needs a connected browser rerun.

The latest source includes `FIXED_CHARGE_QUESTION` routing to business facts even when a verified calculator quote is present, and the regression tests in `tests/askme-stage-a-accuracy.test.js` cover the £200 reservation payment and holding deposit wording. Codex reported 50 focused tests passing after this fix. **Those targeted tests and source inspection are not the same as a hosted interactive rerun of the payment question.**

**Open release gates:** (1) rerun the hosted Rent2Buy selected quote → chat → application and explicitly ask whether the £200 reservation payment is separate from the initial rental on both protected website Previews connected to this exact CRM build; (2) repeat desktop/mobile launchers, reserved-stock and telemetry checks on these final deployed heads; (3) confirm the temporary rehearsal-only credentials/flags remain Preview-scoped and are not carried into Production; (4) obtain a separate explicit production-release authorization. No production merge, domain move or lean-engine enablement was made by this continuation.


## Conversation continuity QA — 21 November 2026

Owner requirement: **Ask Me must answer a broad range of relevant customer questions AND carry a natural, contextual multi-turn conversation**, not act as a fixed FAQ. Work remains isolated to `feature/askme-lean-backend-20261121`. All production releases and the public lean flag remain unchanged.

### Changes on this CRM feature branch

- `lib/askme/contract.js` now retains up to 24 bounded history entries in the channel-independent request contract. `lib/askme/leanEngine.js` presents the newest 16 previous turns (up to eight exchanges, each capped at 450 characters) to the model. This is a bounded *recent conversation*, **not indefinite long-term memory**.
- Guidance explicitly treats chat as an ongoing conversation: build on earlier answers, honor corrected requirements, resolve pronouns and references, do not invent unverified stock/prices, do not force a question after every answer, and do not repeat unanswered earlier questions when the customer changes topic. One model call remains the maximum for the model answer path.
- Follow-up interpretation now recognizes references such as `Is that separate?`; reservation/holding-deposit questions route through policy knowledge rather than being mistaken for another selected-quote/pricing question.
- Added deterministic regression cases to `tests/askme-lean-engine.test.js` and four synthetic multi-turn conversations in `scripts/askme-golden-suite.mjs`, run with `ASKME_SUITE=conversation ASKME_ENGINES=lean`. The suite now includes each earlier answer as `conversation_replies` for manual review, not just final-turn assertions.

### Live, connected CRM Preview conversation checks

The protected CRM feature Previews were tested using Vercel sandboxes with synthetic sessions, pacing below the normal CRM rate limit. No customer identities, deposits, applications or production changes were involved.

- **C1, five turns, passed:** finding a van for plumbing; customer specified automatic, a monthly budget, ladders/tools; the assistant used the requirements and asked the useful next question about ladder length, without guessing a van price.
- **C2, five turns, passed:** customer first asked for a manual Transit for furniture deliveries, then corrected to automatic and discussed a newly established business. Asked at the end which gearbox they wanted, the assistant accurately remembered **automatic**, with no approval promise.
- **C3, five turns, passed:** Rent2Buy self-employment → required documents → credit checks → early termination → insurance before collection. Answered from the correct Rent2Buy policies without drifting into finance terms.
- **C4, three turns, passed:** on a Rent2Buy listing, monthly illustration → £200 reservation payment → `Is that separate from the initial rental?`. The assistant correctly distinguished the holding deposit from initial rental instead of repeating the listing/selected payment figures.

The first four-case run was blocked by Preview sign-in until the correct Vercel `_vercel_share` URL was used. A subsequent same-region attempt hit the **shared test-egress IP's CRM 15/minute / 200/day limits**, producing HTTP 429; these were transport/rate-limit blocks, not customer-answer failures and **not counted as passing tests**. Fresh, differently located authorized sandboxes were used for successful final evaluations. The four passing scenarios are from real protected CRM API sessions.

Manual review noticed the earlier model repeatedly asked about van size even after the customer moved to a finance eligibility question. Updated the prompt guidance in code commit `0fee1bb` and added explicit test guidance, then retested against **the final code Preview at `64a4023`** from a fresh Dublin sandbox. **C2 and C4 both passed on that final revision.** C2's five replies now follow the gearbox correction and the subsequent eligibility questions without repeatedly forcing the sizing question; final response correctly states automatic. C4 still answers that the £200 reservation payment is separate from initial rental. Final-turn client-to-CRM latency was approximately **1.35 seconds (C2)** and **1.44 seconds (C4)**; complete multi-turn browser/widget timings were not measured in this run.

The previously recorded **36/36** lean-engine golden benchmark was measured on the earlier CRM feature code, before this final conversation-prompt polish. Its results remain a useful baseline **but are not a fresh 36-case regression on `64a4023`**.

### Still required before any production release

1. Run `node --test tests/askme-lean-engine.test.js tests/askme-knowledge-retrieval.test.js tests/askme-stage-a-accuracy.test.js` in the full CRM repository, and repeat the full 36-case live suite on the final approved code head (observe IP rate limits). The new dedicated Node tests were committed but not separately executed through the restricted assistant tooling; Preview build readiness is not a substitute.
2. Complete the connected **hosted website** Preview rehearsal with both actual widgets, selected **CRM-signed Rent2Buy** calculator quotation, quote verification, reserve/status guards, application route and CTA/launcher telemetry. The above conversational tests exercised CRM sessions, **not browser-rendered signed-quote end-to-end**.
3. The assistant currently guides customers about their needs and offers Browse but **cannot independently retrieve and recommend specific live available DealerKit stock** until the separate stock-search tool is added. Business-page metadata is linked; full page body text is not indexed. WhatsApp transport adapter remains future work.
4. The recent-turn limit is deliberate: it preserves useful context for several exchanges without unbounded model cost; indefinite conversation memory or verified customer-specific retention has **not** been implemented. Measure longer real conversations before extending it further.
5. Explicit production release authorization remains required. The lean switch is OFF for customers. Do not merge or attach public domains as part of conversation QA.
