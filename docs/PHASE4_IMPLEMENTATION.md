# Phase 4 Supabase Implementation Plan

## Goal

Move Customer Database from browser/localStorage storage to permanent Supabase storage while keeping the existing UI and navigation.

## Branch

`feature/customer-database-supabase`

Do not merge into `main` until migration and live preview testing are approved.

## Stage 1: Schema preparation

- Review migrations in `supabase/migrations`.
- Confirm they only create new `marketing_*` tables, indexes, triggers, and policies.
- Run migrations in Supabase SQL Editor only after explicit approval.
- Verify no existing CRM tables changed.

## Stage 2: Service layer

Create a focused customer data service responsible for:

- Server-side pagination at 50 rows.
- Aggregate dashboard totals.
- Search across name, email, phone, postcode, and company.
- Pipeline/source/tag/readiness filters.
- Contact create, edit, and delete.
- Import upsert and deduplication.
- Full-scope exports.

The page component should not contain raw Supabase query construction once the service layer exists.

## Stage 3: Safe master import

Import files:

- Finance master -> `finance`
- Rent2Buy master -> `rent2buy`

Rules:

- Normalize email and UK mobile before matching.
- Match email first, then phone.
- Merge pipeline to `both` when evidence supports both.
- Do not create duplicate records across the two files.
- Create one `marketing_imports` record per file.
- Use import-row logging only for rejected or exceptional rows unless a full audit is explicitly required.

## Stage 4: Customer Database switch

- Keep current design.
- Replace localStorage reads/writes with Supabase service calls.
- Keep 50 rows per page.
- Dashboard totals come from count queries.
- Search and filters execute remotely.
- Exports retrieve all contacts in scope, not only the visible page.
- Bulk actions apply only to selected contacts.

## Stage 5: Verification

Required checks:

- Finance and Rent2Buy totals match approved master files.
- No contacts disappear after refresh.
- Search finds contacts beyond page one.
- Filter counts are correct.
- Facebook export headers remain `email,phone,fn,ln,zip,country` and country remains `GB`.
- Email, SMS, Master, Duplicate, and Rejected exports remain correct.
- Existing CRM pages and Wix-fed `manual_leads` continue working.

## Rollback

Phase 4 is additive.

Rollback method:

1. Do not merge the feature branch.
2. Keep the existing localStorage Customer Database implementation available during testing.
3. If Supabase integration fails, redeploy the prior stable Customer Database branch.
4. New `marketing_*` tables can remain unused; do not drop them while investigating.

No rollback should require changing existing operational CRM tables.

## Stop point

Stop after Customer Database is stable on Supabase.

Do not begin Email Campaigns, SMS Campaigns, Facebook API integration, Google Customer Match, or automation until separately requested.
