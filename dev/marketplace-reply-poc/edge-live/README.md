# Live Edge Marketplace assistant

The real-browser version of the Marketplace reply prototype. It has three parts:

- `service.mjs`: a local service on `127.0.0.1:4618`. It holds the durable ledger, the kill switch and the control page, and calls the existing `draftMarketplaceReply` with the **live website Ask Me endpoints** (`/api/jasmine` on rent2buyvans.co.uk and vanfinancecompany.co.uk). The model, knowledge and business logic are unchanged.
- `extension/`: an MV3 extension for your normal Edge profile. It keeps one pinned, non-discardable background tab, detects unread conversations, reads message IDs and sends replies only when the service has claimed the reply and re-authorised it immediately before Send is pressed.
- `ledger.mjs`: every decision, persisted atomically to `%LOCALAPPDATA%\Rent2BuyMarketplaceAssistant\state.json` before the browser acts.

Marketplace publishing, renewals, Facebook Groups and the existing Marketplace Helper extension are untouched.

## Safety rules (enforced in `ledger.mjs`)

| Rule | How |
| --- | --- |
| Starts **Off** | Modes: Off, Observe (detect only), Draft (Ask Me drafts, never typed), Send |
| Send only where allowed | Send mode replies only in allowlisted thread IDs unless "all conversations" is ticked |
| Immediate stop | **STOP NOW** in the popup or control page, `Alt+Shift+0`, or create a file named `STOP` beside `state.json`. Re-checked between typing and pressing Send |
| No replies to the backlog | Conversations already unread at switch-on, and messages that arrive while Off, are left for a person |
| No duplicates | Each customer message ID is answered once. A claimed reply is never re-sent after a crash, reload or restart; an unconfirmed send pauses that conversation |
| Escalation | Complaints, application decisions, requests for a person, cross-product questions and unknown products pause the conversation and appear under **Needs a person** |
| Website redirect | Stock, prices, specs and quotes get the clickable https://www.rent2buyvans.co.uk/ link (existing `reply-policy.mjs`) |

## Run on the Windows PC

1. Start the service: `node dev/marketplace-reply-poc/edge-live/service.mjs` (or `start-assistant.ps1`).
2. In Edge, open edge://extensions, switch on **Developer mode**, select **Load unpacked** and choose the `extension` folder.
3. Open http://127.0.0.1:4618/ and select **Observe**. The extension opens a pinned background tab at https://www.facebook.com/marketplace/inbox/. Keep using Facebook normally in other tabs.
4. Ask a consenting tester to message one advert. In Observe mode the control page should show `unread` and `incoming` events for that thread within a few seconds. Then try **Draft only** to check the Ask Me reply without sending.
5. **Live sending requires explicit approval.** Once approved, add only the tester's thread ID to the allowlist and select **Send**.

`R2B_DEFAULT_PRODUCT` (default `rent2buy`) sets the product when the listing title does not say. Set it to an empty string to send unknown listings to a person.

## Tests

- `node --test tests/marketplace-edge-live.test.mjs` covers the ledger rules and the live responder (with a fake fetch).
- `node dev/marketplace-reply-poc/edge-live/test/e2e-edge.mjs` runs the real extension and service in Edge, launched with no browser automation so background-tab behaviour is genuine. It uses a local page with Facebook's chat structure (`test/fb-shape.html`, pushed over SSE like Facebook's realtime channel) and stubs Ask Me.

## Verified on 23 November 2026 (Edge 157, Windows 11)

- A genuinely hidden background tab (`visibilityState = hidden`) detected a new message in a closed, read conversation and replied once in 5.5–8.8 s, including the website link.
- Already-unread conversations at switch-on, complaints, messages after STOP and messages left unread while Off all received no reply.
- Ledger, history and Off state survived a hard kill of Edge and the service. After restart: one assistant tab, one reply to the next new message.
- Live Ask Me through the Rent2Buy website endpoint gave correct Rent2Buy answers in 4.3 s (10 s on the first message, which also opens the conversation).
- Defect found and fixed: a message arriving while the assistant was viewing that conversation was marked read by the page and missed. The assistant now re-reads the open conversation until its message IDs stop changing.

## Still needs verification on the real Facebook account

These cannot be tested without the signed-in Edge profile and a consenting test sender:

1. **Unread signal in the real inbox.** The scanner looks for thread links `/messages/t/<id>`, plus a "Mark as read" or "unread" label or a hidden "Unread message:" text in the row. Observe mode shows rows and unread counts in the popup, so you can confirm it in the first minute. If the count is 0 with unread chats visible, the selector in `content.js#isUnread` needs adjusting from a real DOM sample.
2. **Message direction.** Uses "You sent" / "<name> sent" labels (seen in the live inspection) with a bubble-position fallback.
3. **Sending.** Text is inserted with `execCommand` into the Lexical composer and **Press enter to send** is clicked. Send is confirmed only when a new outgoing message ID with the same text appears.
4. **Edge restart.** Tab IDs are kept in session storage, and the restored assistant tab is adopted by a page marker. Automated testing of an Edge relaunch on the same profile is blocked because Edge disables command-line-loaded extensions on relaunch. Check once on the PC that the extension stays enabled and there is one pinned tab after restarting Edge. Edge **Sleeping tabs** is countered with `autoDiscardable: false` and a 3-minute stale-heartbeat reload. Also add `facebook.com` to *Never put these sites to sleep*.
5. **Windows reboot.** `install-startup.ps1` adds a Startup-folder shortcut that starts the service and Edge at logon. It has not been installed. The PC must stay signed in, awake and online.

Meta's terms restrict automated access to Facebook. Running this on a personal profile carries a risk of account checks or restrictions. A security checkpoint pauses the assistant (`health: security-challenge`).
