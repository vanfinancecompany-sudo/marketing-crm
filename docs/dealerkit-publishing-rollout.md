# DealerKit publishing release runbook

The reviewed production release needs the Cars media migration and an isolated Wix Media smoke test. The Vercel preview can be reviewed with fixtures while its database remains untouched.

## Validate the destination

1. Verify the Supabase project and Vercel production project in their dashboards. In Supabase, confirm a current backup and an available recovery point. Save the results of these read-only queries with the change record.

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.dealerkit_review_manual_media'::regclass
order by conname;

select site_scope, purpose, count(*)
from public.dealerkit_review_manual_media
group by site_scope, purpose;

select relrowsecurity
from pg_class
where oid = 'public.dealerkit_review_manual_media'::regclass;

select role_name,
       has_table_privilege(role_name, 'public.dealerkit_review_manual_media', 'SELECT') as can_read,
       has_table_privilege(role_name, 'public.dealerkit_review_manual_media', 'UPDATE') as can_update
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
```

2. Check that the two existing constraints have the names the migration drops and that only the two valid legacy pairs exist. A mismatch requires a schema review before rollout. Confirm the Cars Wix Media destination matches the Cars controlled publisher and confirm available CMS item capacity.
3. Apply the exact migration to an isolated database and use a disposable Wix site for a real upload smoke test. Use synthetic vehicles. Upload at least three uniquely identifiable files, reorder them, select a non-first primary, and inspect both Cars CMS payloads. Repeat on an existing fixture and verify that the old record IDs are reused and that staged secondary order survives a reload and an additional upload. Verify that a pending or failed primary blocks publishing and that another registration cannot claim the file.

## Production rollout after approval

1. Pause DealerKit publishing while the schema and app are updated. Apply only the reviewed Cars media migration through the normal Supabase migration process. Run the read-only checks again. Verify RLS is still enabled, public roles still lack table access, and only service_role can execute the Cars selection function. Compare legacy row counts. Confirm the Cars-only append sequence and trigger exist, and that the application service role can use the sequence.
2. Release the reviewed Git commit to the existing Marketing CRM production project using the normal Git/Vercel workflow. Confirm the commit, deployment readiness and the three product review screens. Check capacities and relevant errors before resuming publication.
3. Monitor the first authorized normal publication per product. Check Wix listing and detail IDs, category membership, prices and image order. If the CRM reports a partial rollback, reconcile the listed records before retrying.

## Rollback

Pause publishing and restore the prior Vercel deployment first. Leave the additive database schema in place. The earlier application can continue using the original Finance and Rent2Buy pairs. A reverse migration restoring the old constraints fails if Cars rows exist. Preserve any Cars upload metadata and let the database owner review a data-preserving reverse plan if a schema rollback is required. Reverting the application does not undo accepted Wix writes. Use the reported record IDs and rollback results to reconcile those separately.

## Validation performed

The exact migration was applied to an isolated in-memory PostgreSQL instance using the repository's baseline table and grants. The checks covered retained legacy rows, valid and invalid pairs, duplicate file IDs, RLS and grants, atomic primary selection, and rollback. No live Supabase data was used. The real CRM media handler also ran against that isolated database with mocked Wix responses. It exercised signed upload preparation, registration, READY polling, rejection of cross-registration and cross-product claims, and verified the proposed CMS payloads for a first publication and a replacement. Equal timestamps no longer change new Cars photo order because inserts receive a stored sequence. Real Wix Media signature, uploader response, READY status and display-name compatibility remain an isolated-site release gate.
