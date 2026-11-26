# Global CRM health centre

One sticky, minimisable panel across the Marketing CRM. It reuses the existing system health, DealerKit stock monitor, Conversations & AI and Rent2Buy renewal telemetry, adds authenticated scheduled execution receipts, and pings the existing Facebook helper in the current browser. No AI calls, no publication or worker triggers on refresh. A scheduled execution receipt verifies the worker response, not external publication.

All configured Vercel cron jobs are listed in the registry. A prebuild test prevents registry drift. The new migration creates one protected latest receipt per scheduled worker; no customer data or raw response bodies are stored. Apply it before deploying the instrumented worker handlers. Receipts appear after genuine production cron runs only. Missing/stale evidence is not marked healthy. Legacy overnight Vansco cache refresh is retired from health reporting.

The dedicated price sync and orphan recovery receipts replace the old schedule/shared rows. Receipts include Wix row counts, prices updated, safely recovered campaign reservations and reservations held for review. The email integration uses recent SendGrid delivery evidence, and the legacy provider checks still report unknown or failed outcomes. Groups Helper 1.2.32 records the hourly approval alarm execution, the latest Facebook result and exhausted checks. The CRM distinguishes an idle queue, first execution pending and a stale or failing monitor. Lender autofill belongs to the Main CRM and lender portals and appears as on demand.

The new panel refreshes every five minutes, on returning to the browser after a minute, or on demand. Copy diagnostic report shares issue summaries only. Existing independent alert emails remain unchanged.
