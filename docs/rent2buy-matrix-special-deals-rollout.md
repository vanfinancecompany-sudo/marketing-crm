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
