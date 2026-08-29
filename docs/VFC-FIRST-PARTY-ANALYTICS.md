# Van Finance Company first-party analytics

## Scope and cutover

Wix Analytics remains the authoritative source until an explicit production cutover is configured with `VFC_ANALYTICS_CUTOVER_DATE=YYYY-MM-DD`. If that variable is absent or invalid, the dashboard deliberately remains 100% on Wix Analytics.

Choose the cutover only after the first-party collector, database migration, consent path, and controlled production traffic have been verified. The configured date is interpreted as Europe/London midnight. A range crossing that boundary is split and compatible values are combined.

The API responses retain the existing dashboard fields and add `source`, `cutoverDate`, and per-period `segments`. While cutover is unconfigured, `cutoverDate` is `null` and the response notes that Wix remains authoritative. Cross-cutover visitor totals are explicitly described as additive approximations because Wix identities cannot be reconciled with anonymous first-party visitor IDs.

## Storage and ingestion

Migration `supabase/migrations/20260829190543_vfc_site_analytics.sql` creates:

- `site_analytics_sessions`: one anonymous session row with acquisition, device, page counters, and activity timestamps.
- `site_analytics_events`: an idempotent, allowlisted event stream linked to sessions.
- `ingest_site_analytics_event(...)`: an atomic, service-role-only RPC used by the server endpoint.

Both tables have RLS enabled. Direct access and RPC execution are revoked from `public`, `anon`, and `authenticated`; the browser never receives Supabase credentials. The Marketing CRM endpoint validates a small event schema, strips URL queries and fragments, retains only allowlisted metadata, applies an in-memory abuse limit, and permits only configured origins.

The endpoint also refreshes the existing `site_live_sessions` table and writes `vehicle_view` events to the existing `vehicle_views` table, preserving the live visitor and top-van widgets. These compatibility writes use only the already relied-on legacy fields (`session_id`, `last_seen_at`, and `registration`) and do not assume a legacy `source` column exists. Acquisition source is stored in the new first-party analytics tables.

## Metric definitions

- Session: activity using one random session ID, ending after 30 minutes of inactivity.
- Unique visitor: distinct random first-party visitor ID for the period.
- Page views: accepted `page_view` events.
- Bounce: a session with no more than one page view and no meaningful event.
- Average session duration: first activity to last activity, capped at 30 minutes per session.
- Pages per session: page views divided by sessions.
- Landing and exit page: the session's first and most recent paths.

First-party counts are not presented as exact parity with Wix's proprietary definitions.

## Event taxonomy

`session_start`, `session_activity`, `session_end`, `page_view`, `engagement`, `vehicle_view`, `finance_application_reached`, `finance_application_completed`, `rent2buy_postcode_gate_reached`, `rent2buy_postcode_pass`, `rent2buy_postcode_fail`, `rent2buy_full_application_opened`, `rent2buy_application_completed`, `part_exchange_started`, and `part_exchange_completed`.

No application answer or customer name, email, phone, address, postcode, finance data, or fingerprint is part of the analytics envelope. Vehicle registration is retained only for vehicle-view aggregation.

## Consent and browser behaviour

The site tracker is inert unless the existing `vfco_consent_v1` record has `marketing: true`. It uses versioned random IDs in local/session storage, sends non-blocking requests, catches transport failures, and records the initial view plus Next.js route changes. Acquisition values are captured once per session, with referrer query strings removed.

The base website branch contains `ConsentManager` but does not mount it globally. This change deliberately does not mount it because doing so could change existing Meta Pixel consent behaviour. Before production rollout, confirm how the live VFC consent choice sets `vfco_consent_v1`; otherwise new visitors will correctly remain untracked.

No automated retention deletion is introduced. Agree and document an anonymous analytics retention period before rollout, then add a separately reviewed cleanup policy if required.

## Required environment

Marketing CRM server:

- `SUPABASE_URL` (or existing `VITE_SUPABASE_URL`)
- `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY` (server only; no anon fallback for analytics)
- `WIX_API_KEY` and `WIX_SITE_ID` while any requested period includes historical Wix data
- Optional `VFC_ANALYTICS_ALLOWED_ORIGINS`, comma-separated, for reviewed preview origins; production VFC apex and `www` origins are allowed by default
- `VFC_ANALYTICS_CUTOVER_DATE=YYYY-MM-DD` only after controlled production verification. Leave it unset before activation so reporting safely stays on Wix.

VFC website browser build:

- `NEXT_PUBLIC_MARKETING_ANALYTICS_ENDPOINT`, for example the deployed Marketing CRM `/api/track-site-analytics` URL

## Manual activation order

1. Review the live Supabase schema and apply the migration using the project's normal migration process. It has not been applied by this branch.
2. Configure the Marketing CRM server-only Supabase key and reviewed CORS origins. Keep `VFC_ANALYTICS_CUTOVER_DATE` unset.
3. Deploy and verify the Marketing CRM ingestion endpoint and dashboard APIs. With cutover unset, dashboard reporting must remain on Wix.
4. Configure the VFC public collector URL, confirm the consent behaviour, then deploy the website tracker.
5. Send controlled consented traffic and verify the new Supabase tables, live visitor count, top viewed vans, explicit funnels, and dashboard first-party queries.
6. After first-party collection is confirmed healthy, choose a future Europe/London midnight and set `VFC_ANALYTICS_CUTOVER_DATE` to that date. Wix remains the source for all earlier dates.

No database migration, deployment, production route, Wix data, Meta configuration, SEO setting, or merge is performed by this work.
