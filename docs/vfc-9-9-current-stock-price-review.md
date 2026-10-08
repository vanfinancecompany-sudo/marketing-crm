# VFC 9.9% APR: current-stock monthly-price review
*Snapshot taken 8 October 2026, UK time. READ-ONLY; no Wix, CRM, or other live prices changed.*

## Scope and source
The CSV at [vfc-current-stock-9-9-price-comparison-20261008.csv](vfc-current-stock-9-9-price-comparison-20261008.csv) contains **all 173 distinct current VFC sales listings** returned by the Wix API: **161 vans** from `VANFINANCE-ALLVANS` (162 published source rows, one duplicate registration) and **12 cars** from `CARFINANCE`.

Monthly figures are compared **against listing-field values only**. The previously completed detail-collection audit identified exceptions recorded below. The CSV stores the exact Wix listing record ID and update date for a later optimistic/concurrency-safe write; those IDs do *not* authorise a write without final review.

**Proposed formula**: a 9.9% *effective* annual APR compounded to a monthly rate, amortised over 60 months with no assumed product fees; displayed monthly payments are rounded **up** to whole pounds. VAT vans assume default VAT-equivalent upfront deposit (financing the ex-VAT price); non-VAT vans and VFC cars assume the full cash price financed (default deposit £0). The adjustable customer-facing calculator is separate and continues displaying pence.

## Results, using existing listing monthlies

| Type | Distinct current stock | Ready for controlled pricing step | Held for review |
| --- | ---: | ---: | ---: |
| VFC vans | 161 | 158 | 3 |
| VFC cars | 12 | 9 | 3 |
| **Total** | **173** | **167** | **6** |

Proposed monthly prices are higher for **160** van listings and lower for **one**. Compared with listing values, all **12** current cars would increase. The earlier car-detail audit found different old payments for JM10 ASM and other inconsistencies; this explains why a comparison based on **detail-page figures** can show different change directions. Do not conflate the two baselines.

## Six records held out

| Registration | Kind | Listing monthly | Proposed monthly (subject to reconciliation) | Existing discrepancy | Required review |
| --- | --- | ---: | ---: | --- | --- |
| **WGZ 8806** | Van | £219 | £221 | Detail record currently shows £307 | Verify correct listing/detail identity and payment data; update both together |
| **WM73 CXJ** | Van | £344 | £336 | Detail record currently shows £334 | Verify listing/detail values and retain current retail cash price |
| **YK23 ZYA** | Van | £361 | £364 | Two published listing records share this registration | Resolve the authoritative listing ID; never update an arbitrary duplicate |
| **JM10 ASM** | Car | £292 | £294 | Detail record currently shows £307 | Resolve the detail mismatch; then update both price fields consistently |
| **LM70 YPT** | Car | £344 | £347 *if £16,495 cash is correct* | Listing cash £16,495; detail cash £16,995 | Confirm authoritative cash price first. If £16,995 is correct, recalculate the new monthly amount; do not update the cash price automatically |
| **MT18 UFR** | Car | £459 | £462 *if £21,995 cash is correct* | Detail cash price is malformed as `£21.995`; listing cash is £21,995 | Correct/verify malformed detail record first, without changing actual retail price |

The six exceptions are quarantined in the CSV using `status=HOLD`. The CSV values are **proposals**, not permissions to publish them.

## Field mapping for later controlled writes

| Segment | Website listing source | Existing monthly field | Detail-page source | Detail monthly field |
| --- | --- | --- | --- | --- |
| Vans | `VANFINANCE-ALLVANS` | `salePrice` (fallback `from116Month`) | `VANFINANCEPAGES` | `mthPrice` |
| Cars | `CARFINANCE` | `salePrice` | `CARPAGES` | `salePrice` / `wk`, as verified per record |

Marketing CRM `facebook_adverts` is synchronised **from** Wix `VANFINANCE-ALLVANS`. Car advert records in `car_adverts` are not identical to the 12 current website listings: 29 active CRM car advertisements were observed, so do not update every active CRM car row using this preview.

## Release gates

1. Verify every source value remains unchanged at time of write. Refuse to update if record IDs, prices, VAT status, published status, or old monthly amounts drift from the captured audit.
2. Review the six holds separately. Verify each listing and current detail record by registration and exact Wix item ID. Never touch historical/stale vehicle details.
3. Prepare a write plan for the **167 ready** vehicles only; explicitly identify two target monthly fields per vehicle and existing values to update. Verify no stray category-listing monthly overrides will remain.
4. Require specific approval before executing any Wix data write or advertising feed sync. Preserve cash prices, images, existing application forms, gallery, stock availability, warranties, CMS relations and metadata.
5. After an approved write, requery affected items and the public pages, checking representative samples, car and van calculations, and CRM reimport. Reconcile failure per vehicle rather than marking the batch complete.
6. Retain full Rent2Buy isolation and do not change the separate Car Finance Company site.

## Development work status
- VFC calculator: merged and deployed live; no stock prices modified in that release.
- Marketing CRM pricing helper, tests and these audit files: [draft PR #628](https://github.com/vanfinancecompany-sudo/marketing-crm/pull/628), **not merged or deployed live**.
- This file is a report, not an execution instruction.
