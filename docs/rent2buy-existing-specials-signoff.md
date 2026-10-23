# Existing Rent2Buy special deals: pre-migration sign-off

**Status: HOLD. No permission to publish or correct prices.**
Read-only Wix comparison: 23 October 2026 (the records were last updated 9 October).
Collections: shared VAN FINANCE Wix CMS, ALLRENT2BUYVANS and VANPAGES.
Monthly figures below are **ex VAT**, displayed Wix values, not approved new-matrix quotes.

| Registration | Wix listing monthly / initial / payments | Wix detail monthly / initial / payments | CRM saved term | Current issue |
|---|---|---|---|---|
| **BT25 LVK** | £595 / £2,000 / 48 | £595 / £2,000 / 48 | 48 | Display matches; mileage/initial terms not commercially verified |
| **FV74 BBJ** | £545 / £2,000 / 48 | £545 / £2,000 / 36 | 36 | **48 vs 36 payments**; do not choose automatically |
| **FV74 BEO** | £595 / £2,000 / 48 | £595 / £2,000 / 48 | 48 | Display matches; mileage/initial terms not commercially verified |
| **BJ74 HTL** | £595 / £2,000 / 48 | £693 / £2,079 / 48 | 48 | **Monthly AND initial differ**; 48 months confirmed by user, the earlier 40 was retracted |

The business owner identified all four as protected manually priced specials. This confirms **the registrations must not be overwritten by normal price sync**, not that any specific Wix payment count, initial rental or allowance is the contractually approved figure.

## Required sign-off, per registration

- DealerKit supplier stock ID and current available status
- Approved monthly rental ex VAT and approved initial rental ex VAT
- Agreed contract length/payment count and monthly mileage allowance
- Approved person, reason and optional expiry
- Approved retail VAT treatment, and valid source retail
- Reconciled Wix listing and detail fields
- Verified selected quote and terms on application, CRM lead and internal email

Do not infer 1,000 miles from Felix's matrix default. Do not press Price Differences > Update Wix price for any of these registrations. Do not activate the new price publisher until the complete commercial records have been approved.

The module lib/rent2BuySpecialWixReconciliation.mjs is a read-only discrepancy detector, not a pricing authority or Wix modifier. Its test fixtures reproduce the 23 October read-only source records.

## Development status

Four unmerged draft PRs:
- Marketing CRM #689: pricing engine, protected special deals, quote verification
- Main CRM #151: approved quote application and email handoff
- Standalone Rent2Buy #51: calculator layout and application
- Van Finance Company #165: matching calculator and application

No live Wix fields, Supabase schemas, jobs or customer applications were changed in this work.
