# DealerKit source field map

Last updated: 10 September 2026

This is the Phase 1 field map for the Vansco → DealerKit migration. It records the DealerKit Integrator API fields that have been observed against the live Vansco dealer account and how they should enter the Marketing CRM before any Wix publishing work is added.

## Current integration state

- Authentication: Bearer token, held only in Vercel as `DEALERKIT_API_SECRET`.
- Dealer selection: `dealer_id`, held in Vercel as `DEALERKIT_DEALER_ID`.
- Stock list: `GET https://api.dealerkit.uk/integrators/stock`.
- Stock detail: `GET https://api.dealerkit.uk/integrators/stock/{id}`.
- The list endpoint supports `page`, `per_page` and optional specification flags.
- Full specification data is available from the detail endpoint and does not need to be pulled for every stock-list refresh.
- Observed live API total on 10 September 2026: 248 records.
- Two stock positions, 240 and 244 in the observed ordering, returned DealerKit HTTP 500 responses when isolated with `per_page=1`. The adapter therefore remains fail-closed and is not cutover-ready yet.
- Known validation vehicle `HT22 KJX` was successfully matched and read through the detail endpoint.

## DealerKit → normalized internal record

| DealerKit field | Normalized field | Purpose |
| --- | --- | --- |
| `id` | `supplierStockId` | Stable DealerKit stock identity. Use this for supplier-side record tracking. |
| `vehicle.registration` | `registration` | Primary cross-system adoption key after normalization. |
| `vehicle.manufacturer` | `make` | Vehicle display/search data. |
| `vehicle.model` | `model` | Vehicle display/search data. |
| `vehicle.derivative` | `derivative` | Full derivative/title detail. |
| `vehicle.trim` | `trim` | Trim display and review data. |
| `vehicle.body_type` | `bodyType` | Category suggestion input only. Human override remains allowed. |
| `vehicle.type` | `vehicleType` | LCV/Car source classification. |
| `status` | `sourceStatus` | Preserve DealerKit wording exactly for audit. |
| `status` | `status` / `availability` | Internal normalized status such as `available`, `reserved`, `due_in`, `awaiting_delivery`, `sold`, `non_stock`. |
| `prices.advertised.amount` | `retailPrice` | Supplier advertised retail price. This is the source price used for comparison/review. |
| `prices.advertised.vat_status` | `sourceVatStatus` | Preserve DealerKit VAT wording exactly. |
| `prices.advertised.vat_status` | `vatStatus` | Normalized VAT state such as `plus_vat`, `inc_vat`, `no_vat`, or `unknown`. |
| `prices.cash.amount` | `cashPrice` | Supplier cash/VAT-inclusive reference only. |
| `prices.cash.vat_amount` | `cashVatAmount` | Supplier VAT amount reference only. |
| `prices.monthly.amount` | `dealerMonthlyPrice` | Audit/reference only. **Never use as the Van Finance Company advertised monthly figure.** |
| `vehicle.mileage` | `mileage` | Vehicle display/review data. |
| `vehicle.year` / `vehicle.year_of_manufacture` | `year` | Vehicle display/review data. |
| `vehicle.registration_date` | `registrationDate` | Vehicle display/review data. |
| `vehicle.fuel_type` | `fuel` | Vehicle display and category suggestion input. |
| `vehicle.transmission_type` | `transmission` | Vehicle display and Automatic category suggestion input. |
| `vehicle.manufacturer_colour` / `vehicle.colour` | `colour` | Vehicle display/review data. |
| `vehicle.ulez_compliant` | `ulezCompliant` | Vehicle detail/review data. |
| `vehicle.bhp` | `bhp` | Vehicle detail data. |
| `vehicle.torque_nm` | `torqueNm` | Vehicle detail data. |
| `vehicle.mot_expiry` | `motExpiry` | Vehicle detail data. |
| `vehicle.insurance_group` | `insuranceGroup` | Vehicle detail data where useful. |
| `advertising.comments` | `description` | Supplier description/reference. VFC-owned standard reassurance text remains separate. |
| `advertising.attention_grabber` | `attentionGrabber` | Optional review/display source text. |
| `media.cover_image` + `media.images[]` | `primaryImage`, `images[]`, `imageCount` | Image review workflow. Stable source image IDs and URLs are retained. |
| `links.website` | `sourceUrl` | Supplier/public reference URL when present. |
| `vehicle.specifications.standard.items` | `specifications.standard` | Loaded on detail review, not required for every stock refresh. |
| `vehicle.specifications.options.items` | `specifications.options` | Loaded on detail review. |
| `vehicle.specifications.technical.items` | `specifications.technical` | Loaded on detail review. |
| `created_at` / `meta.created_at` | `sourceCreatedAt` | Supplier audit timestamp. |
| `updated_at` / `meta.updated_at` | `sourceUpdatedAt` / `checkedAt` | Change detection and freshness reference. |

## Known vehicle validation: HT22 KJX

The live DealerKit API returned the following values for the known test vehicle and they matched the DealerKit CRM reference used during inspection:

- Registration: `HT22KJX`
- Status: `In Stock`
- Type: `LCV`
- Make/model: Ford Transit Custom
- Derivative: 2.0 300 EcoBlue Limited Panel Van, L2 H1
- Mileage: 93,000
- Year: 2022
- Registration date: 2022-07-06
- Fuel: Diesel
- Transmission: Manual
- BHP: 128
- Torque: 361 Nm
- MOT expiry: 2027-07-10
- Insurance group: 39E
- Advertised price: £12,495
- Advertised VAT status: `ex-VAT`
- Images: 24, each observed with an ID and URL
- Detail specifications: 102 standard items, 1 option, 34 technical items

DealerKit also returned a monthly amount of £292.38. That value is intentionally retained only as `dealerMonthlyPrice` for reference. Van Finance Company monthly pricing continues to use the existing **5% flat per annum over 60 months** rule, rounded up to the next whole pound.

## Stock Control Centre use

The first Stock Control Centre integration should use DealerKit for source facts only:

- new/missing supplier stock detection
- source status changes
- supplier price/VAT changes
- image-count and gallery changes
- mileage/specification changes where useful
- registration-based adoption of existing Wix/CRM stock
- source image review using stable DealerKit image IDs

Do not automatically publish DealerKit data to Wix during this phase.

## Wix use later in the delivery plan

Existing Wix collection rules stay authoritative until the controlled publishing phase.

Van Finance mapping remains:

- Registration match: normalized DealerKit `registration` ↔ Wix `title`.
- Listing/category retail field: `price`.
- Listing/category monthly field: `salePrice`.
- Main detail retail field: `priceVat`.
- Main detail monthly field: `mthPrice`.
- VFC monthly amount: calculated internally from source retail price using 5% flat per annum over 60 months, rounded up.
- Existing Wix VAT wording such as `+VAT` / `NO VAT` must be preserved or deliberately mapped during review rather than overwritten blindly.
- DealerKit source images should be reviewed first, then approved images should ultimately be copied to Wix Media/CMS rather than stored permanently in Supabase.

Rent2Buy publishing remains a separate later step and its current live pricing/business rules must be re-read from production code before any DealerKit data is allowed to change money fields.

## Cutover guards

DealerKit must not become the authoritative Stock Watch provider until all of the following are true:

1. A full DealerKit stock snapshot is readable with no missing positions.
2. The API-reported total equals the number of usable mapped records.
3. Registration uniqueness/duplicate handling has been reviewed against real stock.
4. Status semantics have been checked against live Vansco operational behaviour.
5. A representative side-by-side sample has been compared with the existing Vansco/Dragon source.
6. Image URL durability has been observed over time or images are copied promptly to the permanent destination when approved.
7. The existing manual Wix fallback remains available during the transition.

The adapter deliberately throws on an incomplete authoritative snapshot. Partial snapshots may be used for diagnostics only.
