# Rent2Buy flexible pricing rollout

**Status: development only. All four PRs remain draft/unmerged. No live Wix, CRM, stock-feed, image, cron or production database changes have been made.**

## Final scope

There are only two Rent2Buy pricing paths:

### 1. Normal Rent2Buy vehicles → Felix matrix

Use the existing reviewed DealerKit vehicle:
- retail price
- registration year
- current mileage

Customer can select:
- contract term
- contractual monthly mileage allowance
- initial rental from the matrix ladder

The server calculates and signs the resulting quote. The browser never calculates or supplies an authoritative price.

### 2. Four legacy specials → fixed deal

These four registrations are completely outside the customisable Felix matrix:

| Registration | Monthly + VAT | Initial + VAT | Term | Contract mileage |
|---|---:|---:|---:|---|
| BT25 LVK | £595 | £2,000 | 48 months | Not used / not customisable |
| FV74 BBJ | **£545** | £2,000 | **48 months** | Not used / not customisable |
| FV74 BEO | £595 | £2,000 | 48 months | Not used / not customisable |
| BJ74 HTL | **£595** | **£2,000** | **48 months** | Not used / not customisable |

Confirmed corrections:
- FV74 BBJ: the old 36-month detail value is wrong. 48 months is authoritative.
- BJ74 HTL: the old detail £693 / £2,079 values are wrong. £595 / £2,000 / 48 months is authoritative.
- The earlier verbal 40-month reference for BJ74 HTL was immediately corrected; 48 months is authoritative.

The four fixed registrations:
- never show the Customise your rental drawer;
- cannot enter the signed matrix quote service;
- cannot be converted to a generic special-deal draft;
- are protected from normal Rent2Buy Wix price sync;
- are displayed from a server-owned fixed map if Wix detail values disagree;
- require no contractual mileage setting;
- continue through the ordinary Rent2Buy application with fixed terms derived by Main CRM from registration.

There is **no generic special-deal database/editor in this project**. Future promotions can be designed separately if ever needed.

## Felix matrix

Implemented in `lib/rent2BuyFlexiblePricing.mjs`.

Ex-VAT formula:

`monthlyRaw = Retail/T + Retail*0.25/12 + (milesPerMonth-3000)*0.05 - ((initialRental-minInitial)*1.5/T)`

Monthly rental rounds **up to the next £5**.

Rules:
- minimum initial rental £1,000 + VAT;
- initial ladder: 1x, 1.5x, 2x, 2.5x minimum, rounded nearest £10;
- terms: 12, 18, 24, 30, 36, 42, 48;
- vehicle eligible up to 48 months when age is within four years and odometer <=50,000; otherwise up to 36;
- 1,000–2,000 miles/month: up to 48 months;
- 2,500–3,000: up to 36;
- 3,500: up to 30;
- 4,000: up to 24;
- default: longest eligible term + 1,000 miles/month + minimum initial.

Reference calculations remain covered by automated tests.

## Existing stock/images remain untouched

This feature does not replace or modify:
- DealerKit stock ingestion;
- vehicle images/galleries;
- Stock Watch;
- the existing 15-minute stock monitor;
- Wix stock publication outside the four fixed-price protection guards;
- Finance or Cars pricing.

The earlier experimental stock snapshot/90-second cache/readiness work was removed from the branch.

## Marketing CRM PR #689

Contains only:
- Felix matrix;
- fixed four-registration protection;
- Price Differences protection for those four;
- controlled Rent2Buy publisher protection for those four;
- server-side matrix selector choices;
- private preview quote endpoint;
- HMAC-signed matrix quote;
- server-side matrix quote revalidation against reviewed DealerKit retail/year/mileage;
- internal email rendering for matrix quote and fixed legacy deal;
- read-only Wix reconciliation of the four fixed deals;
- focused Rent2Buy tests.

No generic special-deal table/editor remains.

## Websites: PR #51 and PR #165

Normal matrix vehicles:
- compact Customise your rental trigger beneath existing price cards;
- drawer/mobile sheet;
- term, contractual mileage and initial-rental selectors;
- pricing requested from server;
- no browser Felix calculation;
- signed token added to application URL only after server quote;
- changing a selection clears the previous token.

Four fixed vehicles:
- fixed public monthly/initial/48-month display;
- no customisation drawer;
- application displays the fixed deal;
- any old/custom quote token in the URL is ignored.

Existing vehicle galleries, stock data, advertised cards and normal Apply Now flow remain intact.

## Main CRM PR #151

Normal matrix:
- verifies signed token;
- independently calls Marketing CRM pricing verifier;
- verifies registration, source revision, term, contractual mileage, monthly and initial rental;
- stores exact selected matrix terms in lead notes;
- passes verified matrix deal to internal email.

Four fixed vehicles:
- derives fixed deal from registration server-side;
- deletes/ignores any browser-supplied fixed-price object;
- rejects a customised matrix token for a fixed registration;
- stores fixed monthly / initial / 48-month terms in lead notes;
- no contractual mileage field is created;
- applicant's separate intended-use mileage remains unchanged.

## Important distinction

The application question **"How many miles will you do per month?"** remains the customer's usage estimate.

For matrix vehicles, **contractual mileage allowance** is a separate selected quote field.

For the four fixed legacy deals, there is no contractual mileage selector/value in this implementation.

## Remaining before merge

1. Let all four focused CI/build suites finish green.
2. Enable the calculator/quote flags only on protected preview deployments.
3. Visual check desktop/mobile for normal matrix vehicle pages.
4. Preview E2E tests:
   - default matrix quote;
   - changed term;
   - changed contractual mileage;
   - changed initial rental;
   - invalid term/mileage combinations;
   - tampered/expired token rejection;
   - selected matrix quote on application review;
   - selected matrix quote in Main CRM notes;
   - selected matrix quote in internal email;
   - normal legacy registration-only application unchanged.
5. Fixed-special E2E checks:
   - BT25 LVK £595 / £2,000 / 48;
   - FV74 BBJ £545 / £2,000 / 48;
   - FV74 BEO £595 / £2,000 / 48;
   - BJ74 HTL £595 / £2,000 / 48;
   - no calculator on any of the four;
   - BBJ never shows 36 months;
   - BJ74 HTL never shows £693 / £2,079.
6. Only then prepare merge/deployment order.

## Draft PRs

- Marketing CRM #689
- Main CRM #151
- Standalone Rent2Buy #51
- VFC Rent2Buy #165

All remain unmerged.
