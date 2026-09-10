# Van Finance Wix create schema audit

Date verified: 10 September 2026

Purpose: support the DealerKit semi-automated publishing path without guessing Wix CMS fields or copying legacy supplier content.

This audit was read-only. No Wix rows, media or site content were created, updated, deleted, published or unpublished while verifying the schema.

## Collections verified

The current Van Finance publishing structure uses these collections:

- `VANFINANCE-ALLVANS`
- `VANFINANCE-SMALLVANS`
- `VANFINANCE-MWB`
- `VANFINANCE-LWBVANS`
- `FINANCE-CREWVANS`
- `VANFINANCE-PICKUPS`
- `VANFINANCE-TIPPERSDROPSIDEL`
- `VANFINANCE-ELECTRIC`
- `AUTOMATIC`
- `VANFINANCEPAGES`

All ten are native CMS collections with the Wix publish plugin active. The main detail collection also exposes a collection-defined page link using `/van-finance/{title}`.

## Listing-card shape

The listing/category collections consistently expose the fields needed for a future DealerKit create path:

- `title` — registration, stored without spaces
- `picture` — primary IMAGE field
- `price` — retail price text
- `salePrice` — advertised monthly text
- `vat` — VAT display text
- `vanDescription` — short card title/description
- `vanSpec` — compact factual specification text
- `webLink` — vehicle detail URL
- `applyLink` — registration-specific finance application URL
- button field — normally `buttonText`; Small Vans uses `buttonName`
- `syncToCrm` — present on All Vans and currently used as `Yes`

Live rows confirm the standard link convention:

- detail: `https://www.vanfinancecompany.co.uk/van-finance/{REGISTRATION}`
- application: `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/{REGISTRATION}`

Live no-VAT listing rows use `N/A` in the `vat` field. Plus-VAT rows use `+VAT`.

## Main vehicle-page shape

`VANFINANCEPAGES` exposes the fields needed for the richer vehicle page:

- `title` — registration
- `titleText` — vehicle title
- `priceVat` — retail price plus VAT wording
- `year`
- `mileage`
- `mainImages` — MEDIA_GALLERY
- `descriptionLine`
- `vehicleDescriptionTextClick`
- `vehicleSpecificationText`
- `applyLink`
- `mthPrice`
- `imageCount`
- `addToRent2Buy` — BOOLEAN
- `isPickupOr4X4` — BOOLEAN
- grouped specification text fields: `audioAndCommunications`, `driversAssistance`, `exterior`, `illumination`, `interior`, `performance`, `safetyAndSecurity`

The collection-defined page-link field is generated from `title`; it is not part of the proposed create payload.

## Important legacy-data finding

A read-only sample showed several existing `VANFINANCEPAGES.applyLink` values pointing at a different vehicle registration. These are legacy-data inconsistencies and must not be copied into new DealerKit-created records.

The DealerKit create planner therefore proposes the canonical registration-specific Van Finance application path. Live creation remains locked, so this change does not alter existing Wix data.

## DealerKit create-preview rules

The first create planner is intentionally read-only. It may prepare factual text fields, links and the existing Van Finance 5% flat over 60 months monthly calculation, but it must not create a Wix row yet.

The following remain explicit prerequisites before new-record creation can be enabled:

1. Reviewed source images must be imported to Wix Media and mapped into `picture` / `mainImages`.
2. Original AI vehicle copy must be generated from verified DealerKit facts and then remain editable for human review.
3. Supplier advertising copy must never be copied into the VFC description.
4. Equipment must never be invented. Headline features can only come from DealerKit facts/specification data.
5. The fixed VFC reassurance block remains separate from AI vehicle copy.
6. DealerKit specification groups need a verified mapping before the grouped detail fields are written.
7. Any unsupported or unknown VAT display blocks creation rather than inventing wording.
8. Rent2Buy money logic remains separate and locked until its current live rules are re-verified in code.

## Fixed VFC reassurance content

This is VFC-owned standard content rather than DealerKit vehicle data:

- Over 200 vans in stock
- No admin fees
- All vehicles HPI checked
- Free nationwide delivery
- Click & Collect
- 6 month / 6,000 mile warranty
- 1 year AA breakdown cover
- Live market price check
- Service & PDI
- Minimum 8 months MOT
- Fully valeted

It must stay separate from the AI vehicle description so source-data changes do not rewrite standard VFC benefits.
