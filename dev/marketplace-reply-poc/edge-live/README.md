# Live Edge Marketplace assistant

The real-browser version of the Marketplace reply prototype. It has three parts:

- `service.mjs`: a local service on `127.0.0.1:4618`. It holds the durable ledger, the kill switch and the control page, and calls the existing `draftMarketplaceReply` with the **live website Ask Me endpoints** (`/api/jasmine` on rent2buyvans.co.uk and vanfinancecompany.co.uk). The model, knowledge and business logic are unchanged.
- `extension/`: an MV3 extension for your normal Edge profile. It keeps one pinned, non-discardable background tab, detects unread conversations, reads message IDs and sends replies only when the service has claimed the reply and re-authorised it immediately before Send is pressed.
- `ledger.mjs`: every decision, persisted atomically to `%LOCALAPPDATA%\Rent2BuyMarketplaceAssistant\state.json` before the browser acts.

Marketplace publishing, renewals, Facebook Groups and the existing Marketplace Helper extension are untouched.

## Safety rules (enforced in `ledger.mjs`)

| Rule | How |
| --- | --- |
| Starts **Off** | Modes: Off, Observe, Draft (Ask Me drafts, never typed), Send |
| Observe is passive | Reads only the conversation list and unread indicators. It never opens a conversation, so read status is unchanged. It never reads or stores message text and never calls Ask Me. Enforced in the service and again in the extension |
| Send is never restored | After any restart of the service, Edge or Windows, the service comes back **Off** (logged as `send-not-restored`). Send must be switched on again in the popup or control page, which asks for confirmation |
| Send only where allowed | Send mode replies only in allowlisted thread IDs unless "all conversations" is ticked |
| Immediate stop | **STOP NOW** in the popup or control page, `Alt+Shift+0`, or create a file named `STOP` beside `state.json`. Re-checked between typing and pressing Send |
| No replies to the backlog | Conversations already unread when Draft or Send is switched on, and messages that arrive while Off or Observing, are left for a person |
| No duplicates | Each customer message ID is answered once. A claimed reply is never re-sent after a crash, reload or restart; an unconfirmed send pauses that conversation |
| Escalation | Complaints, application decisions, requests for a person, cross-product questions and unknown products pause the conversation and appear under **Needs a person** |
| Website redirect | Stock, prices, specs and quotes get the clickable https://www.rent2buyvans.co.uk/ link (existing `reply-policy.mjs`) |

## Install on the Windows PC (permanent folder)

Needs Git and Node.js 20 or later. No `npm install` is required: the service uses only Node built-ins.

1. Clone: `git clone --depth 1 --branch codex/marketplace-reply-poc https://github.com/vanfinancecompany-sudo/marketing-crm.git "$env:USERPROFILERent2BuyAssistant"`
2. Start the service and leave the window open: `node "$env:USERPROFILERent2BuyAssistantdevmarketplace-reply-pocedge-liveservice.mjs"`
3. In the Edge profile that is signed in to Facebook, open edge://extensions, switch on **Developer mode**, select **Load unpacked** and choose `%USERPROFILE%Rent2BuyAssistantdevmarketplace-reply-pocedge-liveextension`.
4. Open http://127.0.0.1:4618/ and select **Observe**. A pinned background tab opens at https://www.facebook.com/marketplace/inbox/. Keep using Facebook in other tabs.
5. The extension's toolbar popup shows "Chats visible" and "unread" counts. When a tester messages an advert, the control page shows an `unread-observed` event, and the conversation stays unread.
6. Live sending needs explicit approval. Do not select Draft or Send until then.

Update later with `git -C "$env:USERPROFILERent2BuyAssistant" pull`, then select the reload icon on the extension in edge://extensions.

`R2B_DEFAULT_PRODUCT` (default `rent2buy`) sets the product when the listing title does not say. Set it to an empty string to send unknown listings to a person.

## Read-only inbox diagnostics

- The assistant tab saves a structural snapshot once a minute while in Observe.
- **Capture diagnostics from this tab** in the extension popup saves one from the Facebook tab you are looking at.
- Both are written to `%LOCALAPPDATA%Rent2BuyMarketplaceAssistantinbox-diagnostics.json` and shown at http://127.0.0.1:4618/diagnostics.
- A snapshot contains page path, thread-link patterns, list containers, and per-row size and unread signals (label, dot colour, font weights). Thread IDs are included. Message text, names and previews are never included: labels keep only known UI words, and every other word becomes "•".

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

1. **Unread signal: confirmed on the real account (Edge capture, 23 Nov 2026).**
   - Conversation rows sit in two grids, `role=grid` "Chats" and "Marketplace". They link to `/messages/t/<id>` or `/messages/e2ee/t/<id>`, and each row is about 345–360 × 72 px.
   - An unread row has a round blue dot, `rgb(0, 100, 209)`, and its name in font weight 600. A read row has no dot and weight 500.
   - The two signals agreed on all 60 captured rows. Rows carry no "unread" label.

   **Keeping the list open (approved by the owner, 23 Nov 2026).** The hidden assistant tab on `/marketplace/you/selling` has no conversation list until the chat panel is opened. The assistant tab therefore clicks the header **Messenger** button and then the panel's **Marketplace** control, the same route you use by hand. It never clicks a link to another page or anything inside a single conversation's row. If the page changes or a conversation view appears after a click, the opener disables itself for that tab. The list is reopened after it closes, after a page refresh and after an Edge restart. Opening the panel may clear Facebook's red Messenger counter.

   **No false arrivals.** Nothing is baselined until the Marketplace list is open. After that, a conversation counts as a new arrival only when it changes from read to unread, or appears unread for the first time in the top five rows of its list. Old unread conversations that Facebook renders lazily further down never count.
2. **Message direction.** Uses "You sent" / "<name> sent" labels (seen in the live inspection) with a bubble-position fallback.
3. **Sending.** Text is inserted with `execCommand` into the Lexical composer and **Press enter to send** is clicked. Send is confirmed only when a new outgoing message ID with the same text appears.
4. **Edge restart.** Tab IDs are kept in session storage, and the restored assistant tab is adopted by a page marker. Automated testing of an Edge relaunch on the same profile is blocked because Edge disables command-line-loaded extensions on relaunch. Check once on the PC that the extension stays enabled and there is one pinned tab after restarting Edge. Edge **Sleeping tabs** is countered with `autoDiscardable: false` and a 3-minute stale-heartbeat reload. Also add `facebook.com` to *Never put these sites to sleep*.
5. **Windows reboot.** The service comes back Off after a reboot by design. `install-startup.ps1` adds a Startup-folder shortcut that starts the service and Edge at logon. It has not been installed. The PC must stay signed in, awake and online.

Meta's terms restrict automated access to Facebook. Running this on a personal profile carries a risk of account checks or restrictions. A security checkpoint pauses the assistant (`health: security-challenge`).

## Session of 23 November 2026 (evening)

**Live detection evidence.** The `unread-observed` event at 19:31:48 was for conversation `1761408039328724`:
- It was the first row of the Marketplace list, which is where Facebook places the newest activity.
- It was absent from the 27-row starting snapshot taken at 19:31:22.
- It showed the unread dot and bold name.
- No other Marketplace arrival was logged in the following minutes.

The diagnostics on extension 0.2.0 strip names and titles, so its link to the Renault Master test is unconfirmed until the pilot reads the row text.

**Safety fix.** In Draft or Send, a newly unread conversation is now opened only if it is on the allowlist. Before this fix, any new conversation would have been opened.

**Detection**
- Only the Marketplace list counts; ordinary Messenger chats are ignored.
- Each arrival records its reason: `new-at-top`, `read-to-unread`, or `moved-to-top`. Moved-to-top means a further message in an unanswered chat jumped from position 2 or lower to the top.
- Only the top 100 rows of each list are classified.

**Pilot** (control page, "Verify and read once"):
1. Reads the visible row text of one conversation.
2. Opens it only if the text contains the expected words.
3. Reads it and drafts a reply with Ask Me. Nothing is sent.
4. Returns to Observe.

**Monitoring banner.** The popup and control page say "Monitoring the Marketplace list: yes/no", with plain-language reasons.

**Self-update.** From extension 0.3.0 on, a `git pull` is enough: the extension reloads itself and the assistant tab. Version 0.2.0 needs one manual reload.

**Live Ask Me check** (`test/askme-live-check.mjs`, 13 Marketplace questions on the deployed Rent2Buy endpoint): 13 of 13 pass. Three vehicle-specific phrasings had been reaching Ask Me: a van's monthly price, details asked about "it", and requests to hold a van. The Marketplace routing in `reply-policy.mjs` now sends these to the website. Ask Me itself is unchanged.
