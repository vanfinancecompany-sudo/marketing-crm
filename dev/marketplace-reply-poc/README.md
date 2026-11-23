# Marketplace automatic reply proof of concept

This is a developer-only tool mounted on the Marketing CRM Vite server. Its separate unpacked extension is restricted to the synthetic loopback inbox. It has no Facebook host permissions, live message transport, account credentials, CRM database access or production routes. The existing Marketplace Helper package is unchanged.

## Run locally

1. Install the CRM's locked dependencies with `npm ci`.
2. Run `npm run dev -- --mode marketplace-reply-poc --port 4617 --strictPort`.
3. Open [the local CRM reply control](http://127.0.0.1:4617/__marketplace-reply-poc/).
4. In a dedicated test browser profile, open the browser's extension management screen, enable Developer mode and use Load unpacked to select the `extension` directory next to this README. Open the simulated inbox using the link in the control. Keep the inbox tab open.
5. Turn replies on and add synthetic enquiries from the control. The report shows one sent acknowledgement per matching conversation. Add an unrecognised listing or already-answered conversation to verify that they are skipped.

The starting setting is Off. Enquiries already present before enabling are excluded from automatic replies. The development server saves its synthetic state to a per-checkout and port file in the OS temporary directory and restores the same settings and history after restart. The heartbeat is refreshed by an active inbox tab. A future hosted launcher must open that tab when Chrome starts and verify the extension is loaded. In the local headless test, Chrome retained its profile but the DevTools-installed extension had to be loaded again on restart. A signed-out, challenged or changed layout pauses sending until the inbox is restored and replies are turned off and back on.

## Verify recovery

- Open two simulated inbox tabs to exercise duplicate detection.
- Hold outgoing receipts, add a new enquiry and wait for the report to show one mock send. Close the browser, then reopen the same profile and turn off Hold outgoing receipts. The worker should confirm the existing receipt with the send count still at one.
- A recorded attempt with no visible receipt becomes Unconfirmed after eight seconds in the fixture. The worker never repeats that attempt automatically.
- Run `node --test tests/marketplace-reply-poc.test.mjs tests/marketplace-helper.test.js tests/marketplace-helper-package.test.js` for local regressions.

## Scope of the proof

The mock sender and CRM claim use a single local state file. A supervised live test would need Meta permission for the browser access and sending, an explicitly approved test account and listing, and a dedicated browser profile. First verify stable conversation, listing and receipt identity and confirm that the operator can stop sending immediately. A production implementation would need durable server-side atomic claims, authenticated worker access and an alert path. The fixture's identity fields and delivery receipts provide no evidence that the live Facebook interface exposes equivalent signals.
