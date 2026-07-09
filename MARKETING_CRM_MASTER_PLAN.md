# Marketing CRM Master Plan

## Purpose

This document is the working blueprint for the Van Finance Company standalone Marketing CRM.

The goal is not to build another general CRM. The goal is to build a dedicated marketing operating system for Van Finance Company that connects customer data, vehicle stock, audiences, campaigns, content, reporting, and automation from one clean source of truth.

## Business Context

Business: Van Finance Company

Main products:

- Finance
- Rent2Buy

Important product differences:

- Finance can be national.
- Rent2Buy is a separate pipeline and should not be mixed into Finance.
- Existing legacy data includes old applications, with a mixture of Finance and Rent2Buy contacts.
- Clean pipeline separation is critical before migrating to Supabase.

## Current CRM Areas

The Marketing CRM already includes or is planned to include:

- Dashboard
- Stock
- Vansco Stock Watch
- Reel Lab
- YouTube Generator
- Creative Library
- Image Suite
- Documents Hub
- Van Finance Facebook
- Rent2Buy Facebook
- Facebook Marketplace
- Customer Database

## Core Principle

The Customer Database becomes the heart of the marketing platform.

All future marketing tools should feed from one clean customer database rather than creating separate CSV-based systems.

CSV files, Wix contacts, CRM leads, form submissions, Facebook leads, and future imports are sources. They are not the database.

## Sales CRM vs Marketing CRM

The existing sales CRM should focus on:

- Vehicles
- Applications
- Deals
- Customers
- Documents
- Sales workflow

The Marketing CRM should focus on:

- Customer Database
- Segmentation
- Facebook audiences
- Google Customer Match
- Email campaigns
- SMS campaigns
- Marketing analytics
- Automation
- Content and creative workflows

The two systems should connect, but they should not become the same app.

## Version 3 Customer Database Goals

Before Supabase, Customer Database V3 should remain browser-based but optimised for large datasets.

Requirements:

- Import 30,000+ contacts without rendering thousands of rows.
- Maximum 50 visible rows per page.
- Dashboard totals calculate from all contacts.
- Search scans all contacts.
- Filters apply to all contacts.
- Exports include all relevant contacts, not just the visible page.
- Bulk actions apply only to selected contacts.
- Contact records are compact.
- Timelines are limited to key events only.
- Timeline maximum is 20 events per contact.
- Rejected rows are capped at 500.
- Duplicate report rows are capped at 500.
- Possible duplicate rows are capped at 500.
- Export history must not be written onto every contact.
- If localStorage fails, contacts must remain in React state until refresh.

Required localStorage warning:

> Browser storage limit reached.
> Contacts remain available until refresh.
> Supabase storage is recommended for permanent storage.

## Pipeline Rules

Customer pipeline values:

- finance
- rent2buy
- both
- unknown

Legacy import strategy:

1. Extract known Rent2Buy applications.
2. Feed those contacts into the Rent2Buy pipeline.
3. Remove those Rent2Buy contacts from the old 30k Finance master list where matched.
4. Treat remaining old application contacts as Finance unless better evidence says otherwise.
5. Preserve deduplication across Finance and Rent2Buy.

## Export Rules

Do not change existing export formats unless explicitly requested.

Facebook export headers must remain exactly:

```text
email
phone
fn
ln
zip
country
```

Country must be:

```text
GB
```

Grouped exports should continue to support:

- Facebook full audience
- Facebook Finance
- Facebook Rent2Buy
- Email full
- Email Finance
- Email Rent2Buy
- SMS full
- SMS Finance
- SMS Rent2Buy
- Master Database
- Duplicate Report
- Rejected Rows

## Phase 4: Supabase Migration

Supabase is the next major phase after Customer Database V3 is stable.

Do not start Supabase changes inside the V3 optimisation work unless explicitly requested.

Supabase should become the permanent database for customer records and marketing events.

Planned initial tables:

```text
marketing_contacts
contact_imports
contact_import_rows
contact_merge_log
contact_exports
```

Likely later tables:

```text
saved_audiences
email_campaigns
email_campaign_recipients
sms_campaigns
sms_campaign_recipients
facebook_audience_syncs
google_customer_match_syncs
customer_events
automation_rules
automation_runs
marketing_reports
```

## Suggested Supabase Table: marketing_contacts

Core fields:

```text
id uuid primary key
customer_id text unique
first_name text
last_name text
company text
email text
phone text
postcode text
pipeline text
source text
sources text[]
tags text[]
notes text
created_at timestamptz
updated_at timestamptz
first_seen_at timestamptz
last_seen_at timestamptz
duplicate_count integer
```

Recommended indexes:

```text
email
phone
pipeline
postcode
tags
updated_at
```

## Suggested Supabase Table: contact_imports

```text
id uuid primary key
filename text
source text
imported_at timestamptz
rows_imported integer
contacts_created integer
contacts_updated integer
duplicates_merged integer
possible_duplicates integer
rejected_rows integer
status text
```

## Suggested Supabase Table: contact_import_rows

Purpose: optional audit/history table for imports.

This table can become large, so avoid storing unnecessary raw data forever.

```text
id uuid primary key
import_id uuid references contact_imports(id)
row_number integer
customer_id text
pipeline text
status text
rejection_reason text
raw_data jsonb
created_at timestamptz
```

## Suggested Supabase Table: contact_merge_log

```text
id uuid primary key
primary_customer_id text
merged_customer_id text
merge_reason text
matched_on text
merged_at timestamptz
merged_data jsonb
```

## Suggested Supabase Table: contact_exports

```text
id uuid primary key
export_type text
audience_name text
pipeline text
filters jsonb
contact_count integer
created_at timestamptz
created_by text
```

Do not write export events onto every contact record. Store export history as grouped export events.

## Data Flow Target

```text
Wix Forms
CRM Leads
Facebook Leads
CSV Imports
Manual Adds
    ↓
Supabase
    ↓
Customer Database
    ↓
Audience Builder
    ↓
Email / SMS / Facebook / Google / Reports / Automation
```

## Audience Builder

After Supabase, the next major marketing feature should be Audience Builder.

It should allow saved segments such as:

- Finance + Email Ready
- Finance + SMS Ready
- Rent2Buy + Facebook Ready
- Unknown pipeline contacts
- No mobile number
- No email address
- Postcode/area based audiences
- Recently imported contacts
- Dormant contacts

Saved audiences should feed:

- CSV exports
- Facebook Custom Audiences
- Google Customer Match
- Email Campaign Centre
- SMS Campaign Centre
- Reports

## Email Campaign Centre

Do not build until Customer Database and Supabase are stable.

Future features:

- Select saved audience
- Compose email
- Add stock blocks
- Add vehicle links
- Preview
- Send test
- Send campaign
- Track sends, opens, clicks, bounces, unsubscribes

## SMS Campaign Centre

Do not build until Customer Database and Supabase are stable.

Future features:

- Select saved audience
- Compose SMS
- Count characters
- Preview recipients
- Send campaign
- Track sends, failures, replies where available

## Facebook API Phase

Future goal:

- Replace manual CSV uploads with direct Custom Audience sync.
- Keep Finance and Rent2Buy audiences separate.
- Sync from saved audiences.
- Record grouped sync history.

## Google Customer Match Phase

Future goal:

- Export or sync Google Customer Match audiences.
- Use the same saved audience logic as Facebook.

## Reporting Phase

Marketing dashboard should eventually show:

- Total contacts
- Finance contacts
- Rent2Buy contacts
- Email ready
- SMS ready
- Facebook ready
- Unknown pipeline
- New contacts this week/month
- Imports by source
- Duplicate merges
- Audience sizes
- Campaign performance
- Application/revenue attribution where possible

## Automation Phase

Future automations could include:

- New stock alert to matching audience
- Weekly stock email
- Dormant lead reactivation
- Approved finance follow-up
- Rent2Buy follow-up
- Missing info reminders
- Campaign performance summaries

## Development Rules

For future Codex or assistant work:

- Do not start from scratch.
- Do not redesign the CRM unless explicitly asked.
- Keep navigation consistent.
- Work on feature branches.
- Do not merge into main unless explicitly approved.
- Preserve existing export formats.
- Keep Finance and Rent2Buy separate unless the contact genuinely belongs to both.
- Run build checks before reporting completion.
- Return files changed, branch name, build result, manual testing needed, and limitations.

## Immediate Roadmap

1. Finish Customer Database V3 browser optimisation.
2. Validate real 30k+ Finance/Rent2Buy dataset.
3. Freeze V3.
4. Start Supabase migration on a separate branch, suggested name:

```text
feature/customer-database-supabase
```

5. Migrate master Finance and Rent2Buy contacts into Supabase.
6. Build Customer Database read/write from Supabase.
7. Add Audience Builder.
8. Add campaign tools only after the database layer is stable.
