# Marketing CRM Supabase Schema

## Scope

This schema extends the existing shared Supabase project without modifying existing CRM tables.

All new tables use the `marketing_` prefix.

## marketing_contacts

Permanent master marketing contact record.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `customer_id text unique not null`
- `first_name text not null default ''`
- `last_name text not null default ''`
- `company text not null default ''`
- `email text`
- `email_normalized text`
- `phone text`
- `phone_normalized text`
- `postcode text not null default ''`
- `pipeline text not null default 'unknown'`
- `source text not null default 'other'`
- `sources text[] not null default '{}'`
- `tags text[] not null default '{}'`
- `notes text not null default ''`
- `marketing_status text not null default 'active'`
- `email_ready boolean generated from normalized email logic in application`
- `sms_ready boolean generated from normalized phone logic in application`
- `facebook_ready boolean generated from email or phone readiness in application`
- `duplicate_count integer not null default 0`
- `first_seen_at timestamptz not null default now()`
- `last_seen_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Allowed pipelines:

- `finance`
- `rent2buy`
- `both`
- `unknown`

Allowed marketing statuses:

- `active`
- `unsubscribed`
- `suppressed`

Deduplication order:

1. Exact normalized email match.
2. Exact normalized phone match.
3. Possible duplicate review using name plus postcode.

## marketing_imports

One record per imported file or connected-source import.

Columns:

- `id uuid primary key`
- `filename text`
- `source text`
- `status text`
- `rows_imported integer`
- `contacts_created integer`
- `contacts_updated integer`
- `duplicates_merged integer`
- `possible_duplicates integer`
- `rejected_rows integer`
- `started_at timestamptz`
- `completed_at timestamptz`
- `created_at timestamptz`
- `metadata jsonb`

## marketing_import_rows

Optional import audit rows.

Columns:

- `id uuid primary key`
- `import_id uuid references marketing_imports(id) on delete cascade`
- `source_row integer`
- `customer_id text`
- `status text`
- `rejection_reason text`
- `raw_data jsonb`
- `created_at timestamptz`

Retention should be reviewed because raw import rows can grow quickly.

## marketing_merge_log

Permanent merge audit.

Columns:

- `id uuid primary key`
- `primary_contact_id uuid references marketing_contacts(id)`
- `merged_contact_id uuid`
- `merge_reason text`
- `matched_on text`
- `merged_snapshot jsonb`
- `created_at timestamptz`

## marketing_exports

One grouped record per export. Do not add export timeline rows to every contact.

Columns:

- `id uuid primary key`
- `export_type text`
- `audience_name text`
- `pipeline text`
- `filters jsonb`
- `contact_count integer`
- `filename text`
- `created_at timestamptz`
- `metadata jsonb`

## marketing_saved_audiences

Reusable segmentation definitions.

Columns:

- `id uuid primary key`
- `name text unique not null`
- `description text`
- `filters jsonb not null`
- `estimated_count integer`
- `created_at timestamptz`
- `updated_at timestamptz`

## Future tables

Not part of the first migration:

- `marketing_campaigns`
- `marketing_campaign_contacts`
- `marketing_events`
- `marketing_automation_rules`
- `marketing_automation_runs`
- `marketing_facebook_syncs`
- `marketing_google_match_syncs`

## Pagination and query rules

- Never load the complete contact table into the browser.
- Default page size is 50.
- Dashboard counts must use aggregate queries.
- Search and filters must execute in PostgreSQL/Supabase.
- Exports may use paged server-side retrieval or an Edge Function for very large audiences.

## Existing CRM integration

`manual_leads.pipeline` values map as follows:

- `vanFinance` -> `finance`
- `rent2buy` -> `rent2buy`

No foreign key to `manual_leads` is required in the first migration. A future `sales_lead_id` or mapping table may be introduced only after the live Wix/CRM flow is fully audited.
