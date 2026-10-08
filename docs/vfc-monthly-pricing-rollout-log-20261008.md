# VFC 9.9% APR monthly-price rollout log
**Execution date:** 8 October 2026 (UK time). **Status:** Wix and direct CRM reconciliation completed for all eligible, source-verified stock. This log supersedes the read-only status in the earlier, dated pre-change audit documents.

## Approved price policy
Effective APR 9.9%, 60-month Hire Purchase. Monthly listing price rounded **up** to the next whole pound. For vans marked +VAT, illustration defaults to an upfront VAT-equivalent deposit; for non-VAT vans and VFC cars, default deposit is £0. Cars have no added VAT charge. No loan fees or balloon payments were invented.

## Wix stock result
- Source: VANFINANCE-ALLVANS, VANFINANCEPAGES, CARFINANCE and CARPAGES on VFC site ID 85f11c52-ee54-495d-aaec-a351831709b5.
- **173 distinct current-stock vehicles** (161 vans, 12 cars).
- **163 vehicles repriced:** **155 vans, eight cars**. Changes were limited to each live listing's monthly field and its corresponding current detail-page monthly field. Retail cash prices, VAT labels, photographs, specifications, registration, stock status, application URLs and warranty information were not patched.
- **10 vehicles held, unchanged**. The original six from the read-only audit: WGZ8806, WM73CXJ, YK23ZYA, JM10ASM, LM70YPT and MT18UFR. Four further source discrepancies found during conditional preflight: PE71YTG (current CARPAGES missing expected monthly field), FL19OFN, FL71GZW and SF70TNO (VAT discrepancy between live van listing and detail record). Do not touch these pending separate audit.
- Every write used an exact Wix item ID, live duplicate/publish/cash/VAT checks, the original monthly value and a conditional partial PATCH. Source drift caused a hold, not a forced overwrite.
- The five-vehicle pilot passed independently; every other batch underwent a standalone readback.
- **Final reconciliation: 336 source-record checks, 336 passed.** That is 326 listing/detail checks for 163 updated vehicles plus 10 listing checks that the held registrations retained their original monthly prices.
- Original CSV (with old monthly figures and proposed values): [vfc-current-stock-9-9-price-comparison-20261008.csv](vfc-current-stock-9-9-price-comparison-20261008.csv). **It is a BEFORE-state audit snapshot, not a post-write stock export.**

## Marketing CRM result
- `public.facebook_adverts`: **155 current van adverts** updated by a single guarded SQL statement which required all 155 distinct registrations, preserved the original retail price (allowing harmless leading/trailing spaces), VAT classification and original monthly amount. Final readback: **155/155 match** the post-write VFC monthlies.
- `public.car_adverts`: **four** eligible existing adverts updated by a guarded statement; final readback: **4/4 match**.
- Four other website-repriced cars **not changed in car_adverts**: HK72DFJ (VFC cash £13,750 vs CRM £13,995), HN69VZB (VFC cash £12,799 vs CRM £12,795), RX73JBV (VFC cash £11,999 vs CRM £12,295), YH25XCC (BMW i7 is absent from the CRM car advert table). These need source-reconciliation, not forced monthly replacement or blind car creation.
- The existing hourly Finance stock sync reads from Wix and should preserve the new van monthlies. The normal sync endpoint could not be reached for immediate manual invocation, so exact, transactionally guarded CRM monthly-only updates were applied directly and verified. **No automated external CarsLink publication was triggered.**
- Rent2Buy and the separate Car Finance Company website: **not modified**.

## What remains for a separate change
1. Resolve all ten held Wix vehicles only when authorised, matching historical and current detail/listing sources and VAT classification.
2. Resolve the four car advert-source mismatches; decide whether missing BMW i7 should be imported into the CRM car advertising lane.
3. Wire the preview-only 9.9% pricing helper into **future new-stock creation/editing paths** with rigorous tests. Do not claim this is automated yet: the current prices have been synchronised once, but draft PR #628 is deliberately not merged and the price-generating stock writer may still need updating.
4. Verify public customer-facing pages visually after cache expiry. Backing Wix CMS records were checked, but a full browser rendering was not independently available via the connector.
5. Do not use the original CSV for a blind rerun: it stores pre-change old values. Any subsequent migration requires a fresh source audit.
