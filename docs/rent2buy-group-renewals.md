# Rent2Buy Facebook group renewals (every 7 days)

Rent2Buy only. No automated discovery, joining or Facebook publication.

- **Daily queue (07:00 UTC cron, `GET /api/rent2buy-group-renewals?run=1`):** once per London day (the `run_date` primary key blocks duplicate runs). It takes due Proven/Hot Rent2Buy groups using the CRM's own `groupPipeline` + `groupDueState` (the same as the Facebook Groups page), up to the CRM "max per day" setting (default 30). It runs only when enabled in the CRM and only in production.
- **Stale records never exclude a proven group.** Unresolved previous posts, membership, permission, unavailable or Red flags are shown as checks on the group. Clean groups are queued first.
- **Processing** uses the existing Facebook Groups page and helper: Prepare Next Post (existing stock rotation excludes sold, reserved and unavailable vans; existing image and caption), then manual confirmation in Facebook. A recorded submission resets the 7-day countdown (existing `lastPostedAt`).
- **Exceptions:** Skip or Needs attention per group (with a reason) in Conversations & AI, and "Stop today" for an account restriction or security challenge. Nothing retries automatically.
- **Reporting (Conversations & AI):** last run, next run, groups due, queued, processed, confirmed submissions (recorded posts only), accepted and awaiting approval (existing acceptance check), skipped/failed, needs attention, and 14-day history.
- **Authorised publishing:** Facebook offers no API for posting to groups as a member (the Groups API was withdrawn in 2024), so publication stays a manual confirmation in the existing helper. Do not automate it with browser clicks.
- **Deploy:** apply migration `202611251610_rent2buy_group_renewal_runs.sql`, deploy, then enable in Conversations & AI.
