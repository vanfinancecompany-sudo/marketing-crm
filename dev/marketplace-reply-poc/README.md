# Marketplace automatic reply proof of concept

This is a developer-only tool mounted on the Marketing CRM Vite server. Its separate unpacked extension is restricted to the synthetic loopback inbox. It has no Facebook host permissions, live message transport, account credentials, CRM database access or production routes. The existing Marketplace Helper package is unchanged.

## Run locally

1. Install the CRM's locked dependencies with `npm ci`.
2. Run `npm run dev -- --mode marketplace-reply-poc --port 4617 --strictPort`.
3. Open [the local CRM reply control](http://127.0.0.1:4617/__marketplace-reply-poc/).
4. In a dedicated test browser profile, open the browser's extension management screen, enable Developer mode and use Load unpacked to select the `extension` directory next to this README. Open the simulated inbox using the link in the control. Keep the inbox tab open.
5. Turn replies on and add synthetic enquiries from the control. The report shows one sent acknowledgement per matching conversation. Add an unrecognised listing or already-answered conversation to verify that they are skipped.

The starting setting is Off. Enquiries already present before enabling are excluded from automatic replies. The development server saves its synthetic state to a per-checkout and port file in the OS temporary directory and restores the same settings and history after restart. The heartbeat is refreshed by an active inbox tab. A future hosted launcher must open that tab when Chrome starts and verify the extension is loaded. In the local headless test, Chrome retained its profile but the DevTools-installed extension had to be loaded again on restart. A signed-out, challenged or changed layout pauses sending until the inbox is restored and replies are turned off and back on.


## Rent2Buy-first replies

General programme questions go to the existing Ask Me adapter without vehicle or quote context. A known Rent2Buy conversation or an explicit Rent2Buy question can use that lane without matching an advert. Finance stays separate. Assign an ambiguous conversation to the team, particularly when the inbox contains both kinds of adverts.

Questions about availability, specifications, individual prices and personalised quotes point to https://www.rent2buyvans.co.uk/. The adapter provides the full homepage URL without looking up the Facebook advert or claiming a vehicle is in stock. The first general answer, and later answers with browse or apply actions, invite the customer to see current stock and apply online. Complaints, individual application decisions and explicit human requests enter review and pause simulated replies.
## Try a multi-turn Ask Me conversation

1. In **Ask Me conversations**, choose a Finance listing and start with “Do your vans come with a warranty?”
2. After the first reply is confirmed, select the same conversation and add “Does that include the gearbox?” The synthetic reply should refer to warranty coverage.
3. Start a separate Rent2Buy conversation with “When is the initial rental payment due?” and follow up with “When is that due?” The Rent2Buy reply should stay in its own conversation and use the Rent2Buy context.
4. Ask for a human, ask a Finance-only question on a Rent2Buy listing or use an unrecognised listing without naming Rent2Buy. The CRM fixture marks the thread **Needs human**, gives the reason and stops automatic replies on that thread.

The fixture calls the existing Ask Me engine with the product locked to the known lane or to an explicit Rent2Buy question, and with recent confirmed exchanges only. It uses local synthetic knowledge and a deterministic model stand-in. It makes no real model, knowledge-store or postcode lookup calls. The extension still only observes and clicks inside the loopback inbox.

## Compare against the live website Ask Me engine

Run the existing simulator tests for effect-free validation. For a labelled synthetic benchmark of the deployed engine, run:

    node dev/marketplace-reply-poc/benchmark.mjs --live-website

The benchmark uses only the existing VFC and Rent2Buy website Ask Me endpoints. It creates ordinary Ask Me QA sessions and telemetry on the live sites. It sends no Marketplace messages, loads no production secrets and does not enable any transport in the local simulator. Each comparison uses separate website sessions with the same questions. The adapter uses its normal product and handoff checks. The public website session retains the conversation. Local adapter time excludes the website call and pacing delays. The measured website request includes transport, CRM session work and model inference.

A simulated inbound observation can provide an explicit direction and stable message ID. The fixture rejects outgoing or identity-less observations and deduplicates the same ID within a thread, including after a restart. Same text with a different verified ID is a new message. This tests the ledger, while Facebook still needs to expose a durable incoming ID.

## Verify recovery

- Open two simulated inbox tabs to exercise duplicate detection.
- Hold outgoing receipts, add a new enquiry and wait for the report to show one mock send. Close the browser, then reopen the same profile and turn off Hold outgoing receipts. The worker should confirm the existing receipt with the send count still at one.
- A recorded attempt with no visible receipt becomes Unconfirmed after eight seconds in the fixture. The worker never repeats that attempt automatically.
- Run `node --test tests/marketplace-reply-poc.test.mjs tests/askme-lean-engine.test.js tests/marketplace-helper.test.js tests/marketplace-helper-package.test.js` for local regressions.

## Inspect the read-only Edge observer

With the loopback dev server running, load the separate **observer-extension** folder in a disposable Edge profile using Load unpacked. Open the observer lab from the local CRM fixture. Only the observer extension is needed for this lab. It reads synthetic DOM metadata and posts it to the loopback diagnostics endpoint. It has no Facebook host permission, composer, send control, model call or message-body upload.

- Let the first snapshot establish a baseline. It should report zero accepted incoming messages.
- Click **Simulate new messages**. Each batch adds one distinct Finance message and one Rent2Buy message. The displayed text is deliberately identical. Matching uses exact listing IDs from local test receipts.
- Toggle unread on the closed conversation. The fixture exposes a thread-level unread notice and no message history. Repeat the snapshot or restart the receiver. The same notice is counted once until an explicit read. A notice can cover multiple messages.
- Repeat the snapshot, reload or restart Edge. Existing IDs stay excluded. The first healthy snapshot after browser or receiver restart, a failed request, a challenge or an eight-second heartbeat gap holds newly discovered history for review. A closed or partly loaded thread establishes a fresh baseline when its history becomes visible. The simulated message sequence represents trusted arrival evidence. A newly visible ID alone does not establish a new enquiry.
- The Edge lab can receive a synthetic update from another same-origin tab through a storage event. Its report includes document visibility, so a test can verify the observer really was hidden when an update arrived.
- Stop or disconnect the local service to exercise the unavailable state. A browser heartbeat resumes ordinary observation when the local service returns. A simulated authentication challenge reports a pause.
- The observer reports DOM scan time, server ingest time and loopback round-trip time separately from Ask Me. The tests pass resolved products to the existing development Ask Me adapter without granting the observer control over the inbox.

## Verification on 23 November 2026

- A one-time check of the signed-in Edge tab found seven unique message IDs in the already-open, read conversation. The closed inbox list and an unread signal were unavailable in that view. Earlier checks found the same history IDs after refreshing an already-read thread. No new live arrival or live outgoing sample was tested.
- The disposable Edge 157 test accepted six distinct synthetic arrivals. It retained one closed-thread unread notice across reloads and Edge and receiver restarts, held six messages discovered after receiver failure, a simulated authentication challenge or simulated freeze and resume events, and created zero reply jobs. Two-tab propagation worked, but headless Edge kept reporting the observer as visible and did not emit a real freeze event in the test. The final cross-tab update was observed in 151 ms, including test polling, and the loopback request took 14.3 ms.
- The 63 targeted tests cover simulated reply safety, observer recovery and deduplication, the existing website Ask Me engine and existing Marketplace extension packaging.

## Prepare a Windows pilot

Start the service and its Edge profile at Windows user logon during a controlled pilot. Verify the dedicated profile can open its intended tab after a clean Edge restart, wait for the CRM heartbeat and alert when it goes stale. The local unattended process depends on a signed-in Windows session, the machine remaining awake and online, an active tab and a valid Facebook session. Confirm Edge sleeping-tab or tab-discard behaviour on the actual PC before relying on background observation. The test launcher may need to reload an unpacked extension installed through the DevTools test protocol. No startup task, profile option or browser permission is changed by this fixture.

Before connecting a real read-only observer, obtain Meta's permission for automated access and a separately approved controlled inbound test. Verify new-versus-historical arrival, outgoing direction and unread semantics with a consenting test sender. Verify the Rent2Buy lane using explicit programme context or an owner-confirmed source. Any use of listing metadata for routing needs a dependable registry match. A logout, security challenge or unrecognised page state should stop the connection and notify a person. Any future sending test also needs explicit permission, durable claims, an outgoing confirmation signal and a stop control.

## Scope of the proof

The mock sender and CRM claim use a single local state file. A supervised live test would need Meta permission for the browser access and sending, an explicitly approved test account and listing, and a dedicated browser profile. First verify stable conversation, listing and receipt identity and confirm that the operator can stop sending immediately. A production implementation would need durable server-side atomic claims, authenticated worker access and an alert path. A human-supervised live inspection found seven visible incoming IDs and the same listing link in one already-read conversation after hydration and refresh. A real new-message arrival, sender-direction parity, an unread thread, and sender receipt identity still need independent verification.
