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
