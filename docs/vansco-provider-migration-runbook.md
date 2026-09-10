# Vansco Provider Migration Runbook

Last updated: 10 September 2026

## Purpose

This note exists so that the Vansco stock-feed migration can be picked up safely in a future ChatGPT/Codex session without relying on conversation history.

Vansco has now launched its replacement public website. DealerKit is the underlying dealer-management system. DealerKit API access has now been issued for Van Finance Company / Vansco Ltd.

Known non-secret integration detail:

- Vansco DealerKit dealer ID: `70376`
- Developer documentation: `https://developers.dealerkit.co.uk`
- A one-time-view API secret link was supplied on 10 September 2026. The secret itself must never be committed to GitHub, copied into this runbook, logged, or pasted into application code. It should be stored only in the secure deployment environment used by the primary Marketing CRM.

The DealerKit public Postman workspace is also discoverable as “DealerKit Integrator API”; use the official DealerKit documentation/API contract as authority when implementing.

## Firm delivery plan — do not redesign mid-build

This is the agreed delivery order and should be followed through to completion unless a genuine blocker, security/compliance issue, material cost issue, or DealerKit API limitation requires a change.

Do not interrupt the core migration to add attractive but nonessential features. Capture those ideas for later. Finish the working DealerKit → Stock Control Centre → Wix path first.

### Phase 1 — Receive and inspect the DealerKit API

Before changing production integration code:

1. Inventory available DealerKit endpoints and fields.
2. Confirm authentication method, pagination, rate limits and any webhook/change-event support.
3. Confirm stable vehicle/stock ID and registration fields.
4. Confirm stock status values and their meanings.
5. Confirm retail price and VAT representation.
6. Confirm image/media arrays, image ordering, image URL durability and any image IDs.
7. Confirm vehicle specification, description, mileage, year, transmission, fuel and body-type fields.
8. Test one known live vehicle and compare the API record with the DealerKit CRM and Vansco website.
9. Produce a field map: DealerKit field → normalized internal field → Stock Control Centre/Wix use.

Do not guess API fields or endpoint names before the API contract is visible.

### Phase 2 — Build the DealerKit source adapter

DealerKit becomes the supplier source of truth, but initially runs alongside the old Vansco/Dragon source.

Create a provider adapter that maps DealerKit records into a neutral vehicle shape. Preserve the existing Stock Watch comparison/workflow logic wherever possible.

Core normalized fields should include:

- registration
- stable supplier/DealerKit stock ID
- title / make / model / derivative
- retail price
- VAT status
- source stock status / availability
- primary image
- image array and/or image count
- public source URL when available
- mileage
- year / first registration date
- fuel
- transmission
- body type / vehicle category
- description
- specification/options
- last-updated timestamp where available

Supabase should store lightweight state, mappings, workflow decisions and history. Do not use Supabase as long-term vehicle image storage.

### Phase 3 — Connect DealerKit to the Stock Control Centre

The Stock Control Centre is the operating/review layer.

Wire the normalized DealerKit data into the existing Stock Control Centre shell while preserving current useful Stock Watch behaviours, including:

- Missing from my stock
- My stock not on supplier
- Reserved / sold / deposit-taken state
- Back in stock
- Hidden
- Never show again
- Advertised / awaiting refresh
- Van Finance price differences
- manual Update Wix Price
- New supplier photos ready / image-readiness alerts

Existing Wix and Marketing CRM vehicles should be adopted by normalized registration, not recreated as duplicates.

### Phase 4 — Build the human review workspace

Before automatic publishing, each incoming or changed vehicle should be reviewable.

The workspace should support:

- vehicle summary and source status
- source price and VAT
- source versus current Wix price where relevant
- image gallery
- include/exclude image decisions
- choose primary image
- later image reordering if useful
- Van Finance enabled by default where appropriate
- mandatory All Vans placement for Van Finance
- suggested editable Van Finance categories
- optional Send to Rent2Buy toggle
- separate Rent2Buy category decisions
- review status such as Needs Review → Ready → Published

DealerKit image decisions should persist by stable source image ID or a stable hash/reference so rejected source images do not reappear on every refresh.

### Phase 5 — Controlled Wix publishing

Build Wix publishing only after the DealerKit data and review workspace are proven.

Initial publishing remains semi-automatic and human-approved.

The system should prepare the intended Wix changes and let Stuart approve Publish / Update Wix.

For Van Finance, preserve the existing category/detail collection structure and existing pricing rule: 5% flat per annum over 60 months, with the advertised monthly figure rounded up to the next whole pound.

For Rent2Buy, use the existing live Rent2Buy pricing/business rules from current code. Re-verify those rules in code before implementing any money-related calculation.

Approved source images should ultimately live in Wix Media/CMS or another intentional permanent destination, not as permanent Supabase blobs. Temporary staging is acceptable only if automatically expired/deleted after transfer.

### Phase 6 — Parallel validation and cutover

Do not switch the source blindly.

Run DealerKit and the old source side-by-side long enough to compare a representative sample across:

- registration
- stable ID
- price
- VAT
- source status
- live/removed state
- image count
- primary/gallery images
- mileage/spec fields where used

Only make DealerKit the primary source once the comparison is satisfactory.

Keep manual Wix maintenance available as fallback during the transition.

### Phase 7 — Automation last

Automation is deliberately the final phase.

Do not automate high-impact publishing before the CRM/control-centre path is proven.

Once stable, automate low-risk repetitive detection first:

- new stock detected
- price changed
- reserved/sold/deposit-taken changes
- back in stock
- image-count/gallery changes
- specification changes
- stale-source warnings

Keep high-impact actions such as publishing a brand-new vehicle or materially changing a live advert approval-based until there is enough evidence to safely loosen that control.

If DealerKit provides reliable webhooks, prefer event-driven updates where practical. Otherwise use sensible refresh intervals. Do not poll every few minutes without a demonstrated need.

## Change-control rule

Until Phase 7 is complete, new feature ideas should normally be parked rather than inserted into the migration.

Change this architecture only when one of the following is true:

- DealerKit does not expose a required field or capability
- a security or compliance concern requires it
- a material running-cost issue is discovered
- production evidence shows the design is unreliable
- the proposed change clearly reduces risk or complexity without delaying the core path

Otherwise follow the plan in order: **API inspection → source adapter → Stock Control Centre → human review → Wix publishing → parallel validation/cutover → automation.**

## Current agreed position

The migration is primarily a **stock-feed / Stock Watch integration change**, not a whole-system migration.

The rest of the operating stack can continue if the Vansco live source is temporarily unavailable.

### Main CRM

The Main CRM is not dependent on live Vansco/Dragon page scraping for normal customer operations.

Finance lead vehicle enrichment is read from the internal Supabase `facebook_adverts` table. Existing leads, pipeline stages, finance approvals, quote emails, WhatsApp workflows and customer operations can continue even if Vansco is unavailable.

### Marketing CRM

Normal Marketing CRM vehicle operations use internal Supabase stock tables:

- Finance stock: `facebook_adverts`
- Rent2Buy stock: `rent_vehicles`

Stock, Reel Factory, Creative Library stock matching, Facebook posting queues, Reel Lab and YouTube queues should therefore continue to operate from stored stock.

### Vansco Stock Watch

This is the component most exposed to the provider change.

The current legacy integration assumes:

- `https://www.vansco.co.uk/all-stock/`
- Vansco sitemap discovery
- `/vehicle-details/` detail-page URLs
- the Dragon host `https://vansco.dragon2000.net`
- current HTML / metadata structure for registration, price, VAT, image and source status

These assumptions should be retired in favour of DealerKit API data once the new integration is validated.

## Current image-readiness requirement

Image readiness is now part of the required supplier-data contract.

The current workflow qualifies a vehicle only when:

- the registration is active in the relevant Finance or Rent2Buy stock source
- the matching main Wix CMS vehicle page currently has exactly 1 image
- the supplier/source now has at least 5 genuine vehicle images

The preferred DealerKit API shape is a full ordered image/media array with stable image IDs or URLs. An explicit image count is useful but not required if the full array is available, because the Marketing CRM can count it itself.

This signal must continue after migration because it tells the operator that a due-in/single-photo vehicle now has a proper gallery ready to add.

## Existing resilience

Stock Watch has a persistent Supabase cache in `vansco_vehicle_cache`.

If fresh URL discovery fails, the refresh worker can fall back to the last cached Vansco URL list and deliberately skips destructive stale marking.

If individual detail pages fail, the previous successfully cached vehicle data is retained while the failure is recorded.

This means a short Vansco outage does not wipe Stock Watch history.

## What is safe during a temporary outage

If the supplier feed is unavailable for roughly 24-48 hours:

- Continue using Main CRM normally.
- Continue using Marketing CRM normally.
- Continue using existing Finance and Rent2Buy stock already held in Supabase.
- Continue generating creatives/reels from stored stock.
- Continue normal customer follow-up and finance workflows.
- Treat Stock Watch supplier data as stale until the new source is connected.

Do **not** rely on stale Stock Watch data for:

- newly added supplier vehicles
- fresh price changes
- newly reserved/sold/deposit-taken status
- removals from supplier stock
- image-readiness changes

## Manual stock fallback

If the supplier/API feed is unavailable for more than a short period, stock can still be maintained manually in Wix.

That is an acceptable temporary operating mode. Manual Wix updates should be treated as the source of truth until the structured stock feed is restored.

Do not block sales/marketing operations merely because Stock Watch is stale.

## Existing price-update functionality

The Marketing CRM Stock Watch `Update Wix Price` workflow should be preserved.

The Wix-write side is conceptually independent from the supplier source. Adapt the source/normalisation side and keep the existing Wix update workflow wherever possible.

## Instruction for future AI/developer sessions

Read this file before changing the DealerKit/Vansco integration.

Treat the **Firm delivery plan** above as the approved architecture. Do not redesign it mid-build for optional features. Complete the core migration path first and park nonessential ideas for a later enhancement phase.

Assume the business can continue operating unless evidence shows an internal CRM/Supabase failure. Focus on connecting DealerKit as a structured supplier source while preserving existing cached data, Stock Watch decisions, image-readiness logic and downstream Wix workflows.
