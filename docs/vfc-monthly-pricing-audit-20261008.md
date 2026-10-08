# VFC monthly pricing matrix: read-only audit, 8 October 2026

This branch proposes a **pure calculation helper only**. It is not connected to live CRM sync jobs, Wix records, automatic advertising feeds, or any stock write API. No pricing is changed by this PR.

## Agreed illustrative method
- 60 months, 9.9% effective APR, standard Hire Purchase illustration, no invented fees or balloon.
- Vans marked +VAT: default deposit equals VAT, amount financed equals ex-VAT cash price.
- Vans with N/A/no VAT: amount financed equals cash price, default deposit zero.
- Cars on VFC: no VAT deposit, amount financed equals cash price.
- Round UP to nearest pound **on listing figures**, preserving exact monthly amounts in the calculator.
- Source of truth remains Wix; CRM should consume corresponding new Wix prices only after audit and approval.
- Rent2Buy and the separate car finance website are out of scope.

## Snapshot (read-only Wix CMS and Marketing CRM)
- VANFINANCE-ALLVANS: 162 published rows, 161 distinct registration codes.
- VANFINANCEPAGES: 161 current-van detail matches, 2 existing monthly-price mismatches (WGZ8806, WM73CXJ); 1,830 published historical detail records in total. Do not bulk-edit the historical archive.
- CARFINANCE: 12 published current cars; all 12 have CARPAGES details.
- CARPAGES: 125 published detail rows (121 unique registrations), most not current listings.
- Car listing/detail mismatches: JM10ASM current monthly (£292 versus £307); LM70YPT cash (£16,495 versus £16,995); MT18UFR cash malformed on detail (£21.995 versus £21,995 on listing).
- CRM has 161 active van advertisements, but 29 active car advertisements, not all current VFC car website stock. Do not bulk-update those 29 without reconciliation.
- On listed active Wix vans, 160/161 proposed monthly figures rise, average +£2.14.
- On current Wix cars, 11 valid comparisons, 10 rise and 1 falls; one malformed price must be reconciled.

## Required before production write
1. Confirm listing/detail cash price for mismatched cars (especially LM70YPT).
2. Resolve historical listing/detail monthly-field divergences.
3. Dry-run exact Wix record IDs and old/new values; stop on parse failure, duplicate identity or race/update conflict.
4. Write only the approved current-stock monthlies to both listing and active detail collections, not historical stock.
5. Confirm next CRM sync imports the values and marketing automations do not publish stale prices.
6. Recheck VFC van and car detail, gallery, application and Rent2Buy separation.
