# Rent2Buy proven groups renewal: first-stage review
Scope: once per London day, Rent2Buy only, maximum 30 previously proven due groups. No automated joining, discovery, Facebook publication or modification of Marketplace replies.
- Apply migration in a reviewed environment. Verify RLS and service_role access.
- Deploy tested code. Configure existing CRON_SECRET and set RENT2BUY_GROUP_RENEWAL_ENABLED=true only after review. Vercel cron checks at 07:00 UTC (08:00 BST); London date key prevents repeated planning. To pilot at another time, invoke the authenticated cron endpoint once in production after enabling; never share the secret.
- Dashboard shows recorded CRM submissions after the check for queued groups, not Facebook acceptance or automated sends. The existing helper remains the publishing workflow and requires user approval. Membership or prior post status conflicts appear in review. A manual post before the daily check will not count as a planned renewal.
- Before any automatic publication, confirm an authorised method and live account/group permissions. Do not use browser automation to bypass restrictions; no automatic publishing adapter has been added.
- Test using the 16 currently due groups; stale or conflicting posting eligibility must be reviewed, not silently overridden. No test creates or submits a Facebook post.
