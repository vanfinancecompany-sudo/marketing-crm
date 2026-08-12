# Vansco Provider Migration Runbook

Last updated: 12 August 2026

## Purpose

This note exists so that the Vansco stock-feed migration can be picked up safely in a future ChatGPT/Codex session without relying on conversation history.

Vansco is expected to move away from its current Dragon2000-backed website/stock setup to a new supplier. The exact replacement provider and feed structure may not be known until close to switch-over.

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

The current Vansco integration assumes:

- `https://www.vansco.co.uk/all-stock/`
- Vansco sitemap discovery
- `/vehicle-details/` detail-page URLs
- the Dragon host `https://vansco.dragon2000.net`
- current HTML / metadata structure for registration, price, VAT, image and source status

These assumptions will probably need replacing after the new provider goes live.

## Existing resilience

Stock Watch has a persistent Supabase cache in `vansco_vehicle_cache`.

If fresh URL discovery fails, the refresh worker can fall back to the last cached Vansco URL list and deliberately skips destructive stale marking.

If individual detail pages fail, the previous successfully cached vehicle data is retained while the failure is recorded.

This means a short Vansco outage does not wipe Stock Watch history.

## What is safe during a temporary outage

If Vansco is unavailable for roughly 24-48 hours:

- Continue using Main CRM normally.
- Continue using Marketing CRM normally.
- Continue using existing Finance and Rent2Buy stock already held in Supabase.
- Continue generating creatives/reels from stored stock.
- Continue normal customer follow-up and finance workflows.
- Treat Vansco Stock Watch as stale until the new source is connected.

Do **not** rely on Stock Watch during the outage for:

- newly added Vansco vehicles
- fresh price changes
- newly reserved/sold/deposit-taken status
- removals from Vansco

## Manual stock fallback

If the Vansco/new-provider feed is unavailable for more than a short period, stock can still be maintained manually in Wix.

That is an acceptable temporary operating mode. Manual Wix updates should be treated as the source of truth until the structured stock feed is restored.

Do not block sales/marketing operations merely because Stock Watch is stale.

## Preferred future integration

The preferred replacement is a **direct structured API/feed from the new supplier** rather than scraping HTML pages.

Ideal fields:

- registration
- stable supplier stock ID
- title / make / model / derivative
- retail price
- VAT status
- availability/status
- image URL(s)
- public stock URL
- mileage
- year
- body type / vehicle category
- last updated timestamp if available

The new supplier source should map into a neutral internal vehicle contract, then feed the existing Stock Watch logic.

Target architecture:

`New supplier API/feed -> source adapter -> normalised vehicle record -> existing Stock Watch comparison/workflow`

Do not rewrite the comparison, hidden/never-show, price discrepancy or Wix update logic unless the new source genuinely requires it.

## Switch-day procedure

When Vansco changes provider:

1. Do not panic or disable the rest of the CRM stack.
2. Confirm Main CRM and Marketing CRM internal stock tables are still available.
3. Treat the last Vansco cache as historical/stale until verified.
4. Obtain the new supplier API documentation, feed URL, credentials, staging URL or live stock endpoint if available.
5. Prefer a direct API/feed over scraping the replacement website.
6. Identify the new unique stock ID and registration field.
7. Map new provider fields into the neutral Stock Watch vehicle contract.
8. Test discovery and detail/status/price updates without changing production Wix stock first.
9. Compare a sample of vehicles manually against the new Vansco website/provider data.
10. Only re-enable/declare live Stock Watch current once registrations, price, VAT, status and removals are verified.
11. Keep manual Wix stock maintenance available as fallback until the feed has been stable for at least a full business cycle.

## Existing price-update functionality

The Marketing CRM Stock Watch `Update Wix Price` workflow should be preserved.

The Wix-write side is conceptually independent from the Vansco source. If the new supplier provides a different stock feed, adapt the source/normalisation side and keep the existing Wix update workflow wherever possible.

## Known timing issue to revisit before migration

The Marketing CRM Vercel cron currently calls the Vansco refresh at `0 2 * * *` (UTC), while the refresh worker checks named `Europe/London` start windows including `02:00`.

During BST this can produce a mismatch because 02:00 UTC is 03:00 London.

This is pre-existing and not caused by the provider migration, but should be corrected as part of migration-readiness hardening.

## Recommended pre-migration hardening

Before switch-over, consider a small focused change that:

- fixes/clarifies the BST-aware refresh scheduling
- displays `Vansco data last successfully refreshed ...` prominently in Stock Watch
- labels stale data clearly if the source has not refreshed successfully within an agreed threshold
- isolates Vansco source-specific code behind a supplier/source adapter

Do not invent the new provider integration before the provider/feed is known.

## Instruction for future AI/developer sessions

If a future session is opened because Vansco has started the migration, read this file first before changing code.

Assume the business can continue operating unless evidence shows an internal CRM/Supabase failure. Focus first on reconnecting Stock Watch to the replacement stock source, preferably via a structured API/feed, while preserving existing cached data and the current downstream comparison/Wix-update workflows.
