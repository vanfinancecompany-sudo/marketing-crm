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
- `lifecycle_status text not null default 'active'`
- `lifecycle_changed_at timestamptz`
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

Allowed lifecycle statuses:

- `active`
- `awaiting_verification`
- `archived`
- `suppressed`

Only `active` contacts are shown in the normal Customer Database and included in active or campaign-audience totals. The protected clear workflow changes `active` to `awaiting_verification`; it does not delete the contact or change either customer identifier.

Import restore and deduplication order:

1. Exact normalized email match.
2. Supplied existing `customer_id` match.
3. Exact normalized phone match.
4. Possible duplicate review using name plus postcode.

An exact match updates the existing row in place, so `marketing_contacts.id`, `customer_id`, and all foreign-key and campaign-recipient history remain intact. An inactive match is restored to `active`. A CSV classification changes `pipeline` only when the file explicitly supplies that field.

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
- `restored_customers integer`
- `duplicates_merged integer`
- `possible_duplicates integer`
- `suppressed_emails integer`
- `invalid_emails integer`
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

## marketing_suppression_identities

Permanent email-level campaign suppression. This table is deliberately separate from the customer card JSON so an archived or recreated workflow cannot erase the suppressed identity.

Important relationships:

- `contact_id uuid references marketing_contacts(id) on delete set null`
- `campaign_id uuid references marketing_campaigns(id) on delete set null`
- `email_normalized text unique not null`

Inserting or updating an identity immediately moves every matching contact to lifecycle `suppressed`. A database trigger rejects any attempt to activate a matching normalized email. Provider webhooks and the Suppression Centre continue to call `marketing_apply_suppression`; that RPC now maintains both the existing contact suppression JSON/history and this permanent identity.

## marketing_database_clear_audit

Audit and concurrency guard for the protected clear workflow. A prepared operation records the current lifecycle and safety-export counts, expires after 30 minutes, and can be completed only with the exact confirmation phrase. Completion locks contact writes, verifies that the active count is unchanged, and moves active contacts to `awaiting_verification`.

Migration `013_customer_database_cleanse_workflow.sql` is intentionally forward-only. Apply it with the normal transactional Supabase migration runner (or inside an explicit transaction if applying manually), so any statement failure rolls back the migration as a unit. Do not roll it back by dropping lifecycle or suppression data: that could discard the permanent identity required to keep bounced and unsubscribed email addresses ineligible. If application code must be rolled back after customers have been cleared, retain the lifecycle-aware list/audience filters or deploy a forward compatibility fix first; pre-013 application code does not understand `awaiting_verification`.

## Campaign-history relationships

- `marketing_campaign_batch_customers.customer_id` references the internal UUID `marketing_contacts.id` for legacy campaign batches.
- `marketing_email_send_recipients.customer_id` stores the stable public `marketing_contacts.customer_id` text used by template email sends.
- `marketing_email_events.recipient_id` references `marketing_email_send_recipients.id`; older events can also be correlated by `provider_message_id`.
- Production duplicate protection checks both the public customer ID and normalized recipient email for the same campaign.

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
