# Rent2Buy flexible pricing rollout

**Status:** DEVELOPMENT ONLY. Draft PRs are unmerged. No live Wix price, CRM record, DealerKit stock workflow, image feed, cron or production database schema has been changed.

## Scope

This project adds Felix's configurable Rent2Buy pricing structure to the **existing** Rent2Buy stock and vehicle pages.

It does **not** replace DealerKit stock ingestion, images, galleries, Stock Watch, existing availability handling, social automation or unrelated Finance/Cars pricing.

The job is:

1. Use the existing reviewed DealerKit vehicle retail price, year and mileage.
2. Calculate Rent2Buy pricing from Felix's matrix.
3. Let customers choose contract term, contractual monthly mileage and approved initial rental.
4. Support exact manually approved special deals without allowing ordinary price sync to overwrite them.
5. Carry the exact selected vehicle, term, contract mileage, monthly rental and initial rental into the application, Main CRM and internal email.
6. Keep the customer's separate intended-use mileage and monthly budget questions unchanged.

## Felix matrix implemented

Server-side pricing lives in `lib/rent2BuyFlexiblePricing.mjs`.

Ex-VAT monthly formula:

`Retail / T + Retail * 0.25 / 12 + (milesPerMonth - 3000) * 0.05 - ((initialRental - minInitial) * 1.5 / T)`

Monthly rental rounds **up** to the next £5.

Rules implemented:
- Minimum initial rental £1,000 + VAT.
- Initial options: 1x, 1.5x, 2x and 2.5x matrix minimum, rounded to nearest £10.
- Terms: 12, 18, 24, 30, 36, 42, 48 months.
- Up to 48 months where vehicle age is within four years and odometer is 50,000 miles or less; otherwise maximum 36.
- Mileage: 1,000-2,000 supports up to 48 months; 2,500-3,000 up to 36; 3,500 up to 30; 4,000 up to 24.
- Default advertised matrix configuration is longest eligible term, 1,000 miles/month and minimum initial rental.
- Exact special deal applies only when term, contractual mileage and initial rental match the approved special. Changing them returns to standard matrix pricing.

Reference calculations tested include Felix's £12,000 / £400 case and supplied Maxus, Transit Custom and Primastar examples.

## Existing four fixed legacy special deals

These four registrations are intentionally **off the Felix customisable matrix**:

| Registration | Fixed monthly + VAT | Fixed initial + VAT | Fixed term |
|---|---:|---:|---:|
| BT25 LVK | £595 | £2,000 | 48 months |
| FV74 BBJ | £545 | £2,000 | 48 months |
| FV74 BEO | £595 | £2,000 | 48 months |
| BJ74 HTL | £595 | £2,000 | 48 months |

No contractual mileage allowance is stored or required for these four because the customer cannot customise them.

Confirmed corrections:
- FV74 BBJ: 48 months. The old 36-month detail value is incorrect.
- BJ74 HTL: £595 + VAT monthly / £2,000 + VAT initial / 48 months. The old detail value £693 / £2,079 is incorrect.
- BJ74 HTL's earlier 40-month verbal reference was immediately corrected; 48 months is authoritative.

Implementation rules:
- hide the Customise your rental drawer on all four;
- website detail rendering uses the fixed values above if CMS detail data differs;
- normal Wix price sync remains blocked on all four;
- Marketing CRM legacy-special section is read-only for all four;
- API draft creation cannot convert any of the four to an editable special;
- no contractual mileage is invented.

Detailed fixed-special record: `docs/rent2buy-existing-specials-signoff.md`.

## Marketing CRM

Draft PR #689 contains:
- Felix pricing engine and regression tests.
- Four-registration migration hold.
- Protection in both Rent2Buy Wix price-write paths.
- Future special-deal write protection, activated only together with the special-deal editor.
- Separate special-deal draft policy and review-only SQL proposal: `docs/sql/rent2buy_special_deals_REVIEW_ONLY.sql`.
- Compact special-deal editor in Rent2Buy DealerKit review only.
- Server-side selector choices and signed quote issuer.
- Server-side signed quote verifier that recalculates against the **existing reviewed DealerKit vehicle retail/year/mileage**.
- Internal application email display of verified selected rental.
- Read-only Wix special-deal reconciliation.

The quote source deliberately does **not** use a new stock snapshot/cache or retail-approval subsystem.

## Customer vehicle pages

Standalone Rent2Buy draft PR #51 and VFC Rent2Buy draft PR #165 contain:
- One compact **Customise your rental** trigger beneath the existing price cards.
- Closed right-hand drawer / mobile full-width sheet.
- Existing vehicle gallery, advertised Wix price boxes, specifications and current Apply Now remain intact.
- Contract length, contractual monthly mileage and initial-rental selectors.
- No Felix pricing maths in the browser.
- Preview-only server bridge can request approved options and a signed quotation.
- The old signed quote is cleared whenever the customer changes a selection.
- Application handoff is a separate feature gate.

## Application and Main CRM

Main CRM draft PR #151 plus both website PRs provide:
- Signed quote token passed instead of browser-entered approved amounts.
- Server verification and recalculation before selected terms are accepted.
- Exact vehicle, term, contractual monthly mileage, monthly rental and initial rental stored in lead notes.
- VAT-inclusive amounts included.
- Internal email receives the verified selected rental.
- The application's existing intended-use monthly mileage and monthly budget remain separate.
- Legacy registration-only applications remain supported.

## Feature gates

Nothing should be enabled until preview testing and special-deal sign-off are complete.

Relevant server switches:
- `RENT2BUY_SPECIAL_PRICE_WRITE_GUARD_ENABLED`
- `RENT2BUY_SPECIAL_DRAFTS_ENABLED`
- `RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED`
- `RENT2BUY_QUOTE_VERIFIER_ENABLED`
- Website preview: `RENT2BUY_CALCULATOR_PREVIEW_ENABLED`
- Website server proxy: `RENT2BUY_QUOTE_PREVIEW_PROXY_ENABLED`
- Application selected quote: `RENT2BUY_SELECTED_QUOTE_FORMS_ENABLED`

The special-deal draft editor cannot save new specials unless the future-special Wix writer guard is also active.

## Explicitly removed as out of scope

The feature branch previously experimented with:
- a separate complete DealerKit stock snapshot table,
- a 90-second stock cache,
- new Stock Watch / monitor capture hooks,
- a stock-readiness analyser,
- a separate retail/VAT approval table.

Those changes have been removed. Existing stock/image/monitor behaviour is restored to `main`.

## Remaining work before completion

1. Keep the four fixed legacy specials protected as defined above. They no longer need mileage confirmation or migration into an editable special-deal record.
2. Review the future-special database schema only for **new future promotions**, not these four legacy deals.
3. Enable the matrix pricing preview only in protected development and visually inspect both vehicle pages on desktop/mobile.
4. Run end-to-end tests for matrix vehicles:
   - default matrix;
   - changed term;
   - changed mileage;
   - changed initial rental;
   - tampered/expired token rejection;
   - exact selected deal visible on application review;
   - exact deal in Main CRM notes and internal email;
   - legacy registration-only application unchanged.
5. Run fixed-special checks:
   - all four show fixed monthly/initial/48-month values;
   - no customisation drawer;
   - BJ74 HTL never shows £693/£2,079;
   - FV74 BBJ never shows 36 months.
6. Only after those checks: decide merge/deployment sequence.

## Branches

- Marketing CRM: draft PR #689
- Main CRM: draft PR #151
- Standalone Rent2Buy: draft PR #51
- VFC Rent2Buy: draft PR #165

All remain unmerged.
