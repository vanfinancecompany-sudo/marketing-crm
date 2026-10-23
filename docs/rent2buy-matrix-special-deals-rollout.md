# Rent2Buy pricing matrix + special deals: staged rollout

Status: **engine-only feature branch**. Do not merge/deploy as a pricing switch until migrations, UI, contract review and existing special-deal import are complete.

## Background

Reference: Felix Reeves, "Flexibuy pricing matrix", dated 30 September 2026 (five pages). Two public sites:
- standalone Rent2Buy vehicle detail: vanfinancecompany-sudo/rent2buy-vans, app/van-pages/[registration]/page.jsx
- Van Finance Company Rent2Buy vehicle detail: vanfinancecompany-sudo/vanfinance-co, app/rent2buy-concept/vans/[registration]/page.jsx

The Marketing CRM (this repo) already publishes DealerKit Rent2Buy price fields into Wix via lib/dealerKitRent2BuyWixPlan.js. Existing pricing is 36m/75% or 48m/90% uplift, **not** the new Felix calculation. The current shared Wix CMS is on the Van Finance Wix site; the standalone public website reads it too. Avoid reintroducing writes to the retired standalone CMS.

## Pricing engine

lib/rent2BuyFlexiblePricing.mjs implements the Felix matrix in isolation, no live writers. Tests in tests/rent2buy-flexible-pricing.test.mjs cover worked PDF examples, VAT, term eligibility and special-deal exact-match overrides.

Rules:
- Retail R, term T: R/T + R*25%/12 + (milesPerMonth-3000)*0.05 - (initial-minInitial)*1.5/T.
- Round *final monthly* up to next £5; all amounts + VAT (20% UK standard) and quote incl VAT.
- The initial minimum: nearest £10 to 3*(R/36 + R*25%/12), floor at £1,000 ex VAT for Rent2Buy; ladder 1x,1.5x,2x,2.5x rounded nearest £10.
- Allowed terms 12–48 months in six-month steps, maximum term min(vehicle-age/mileage cap, selected monthly-mileage cap); 42m treated like 48m when eligible, per current PDF.
- Vehicle eligibility: 48m only when current year - registration year <=4 AND odometer <=50,000; otherwise 36m.
- Monthly mileage eligibility: up to 2000 -> 48m; 2500/3000 -> 36m; 3500 -> 30m; 4000 -> 24m; >4000 -> POA.
- Default quote longest allowed term, 1000 monthly miles and minimum initial. Special deal defaults to exactly its agreed combination.
- A special deal only applies when chosen term, miles and initial exactly match the manual agreement. Any changed selection must revert to the standard matrix (and choose a valid initial ladder amount). No blanket price reductions on all terms.
- If numeric retail, age, mileage or pricing context is invalid, **fail closed**: no invented price.

### Two commercial decisions to confirm before launch
1. Existing Rent2Buy payment structure has specific pickup rules and 36/48-month terms. Verify whether 12/18/24/30/42-month options and pickup/4x4 terms are contractually approved. If not, disable unsupported terms even though Felix's matrix can calculate them.
2. Verify the correct retail price VAT basis against FlexiBuy's source, and confirm 20p excess mileage treatment / early swaps / special-offer expiry text. Do not silently copy different terms from FlexiBuy.

## Special-deal migration and storage (NOT YET IMPLEMENTED)

Before enabling publication:
1. Obtain all currently manually adjusted special-deal registrations and their *approved* monthly ex-VAT rental, initial ex-VAT rental, contract length and monthly mileage, directly read/verified from Wix.
2. Save special deals in a dedicated, durable per-vehicle source with registration + DealerKit stock ID, enabled flag, explicit four price terms, updated_by/updated_at, audit history and optional expiry date. Prefer a separate table from the existing dealerkit_rent2buy_settings upsert, because that upsert recomputes derived settings on review and should never reset overrides.
3. In Marketing CRM Stock / DealerKit Rent2Buy settings add Standard Matrix / Special Deal toggle. Switching to Special Deal requires all fields, server-side validation, and a preview of current-vs-proposed prices on both sites. Switching back must be explicit.
4. Publisher resolution order: enabled & valid explicit special deal for its exact quoted configuration -> matrix, otherwise hold/errors for missing source. Preserve special-deal values across DealerKit imports and automatic syncs. Do not write any price to Wix while source-of-truth overrides are being migrated.
5. Add an authoritative, versioned API to serve quote configurations to BOTH vehicle-page implementations. Protect updates with server-side auth; do not expose service keys.
6. Add customer quote selection to Rent2Buy application hand-off (reg, supplier ID, quote source, contract months, monthly miles, initial and monthly ex/in VAT, quote timestamp/ID). Recompute/validate server-side to prevent customer-edited amounts.

## Minimal vehicle page layout (Codex implementation brief)

**Do not redesign the vehicle page.** Keep the existing left gallery/thumbs and right column width, black vehicle heading, prominent red monthly price box, light-grey initial price box, compact specification chips and Apply Now button. Keep both +VAT and inc VAT prices.

Put a small accessible "Customise your rental" link/button **beneath the price boxes**. Default page height should remain almost unchanged. The button opens a contained sliding drawer on desktop and bottom sheet/full-screen on mobile. The drawer provides:
- contract length selectable valid months, unsupported choices disabled (not selectable);
- mileage in monthly 500-mile increments from 1000 to 4000, >4000 POA;
- four initial rental options based on live vehicle retail price;
- an always-visible quote summary in drawer that updates instantly, with Apply with this quote action.
- on close, chosen quote updates *the existing* monthly and initial cards, contract pill and selected term/miles summary. Applying passes the exact quote.
- special deals show a restrained badge; modifying a fixed special deal switches to matrix pricing and clearly states the special only applies to the original agreed terms.
- no long disclaimers, extraneous panels or added duplicate CTAs.
- keyboard and touch accessible; preserve current mobile layout.

## Launch and regression gate

- First, read-only verification of DealerKit retail source, existing Wix records, currently active special deals and sales terms. Compare figures across Marketing CRM, Wix CMS, BOTH vehicle pages and enquiry/application.
- No live edits or mass stock republishing before the special deals are imported and verified.
- Stage feature behind a disabled server-side feature flag, with preview/rollback.
- Smoke test 36/48m current ads, all five PDF examples, pickup/4x4, 1000 minimum, special overrides, quote changes, VAT, empty/invalid data, archived vehicles, and stale/reserved/sold stock handling.
- On launch, monitor changed vehicle counts and diff all prices against approved figures; never silently replace special/manual prices or other products.


## Confirmed currently protected specials (Marketing CRM screenshot, 23 Oct 2026)

User explicitly identifies these **four Rent2Buy vehicle registrations** in the Marketing CRM *Price differences* advisory view as manually protected special deals. These are the **currently published monthly prices**, EX VAT:

| Registration | Published monthly + VAT | Existing CRM expected monthly (old formula) | DealerKit retail (shown) |
|---|---:|---:|---:|
| BT25 LVK | £595 | £732 | £18,495 |
| FV74 BBJ | £545 | £714 | £14,695 |
| FV74 BEO | £595 | £621 | £15,695 |
| BJ74 HTL | £595 | £693 | £17,495 |

**CRITICAL: do not press 'Update Wix price' for these four registrations.** The *expected* values shown by the current Price differences system do **not** represent Felix's new variable-term matrix and must not be used as override prices.

**Not yet established:** contract length, allowed miles per month, initial rental, offer eligibility/expiry, and whether the special applies to only one configuration. Read each vehicle's actual approved Wix records and/or confirm with the user before storing a complete deal and migrating to the new system. The screenshot alone is sufficient to mark these **candidates for protection** in the migration plan, but **not** to auto-activate a quote override with invented terms.

Prior to cutover, snapshot every existing Wix published price and cross-check each site's current view; save durable special-deal overrides with price + qualifying terms and verify preview diffs before enabling any publisher changes. Leave current manual Wix pricing untouched.

## Mandatory customer application quote handoff (confirmed 23 October 2026)

User instruction: after adjusting terms, customer's exact selected vehicle and deal MUST appear on the application form and submit to the main Rent2Buy CRM application, like the FlexiBuy example. This is LAUNCH-BLOCKING.

### Traced live data route
- Standalone Rent2Buy: rent2buy-vans/components/Rent2BuyApplicationForm.jsx → app/api/rent2buy-apply/route.js.
- VFC Rent2Buy: vanfinance-co/components/Rent2BuyApplicationForm.jsx → app/api/rent2buy-apply/route.js.
- CRM: crm/api/create-rent2buy-web-lead.js (authenticated) → crm/api/create-rent2buy-lead.js stores manual_leads.notes, registration, vehicle and source.
- Internal notification: crm/api/_rent2BuyInternalNotification.js → marketing-crm/api/transactional-rent2buy-application.js.

The existing general "Monthly mileage" form answer is a USAGE ESTIMATE and must remain separate from the SELECTED QUOTE MILEAGE ALLOWANCE.

### Mandatory visible selection summary and persisted values
- Vehicle identity: registration, model/title, image if available
- Quoted contract length in months
- Selected monthly mileage allowance in miles/month
- Monthly rental EX VAT and INC VAT
- Initial rental EX VAT and INC VAT
- Pricing mode: matrix or special deal, with fixed special term restriction
- Stable quote ID and source revision for audit

The application form displays the summary on entry and review, submits a server-validated quote token alongside its current fields. Server must recheck registration, stock eligibility, current price revision, term/miles/initial and special-deal override. Never trust a submitted browser price, editable query parameter, or local storage. CRM writes verified terms to lead notes (or a protected reviewed structured table) AND shows the identical summary in its internal email. Validation failures need customer-friendly recovery; do not silently discard selection.

Old registration-only applications must still work. No change to postcode (100 miles), proof requests or finance/other pipelines. Submitted quotes must not be retroactively overwritten.

A pure server-side token contract and tests are staged in lib/rent2BuyQuoteHandoff.mjs but NOT connected to the live issuer or forms. Signing requires a secret held in server env only. End-to-end quote issuance, form summary, CRM ingest, notification and source revision revalidation MUST be complete before release.

### Mandatory preview tests
1. Change term, mileage and initial; see chosen vehicle and quote on application and final review.
2. Preview submit: same quote appears in CRM lead notes and internal notification, with both VAT variants.
3. Special: exact approved combination uses special price; altered configuration returns to matrix (with valid initial ladder).
4. Forged amount, wrong reg, stale token and unsupported contract fail closed with recovery path.
5. Check untouched eligibility, proofs, archived vehicles and registration-only applicants.

## Verified live Wix read-only snapshot, 23 October 2026

Site: VAN FINANCE Wix CMS (the shared source for both public sites), site ID 85f11c52-ee54-495d-aaec-a351831709b5. Two collections queried with Wix Data Items Query, **without mutations**: ALLRENT2BUYVANS (listing) and VANPAGES (detail).

| Reg | Listing monthly +VAT | Listing initial +VAT | Listing term | Detail monthly +VAT | Detail initial +VAT | Detail term |
|---|---:|---:|---|---:|---:|---|
| BT25LVK | £595 | £2,000 | x48 | £595 | £2,000 | 48X |
| FV74BBJ | £545 | £2,000 | x48 | £545 | £2,000 | 36X |
| FV74BEO | £595 | £2,000 | x48 | £595 | £2,000 | 48X |
| BJ74HTL | £595 | £2,000 | x48 | £693 | £2,079 | 48X |

**UNRESOLVED PREEXISTING INCONSISTENCIES:**
1. BJ74HTL listing shows special £595 monthly and £2,000 initial, but detail shows £693 monthly and £2,079 initial. Never override either value automatically. Obtain approval which is binding before syncing.
2. FV74BBJ listing shows x48 but detail says 36X. The screenshot confirms £545 special monthly, NOT the proper term. Ask commercial owner to confirm the special terms before importing/updating.
3. None of these Wix CMS records includes an approved special-offer monthly mileage allowance. Do not assign 1,000 miles/month merely because the new matrix defaults to it.
4. These are publicly published CMS price records, NOT a complete special-deal contract. Do not automatically treat them as full verified overrides.

The temporary migration hold in lib/rent2BuyProtectedSpecialDeals.mjs blocks controlled Wix Rent2Buy publishing by registration, independent of conflicting source values. This safeguard exists ONLY ON THE DEVELOPMENT BRANCH until reviewed and merged; it is **not active in production**.

Do not touch live Wix items or click CRM "Update Wix price" buttons for these registrations until the price/term discrepancy and contract mileage are resolved.

## Corrected commercial term: BJ74 HTL (user-confirmed, 23 October 2026)

The user corrected their earlier statement: **BJ74 HTL is 48 months, NOT 40**. Disregard the temporary 40X instruction as superseded. Both existing Wix listing and detail CMS entries showed 48X monthly payments in the read-only check, and the user now confirms that 48-month term is correct. Do not create any exceptional 40-payment agreement for this vehicle.

The separate Wix price discrepancy is **still unresolved**: listing £595 + VAT monthly and £2,000 + VAT initial, versus vehicle detail £693 + VAT monthly and £2,079 + VAT initial. The user-approved special-deal status remains protected. Do not change live records or infer which price is authoritative without verification.


## Development progress: isolated special-deal editor, 23 October 2026

The same *unmerged draft branch* now includes:

- lib/rent2BuySpecialDealPolicy.mjs: per-registration + DealerKit-stock-ID validation, exact term/mileage/price, £1,000 ex VAT initial minimum and audited-draft policy. Source retail amount preserves DealerKit VAT status instead of assuming ex-VAT.
- docs/sql/rent2buy_special_deals_REVIEW_ONLY.sql: proposed independent per-vehicle and audit tables with RLS and revoked public access. **Never auto-applied. Not executed in production.**
- api/dealerkit-rent2buy-special-deal.js: authenticated GET preview and PUT save_draft, behind RENT2BUY_SPECIAL_DRAFTS_ENABLED=true. **Default disabled**. No Wix publishing calls. Optimistic revision check; cannot overwrite an existing active or inactive deal via draft save.
- utils/rent2BuySpecialDealEditor.js: compact collapsed DealerKit Rent2Buy-only pricing editor in current stock review. Shows the four known holds read-only until feature is enabled. Does not change VFC/Cars and cannot write current Wix prices.
- utils/vanscoWixPriceHelper.js: the *Price Differences* UI disables its "Update Wix price" button for each of the four known protected Rent2Buy registrations; the API also rejects the action independently.
- tests/rent2buy-special-deal-drafts.test.mjs and updated rent2buy-protected-specials.test.mjs, included in the dedicated CI workflow. GitHub Actions Rent2Buy Pricing Safety completed successfully on commit 13a1b93.

**STILL PENDING**: approved special-deal term/mileage source, migration sign-off, enabling draft storage, active-price resolution, shared quote API, both public vehicle selector pages, application/CRM/email quote ingestion and cross-site preview tests. Do not merge or deploy based solely on the isolated unit tests.

### Decision gate
The existing Wix listing/detail disagreements for BJ74 HTL and FV74 BBJ remain unresolved. The user confirmed **BJ74 HTL is 48 months**, reversing the previous 40-month comment. No initial price, contract allowance or term must be guessed. No production price updates.


## Selected-deal application integration, staged 23 October 2026

**Draft pull requests, all unmerged:**
- Marketing CRM pricing + special-deal state, internal email & pure current-source quote verifier: https://github.com/vanfinancecompany-sudo/marketing-crm/pull/689
- Main CRM approved quote and lead notes: https://github.com/vanfinancecompany-sudo/crm/pull/151
- Standalone Rent2Buy customer application: https://github.com/vanfinancecompany-sudo/rent2buy-vans/pull/51
- VFC Rent2Buy customer application: https://github.com/vanfinancecompany-sudo/vanfinance-co/pull/165

### Data handoff
The price selector must issue a short-lived, server-signed rental token only after checking the **authoritative** approved source revision. It identifies the vehicle registration, name, exact pricing mode, term, selected monthly **contract allowance**, initial rental ex/inc VAT and monthly rental ex/inc VAT. The customer's independent **estimated usage** question and **monthly budget** stay unchanged.

Both public application forms have a new server-verified quote slot and a compact quote summary near the vehicle and at final review, plus token-only submission. Both keep seven application steps. An unverified quote link blocks progression **at the start**, instead of silently discarding the customer's choice. No raw client-entered amounts are sent as approved prices.

The CRM ingestion PR verifies the signed token, registration and expiry; still requires a callback confirming the current source revision. The new marketing-crm pure helper lib/rent2BuyCurrentSourceQuote.mjs recalculates the price and validates the actual approved source. The internal email uses the same verified term, allowance and VAT figures. All parts are off or fail-closed until fully wired.

### Critical pending integration (do not mistake passing unit tests for production readiness)
1. No **server-side source adapter** yet builds a fully verified current pricing snapshot from DealerKit + authorised finance/retail VAT basis + reviewed decision + audited active override. Current status checks must require an in-stock, unambiguous identity.
2. No authorised **active quote issuer / current-source API** yet signs quotes or verifies them using the dedicated source adapter. The website loader expects an authenticated endpoint response with ok=true, current=true, sourceRevisionVerified=true, quote.
3. The CRM requires its independently trusted current-source callback. This is **unwired**. Therefore any customised token must currently be **rejected** even if an operator accidentally enables a front-end flag.
4. Four legacy manual Wix special deals have not been imported/approved. BJ74 HTL is **48 months** (NOT 40) but listing/detail prices disagree; FV74 BBJ term still differs between listing and detail; their contract mileage is not verified.
5. No production Supabase migration executed. No live Wix or main CRM records changed. All site application changes are in separate draft branches.
6. Do not enable RENT2BUY_SELECTED_QUOTE_FORMS_ENABLED, RENT2BUY_QUOTE_HANDOFF_ENABLED, RENT2BUY_SPECIAL_DRAFTS_ENABLED, or any active quote issuance/publishing flag until all tests, commercial approval and preview CRM/email submissions pass.

**Acceptance condition:** A customer selecting 36 months / 1,500 miles / approved initial rental must see those EXACT figures before submission, in final review, in main CRM notes and in the internal email. An expired or tampered quote must be rejected without a created lead. A normal registration-only application and existing proof workflow must remain unchanged.

## Read-only Supabase verification and private current-source endpoint (23 October 2026)

A read-only query against the active crm Supabase project identified existing dealerkit_review_decisions, dealerkit_rent2buy_settings, facebook_adverts and rent_vehicles. The proposed new dealerkit_rent2buy_special_deals and dealerkit_rent2buy_retail_approvals tables DO NOT exist. No SQL migration was applied.

All four protected registrations have a saved reviewed decision with rent2buy_enabled=true:
- BT25LVK: stored term 48 months.
- FV74BBJ: stored term 36 months. Wix listing separately showed 48X; detail showed 36X. Commercial confirmation required.
- FV74BEO: stored term 48 months.
- BJ74HTL: stored term 48 months, as corrected by user (not 40). Wix listing/detail price conflict unresolved.

rent_vehicles includes historical inactive duplicates. BT25LVK has an active internal row with £733 PM / £2,199 initial versus protected Wix special £595 / £2,000. Never use local rent_vehicles as the source of approved special prices.

### Staged private stock and pricing verifier
- docs/sql/rent2buy_retail_approvals_REVIEW_ONLY.sql: independent approval of EX-VAT base amount, source retail/VAT snapshot and explicit allowed term list; PROPOSAL ONLY.
- api/_rent2buy-quote-source.js: read-only loader requiring complete DealerKit snapshot, one matching registration/stock ID, available status in both snapshot and fresh detail, matching mileage/retail/VAT/source timestamp, current saved reviewed Rent2Buy decision and approved retail basis/contract terms. Missing approval table fails closed.
- lib/rent2BuyCurrentSourceQuote.mjs: version hashes include approval revision and contract terms; rejects unapproved terms.
- api/_rent2buy-quote-verify-handler.mjs: checks signed token, expiry, vehicle identity and independent current approved source.
- api/rent2buy-quote-verify.js: server-to-server x-rent2buy-quote-verifier-key header; default disabled by RENT2BUY_QUOTE_VERIFIER_ENABLED.
- CRM PR #151 independently posts the signed token to the same approved-price verifier before writing any selected quote to a lead or internal email.

CAPACITY BLOCKER: strict adapter fetches a FULL DealerKit snapshot per verification. This is safe for isolated prototype tests but NOT production-suitable; do not enable customer traffic without a safe, short-lived complete-snapshot caching strategy and API-limit verification. Do not weaken completeness checks.

Commercial blockers: the four exact approved terms/mileage, BJ74HTL price conflict, FV74BBJ agreement term, source retail VAT basis, permissible short contracts, secure quote issuance, Codex selector, preview E2E and internal email receipt.
## Additional continuation: signed quote issuer and known stock identities

User-protected specials confirmed in active Supabase DealerKit review and settings (read-only, 23 October 2026):
| Registration | DealerKit stock ID | Stored term |
|---|---|---:|
| BT25LVK | c500e0856a9b1415e8194 | 48 |
| FV74BBJ | c500e0856aa7d3d079064 | 36 (Wix listing says 48X; unresolved) |
| FV74BEO | c500e0856aa7d41dd41aa | 48 |
| BJ74HTL | c500e0856abce8a4b7b8b | 48 |

New pure server-only module lib/rent2BuyQuoteIssue.mjs signs 30-minute quotes using the already-approved source, rechecking the full current-source quote verifier before signing. It supports fixed-term specials and the standard matrix, but will not silently turn a protected Wix special into the standard matrix. Tests in tests/rent2buy-quote-issue.test.mjs.

NO PUBLIC QUOTE ISSUANCE API YET. It would trigger expensive full DealerKit reads and remains unsafe for customer traffic without a validated complete-stock snapshot strategy plus rate controls. Do NOT add a public endpoint or enable environment flags until approved. No live tables, Wix prices, websites or main CRM records were changed.
## Complete DealerKit quote snapshot cache (staged 23 October 2026)

**Problem addressed:** the original strict verifier launched a COMPLETE DealerKit stock scan for every customer's selected quote. This would multiply provider API calls and could trigger 429s. The existing 20-second in-process Stock Watch memo is not shared across Vercel instances; the dealerkit_stock_state table holds LAST-KNOWN stock and is not authoritative current availability.

### New read-only quote path

1. Existing api/dealerkit-stock-watch-session.js ALREADY loads a single stable bulk DealerKit snapshot. Behind a disabled RENT2BUY_QUOTE_SNAPSHOT_CAPTURE_ENABLED flag it can persist a **minimal manifest only when source completeness is confirmed**. This does **not** trigger an additional DealerKit scan or write to Wix. Partial snapshots are not stored as quote-authoritative.
2. docs/sql/rent2buy_complete_quote_snapshots_REVIEW_ONLY.sql describes a proposed private, append-only complete-manifest table, with row-level security and no browser policies. The SQL is a **proposal and has not been applied**.
3. api/_rent2buy-complete-quote-snapshot.mjs builds a canonical manifest, checks totals, duplicates and stability, hashes the exact data, and reads only the newest shared snapshot. A read fails closed after **90 seconds** since the source checked timestamp (not since cache insertion); database errors, altered data or duplicate IDs fail closed.
4. api/_rent2buy-quote-source.js reads the shared database manifest instead of calling fetchDealerKitStockSnapshot on each quote. It still performs a **fresh single vehicle-detail read**, then checks the source's exact identity, status, odometer, year, price, VAT and updated timestamp against the cached complete snapshot.
5. The private signed token verifier and the quote issuer remain gated OFF. No public quote issuance endpoint exists.

### Release gates remaining

- Review the proposed table/retention policy, current Stock Watch refresh frequency, appropriate expiry interval and actual DealerKit API quotas; do not assume that refreshing Stock Watch often enough is free.
- Even with a valid shared manifest, the separate per-vehicle DealerKit detail request can still hit provider rate limits during high quote volume. Measure/limit before customer launch.
- If the latest Stock Watch attempt is incomplete, the last previously complete manifest remains eligible only inside its already-short validity window. **Decide whether to add an explicit degradation invalidation marker before production.**
- A live 90-second freshness target requires a reliable refresh cadence or many quote requests will rightly fail as unavailable. No cron/automation has been added.
- The four legacy protected deals, VAT approval table, commercial term agreement, secure issuer, selector UI and end-to-end application/CRM/email previews must still be resolved.
- GitHub actions: new tests in tests/rent2buy-complete-quote-snapshot.test.mjs, protected by Rent2Buy Pricing Safety CI. No production merge or deployment.

### Observed actual refresh cadence (read-only live check, 23 October 2026)

Production Vercel cron in vercel.json schedules /api/stock-watch-monitor-agent at `*/15 * * * *`. Read-only Supabase rows in public.stock_watch_monitor_runs confirm regular 15-minute DealerKit monitor runs; six latest inspected provider snapshots were complete, reporting about 257–258 vehicles. Importantly, this 15-minute monitor route is DIFFERENT from api/dealerkit-stock-watch-session.js where the optional quote-snapshot capture hook currently exists.

Consequences:
- The proposed 90-second strict freshness window is incompatible with the existing 15-minute schedule for continuously available customer calculators. DO NOT ENABLE customer quote issuance based on the current cadence.
- No hourly/minute-level new DealerKit schedule has been approved or created. NEVER increase full-feed scanning frequency merely to satisfy a calculator without measuring the provider quota and request cost.
- Investigate reusing the existing successful 15-minute monitor snapshot with a genuinely fresh single-vehicle detail request and a clearly defined acceptable freshness/stock-risk policy, OR plan a tested quota-safe faster bulk cadence. Both require explicit commercial and technical approval.
- Until then, the safe result is "quote unavailable" outside the current 90-second window. This is a release-blocking availability concern, not a reason to ignore an expired snapshot.


### Existing scheduled monitor capture added (feature remains OFF)

Additional development hook: api/stock-watch-monitor-agent.js (the existing Vercel */15 cron) now reuses its already-loaded DealerKit provider snapshot and may append a complete pricing manifest ONLY when RENT2BUY_QUOTE_SNAPSHOT_CAPTURE_ENABLED=true, source kind dealerkit, and the provider returns complete=true. A failed or incomplete capture is logged in the run snapshot but does not change Stock Watch operations. This adds ZERO second bulk-feed reads. The separate manual Stock Watch session hook remains optional and independently disabled.

The dedicated CI now checks both hook locations and the unchanged */15 cron; passing that test does NOT prove a workable 90-second customer availability window. Keep the verification and issuer OFF until that operational mismatch, commercial approvals and secure customer API are settled.