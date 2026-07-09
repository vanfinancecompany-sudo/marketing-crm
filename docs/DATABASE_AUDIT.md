# Supabase Database Audit

## Purpose

This document records the current understanding of the shared Supabase project before the Marketing CRM adds new tables.

## Existing operational CRM tables

### manual_leads

Purpose:

- Live sales enquiries
- Wix-fed lead records
- Sales pipeline and stage
- Follow-ups
- Vehicle and finance information
- Sales notes

Known pipeline values include:

- `vanFinance`
- `rent2buy`

Decision:

- Keep as the operational Sales CRM lead table.
- Do not import the historical 31k marketing database into this table.
- Do not change its schema during Phase 4.
- Future integration may upsert matching contacts into `marketing_contacts`.

### activities

Purpose appears to be operational CRM activity history.

Decision:

- Do not modify during Phase 4.
- Marketing activity will use separate `marketing_events` or grouped campaign tables later.

### marketing_assets / marketing_creatives / marketing_posting_state

Purpose:

- Existing marketing media and posting workflows.

Decision:

- Reuse where applicable.
- Do not mix customer contact records into these tables.

### vehicle and stock tables

Examples include finance, Rent2Buy, cars, adverts, stock caches, and vehicle view tables.

Decision:

- Leave unchanged.
- These may later provide stock content to email/SMS campaigns.

## New Marketing CRM data boundary

The new customer database will use dedicated tables prefixed with `marketing_`.

Initial tables:

- `marketing_contacts`
- `marketing_imports`
- `marketing_import_rows`
- `marketing_merge_log`
- `marketing_exports`
- `marketing_saved_audiences`

## Core separation rule

`manual_leads` is for live sales workflow.

`marketing_contacts` is for the wider marketing contact database, segmentation, audiences, campaigns, exports, and automation.

The same person may have one record in each table because the records serve different operational purposes. Matching should use normalized email and phone, with an optional link field added later if required.

## Safety rules

- Do not alter existing CRM tables in Phase 4.
- Do not run destructive migrations.
- Do not drop columns, constraints, policies, or indexes from existing tables.
- New migrations must only create new `marketing_*` objects.
- Test all imports before switching the Customer Database away from localStorage.
