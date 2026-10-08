# Future DealerKit VFC finance pricing: 9.9% effective APR

## Status
Proposed code in **draft PR #628**. The completed 8 October current-stock Wix/CRM repricing is separate, documented in [rollout log](vfc-monthly-pricing-rollout-log-20261008.md). This future-stock code has **not** been merged into Marketing CRM production.

## Shared source of truth
`lib/vfcFinancePriceMatrix.mjs` exports `calculateVfcAdvertisedMonthly`:
- Financed principal = DealerKit VFC retail cash price, because +VAT vans use the VAT amount as upfront deposit, while non-VAT vans and VFC cars finance their full advertised cash price.
- Monthly rate = `(1 + 0.099)^(1/12) - 1`.
- 60 equal Hire Purchase payments. Displayed monthly amount rounds **up to the nearest pound**; the vehicle-page finance calculator retains its full-precision amount to pence.
- Missing/malformed prices return null; source VAT evidence must still pass the separate DealerKit/Wix VAT validation.

## Integration points
- `lib/dealerKitWixCreatePlan.js`: all new VFC van collection cards, main listing and detail page share the 9.9% monthly amount.
- `lib/dealerKitCarWixPlan.js`: new cars in CARFINANCE and CARPAGES use the same APR without adding VAT.
- `lib/dealerKitWixPublishPreview.js`: original reviewed van publish preview uses 9.9% and binds the confirmation to those prices.
- `lib/dealerKitControlledPublishPlan.js`: full reconciliation invokes the new VFC create pricing plan, preserving DealerKit review/media gates.
- `lib/vanscoWixPrice.js` and `lib/dealerKitPublishedPrice.js`: edited published-price patch payloads use 9.9% in all VFC van and car collections, retaining existing retail-price and Was-price logic.
- `api/dealerkit-published-price.js` and `api/vansco-wix-price.js`: reported price-preview amounts match the actual patch amounts.
- `lib/dealerKitRent2BuyPlan.js`, Rent2Buy Wix create/reconcile and monthly rental rules are **not modified**. Historical `calculateFivePercentFlatMonthly` remains available to legacy comparisons but is no longer called by VFC DealerKit price writing routes.

## Held stock
`VFC_PRICING_REVIEW_HOLDS` is a temporary explicit blocklist in the VFC helper. It keeps ten current stock registrations out of new-price publishing or republishing:
WGZ8806, WM73CXJ, YK23ZYA, JM10ASM, LM70YPT, MT18UFR, PE71YTG, FL19OFN, FL71GZW and SF70TNO.

Only after individual Wix cash/monthly/VAT reconciliation should these registrations be cleared from the review hold in a subsequent audited PR.

## Testing and release
- 9.9% matrix unit tests; DealerKit VFC create, Cars controlled publish, controlled VFC targets, VFC price patch, Cars price patch, the older VFC price API and publish-preview tests were updated.
- The existing DealerKit source-fact equipment specification build transforms and Rent2Buy tests remain enabled.
- **Do not merge PR #628 until deployment checks pass and an authorised review confirms future-stock behaviour**. No bulk repricing or old-CSV replay runs as part of the PR.
