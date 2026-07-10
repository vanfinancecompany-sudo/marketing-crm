# Supabase Deployment Checklist

## Purpose

Use this checklist before applying any Marketing CRM migration to the shared production Supabase project.

This phase is additive only. Existing CRM tables such as `manual_leads` must not be modified.

## 1. Pre-deployment checks

- Confirm the active Git branch is `feature/customer-database-supabase`.
- Confirm the latest stable browser version remains available on `feature/customer-database`.
- Review `docs/DATABASE_AUDIT.md`.
- Review `docs/SUPABASE_SCHEMA.md`.
- Review `docs/PHASE4_IMPLEMENTATION.md`.
- Confirm all SQL files only create or alter `marketing_*` objects.
- Confirm no migration contains `drop table`, `drop column`, or changes to existing CRM tables.
- Confirm no migration changes `manual_leads`, Wix-fed tables, stock tables, or existing RLS policies.
- Confirm the Supabase project is the intended shared production project.
- Confirm there are no active Supabase incidents or degraded service notices.

## 2. Backup and recovery preparation

Before running SQL:

- Export the schema definition of existing CRM tables if practical.
- Record the current list of tables in the `public` schema.
- Take screenshots of existing table names and key CRM tables.
- Confirm Supabase backups or point-in-time recovery available on the current plan.
- Keep the existing stable Vercel deployment URL available.
- Do not delete the browser/localStorage implementation during the first Supabase deployment.

The Phase 4 migrations are additive, so the main rollback is to stop using the new tables and redeploy the prior Customer Database version.

## 3. Migration order

Run migrations one at a time in this order:

1. `supabase/migrations/001_marketing_core.sql`
2. Verify all new tables and triggers.
3. `supabase/migrations/002_marketing_indexes_rls.sql`
4. Verify indexes and RLS state.

Do not paste both migrations into one unsaved SQL editor session.

Save each successful SQL query in Supabase with a clear name and date.

## 4. Verify migration 001

After running `001_marketing_core.sql`, confirm these tables exist:

- `marketing_contacts`
- `marketing_imports`
- `marketing_import_rows`
- `marketing_merge_log`
- `marketing_exports`
- `marketing_saved_audiences`

Confirm existing tables remain unchanged.

Run:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'marketing_%'
order by table_name;
```

Expected result: the six Phase 4 tables above, plus any pre-existing marketing tables such as assets or creatives.

Confirm the update trigger exists:

```sql
select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name like 'marketing_%_set_updated_at'
order by event_object_table;
```

## 5. Verify migration 002

After running `002_marketing_indexes_rls.sql`, confirm important indexes exist:

```sql
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'marketing_contacts',
    'marketing_imports',
    'marketing_import_rows',
    'marketing_merge_log',
    'marketing_exports',
    'marketing_saved_audiences'
  )
order by tablename, indexname;
```

Confirm RLS is enabled:

```sql
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'marketing_contacts',
    'marketing_imports',
    'marketing_import_rows',
    'marketing_merge_log',
    'marketing_exports',
    'marketing_saved_audiences'
  )
order by relname;
```

Expected: `rls_enabled = true` for every new table.

Important: no public access policies are created yet. Frontend reads and writes will fail until the existing authentication model is audited and suitable policies or server-side functions are added.

## 6. Smoke-test the schema

Use a temporary test contact only after access policies or a trusted SQL session are available:

```sql
insert into public.marketing_contacts (
  customer_id,
  first_name,
  last_name,
  email,
  email_normalized,
  pipeline,
  source,
  sources,
  tags,
  email_ready,
  facebook_ready
)
values (
  'VFC-DEPLOYMENT-TEST',
  'Deployment',
  'Test',
  'deployment-test@example.com',
  'deployment-test@example.com',
  'finance',
  'manual',
  array['manual'],
  array['email_ready', 'facebook_ready'],
  true,
  true
);
```

Verify it:

```sql
select customer_id, pipeline, email_ready, facebook_ready
from public.marketing_contacts
where customer_id = 'VFC-DEPLOYMENT-TEST';
```

Then remove only the temporary test row:

```sql
delete from public.marketing_contacts
where customer_id = 'VFC-DEPLOYMENT-TEST';
```

Do not use real customer details for smoke testing.

## 7. Application deployment order

- Create the Supabase service layer on the feature branch.
- Add environment variables using the existing project URL and publishable/anonymous key.
- Never expose the service role key in Vite or browser code.
- Keep the localStorage implementation available as a temporary fallback during development.
- Deploy the feature branch to a Vercel preview.
- Test with a small controlled CSV first.
- Test the two approved Finance and Rent2Buy master files only after small-import testing succeeds.
- Do not merge to `main` until all verification checks pass.

## 8. Master data import checks

Before importing the approved files:

- Confirm the Finance file maps to `finance`.
- Confirm the Rent2Buy file maps to `rent2buy`.
- Confirm email normalization is lowercase and trimmed.
- Confirm UK mobile normalization is consistent.
- Match exact email first, then exact phone.
- Merge to `both` only when a contact genuinely belongs to both pipelines.
- Confirm customer IDs are unique.
- Create one `marketing_imports` record per file.
- Record created, updated, merged, possible duplicate, and rejected totals.

After importing, verify:

```sql
select pipeline, count(*)
from public.marketing_contacts
group by pipeline
order by pipeline;
```

```sql
select
  count(*) as total_contacts,
  count(*) filter (where email_ready) as email_ready,
  count(*) filter (where sms_ready) as sms_ready,
  count(*) filter (where facebook_ready) as facebook_ready
from public.marketing_contacts;
```

Check for duplicate normalized emails:

```sql
select email_normalized, count(*)
from public.marketing_contacts
where email_normalized is not null
  and email_normalized <> ''
group by email_normalized
having count(*) > 1;
```

Check for duplicate normalized phones:

```sql
select phone_normalized, count(*)
from public.marketing_contacts
where phone_normalized is not null
  and phone_normalized <> ''
group by phone_normalized
having count(*) > 1;
```

Expected: no results from either duplicate query.

## 9. Customer Database acceptance tests

- Dashboard totals match Supabase aggregate counts.
- Page size is 50.
- Refreshing does not remove contacts.
- Search finds records beyond page one.
- Pipeline, source, tag, postcode, and readiness filters work remotely.
- Previous, Next, and direct Page controls work.
- Manual add, edit, delete, and bulk updates persist after refresh.
- Bulk actions affect only selected contacts.
- Finance and Rent2Buy remain separate unless a contact is genuinely `both`.
- Import history persists.
- No browser localStorage quota warning appears when Supabase mode is active.

## 10. Export acceptance tests

Confirm exports use the full selected database scope, not the visible page.

Facebook headers must remain exactly:

```text
email,phone,fn,ln,zip,country
```

Country must remain `GB`.

Test:

- Full Facebook audience
- Finance Facebook audience
- Rent2Buy Facebook audience
- Full/Finance/Rent2Buy Email exports
- Full/Finance/Rent2Buy SMS exports
- Master Database export
- Duplicate Report
- Rejected Rows

Confirm one grouped `marketing_exports` record is created per export rather than writing export history onto every contact.

## 11. Existing CRM regression checks

Before approving deployment:

- Open the existing Sales CRM.
- Confirm Wix-fed `manual_leads` still update normally.
- Confirm Finance and Rent2Buy lead pipelines still display.
- Confirm stock pages still load.
- Confirm existing marketing assets, creatives, posting state, and reel tools still work.
- Confirm no existing table schema or RLS policy changed.

## 12. Rollback procedure

If the new Customer Database fails:

1. Do not merge the Supabase branch into `main`.
2. Redeploy the prior stable Customer Database branch.
3. Stop the new application from reading or writing `marketing_*` tables.
4. Keep the new tables in place while diagnosing the issue.
5. Do not drop tables containing imported contacts without first exporting them.
6. Do not modify existing operational CRM tables as part of rollback.

If a migration itself fails partway:

- Record the exact Supabase error.
- Inspect which `marketing_*` objects were created.
- Fix the migration to remain idempotent using `if not exists` where appropriate.
- Re-run only after review.

## 13. Final approval record

Record the following after successful deployment:

- Date and time
- Branch and commit SHA
- Migrations applied
- Contact totals by pipeline
- Import file names
- Build result
- Vercel preview URL
- Manual tester
- Known limitations
- Approval to merge or continue testing

## Stop point

Stop after the Customer Database is stable on Supabase.

Do not start Audience Builder, Email Campaigns, SMS Campaigns, Facebook API, Google Customer Match, analytics, or automation until separately approved.
