import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authoriseSend, emptyState, inspectInbox, inspectThread, loadState, publicStatus, recordDraft, recordHeartbeat,
  recordSendResult, resumeThread, saveState, setMode, startupMode, startPilot, verifyPilot, finishPilot, monitoringVerdict, pilotTimeout, resolveProduct,
} from "../dev/marketplace-reply-poc/edge-live/ledger.mjs";
import { liveResponder } from "../dev/marketplace-reply-poc/edge-live/askme-live.mjs";
import { draftMarketplaceReply } from "../dev/marketplace-reply-poc/assistant.mjs";

const OPTS = { defaultProduct: "rent2buy" };
const msg = (id, direction, text = "Hello") => ({ id: "mid.$" + id, direction, text });

function enabled(mode = "send", allowThreads = ["200"]) {
  const state = emptyState();
  setMode(state, mode, { allowThreads });
  inspectInbox(state, [{ id: "100", unread: true }, { id: "300", unread: false }]); // baseline
  return state;
}

function flag(state, id) {
  return inspectInbox(state, [{ id: "100", unread: true }, { id, unread: true }]);
}

test("off mode never opens, drafts or sends", () => {
  const state = emptyState();
  assert.deepEqual(inspectInbox(state, [{ id: "200", unread: true }]), { open: null });
  assert.equal(inspectThread(state, { threadId: "200", messages: [msg(1, "incoming")] }, OPTS).action, "none");
  assert.equal(Object.keys(state.threads).length, 0);
});

test("conversations unread at switch-on stay with a person; later unread ones are opened", () => {
  const state = enabled();
  assert.equal(publicStatus(state).baselineUnread, 1);
  assert.deepEqual(flag(state, "200"), { open: "200" });
  assert.equal(inspectInbox(state, [{ id: "100", unread: true }, { id: "200", unread: true }]).open, "200");
  assert.ok(!state.pendingOpen.includes("100"));
  // Once the excluded thread is read and becomes unread again, it is new, but
  // it is not on the allowlist, so it is reported and never opened.
  inspectInbox(state, [{ id: "100", unread: false }]);
  inspectInbox(state, [{ id: "100", unread: true }]);
  assert.ok(!state.pendingOpen.includes("100"));
  assert.equal(state.events.at(-1).type, "unread-not-opened");
  state.allowThreads.push("100");
  inspectInbox(state, [{ id: "100", unread: false }]);
  inspectInbox(state, [{ id: "100", unread: true }]);
  assert.ok(state.pendingOpen.includes("100"));
});

test("Draft and Send never open a conversation that is not on the allowlist", () => {
  for (const mode of ["draft", "send"]) {
    const state = enabled(mode, ["999"]);
    assert.equal(flag(state, "200").open, null, mode);
    assert.deepEqual(state.pendingOpen, []);
    assert.equal(state.events.at(-1).type, "unread-not-opened");
    assert.equal(state.events.at(-1).reason, "new-at-top");
  }
});

test("a flagged thread answers only the trailing customer messages, once", () => {
  const state = enabled();
  flag(state, "200");
  const snapshot = { threadId: "200", listingTitle: "2016 Ford Transit Rent2Buy", messages: [msg(1, "incoming", "Old"), msg(2, "outgoing", "Old reply"), msg(3, "incoming", "Is there a warranty?")] };
  const decision = inspectThread(state, snapshot, OPTS);
  assert.equal(decision.action, "draft");
  assert.equal(decision.message, "Is there a warranty?");
  assert.equal(decision.product, "rent2buy");
  const sendable = recordDraft(state, decision, { text: "Yes, there is a warranty." });
  assert.equal(sendable.action, "send");
  assert.deepEqual(authoriseSend(state, sendable.jobId), { go: true });
  assert.equal(authoriseSend(state, sendable.jobId).go, false, "a claim can only be used once");
  recordSendResult(state, sendable.jobId, { confirmed: true, outgoingId: "mid.$4" });
  // The same page seen again, now including our reply: nothing new to answer.
  const again = inspectThread(state, { ...snapshot, messages: [...snapshot.messages, msg(4, "outgoing", "Yes, there is a warranty.")] }, OPTS);
  assert.equal(again.action, "none");
  assert.equal(publicStatus(state).counts.sent, 1);
  // A genuinely new customer message continues the conversation with history.
  const next = inspectThread(state, { ...snapshot, messages: [...snapshot.messages, msg(4, "outgoing"), msg(5, "incoming", "Does it cover the gearbox?")] }, OPTS);
  assert.equal(next.action, "draft");
  assert.equal(state.threads["200"].history.length, 2);
});

test("an unflagged conversation seen for the first time is only a baseline", () => {
  const state = enabled();
  assert.equal(inspectThread(state, { threadId: "300", messages: [msg(1, "incoming")] }, OPTS).action, "none");
  assert.equal(inspectThread(state, { threadId: "300", messages: [msg(1, "incoming"), msg(2, "incoming", "New")] }, OPTS).action, "draft");
});

test("Observe is passive: it never opens, reads, stores or drafts a conversation", () => {
  const state = emptyState();
  setMode(state, "observe", { allowThreads: ["200"] });
  assert.deepEqual(inspectInbox(state, [{ id: "100", unread: true }]), { open: null }); // baseline
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(inspectInbox(state, [{ id: "100", unread: true }, { id: "200", unread: true }]), { open: null });
  }
  assert.deepEqual(state.pendingOpen, []);
  assert.equal(state.events.filter((e) => e.type === "unread-observed").length, 1, "each unread episode is logged once");
  assert.deepEqual(publicStatus(state).observedUnread, ["100", "200"]);
  const result = inspectThread(state, { threadId: "200", messages: [msg(1, "incoming", "Private text")] }, OPTS);
  assert.deepEqual(result, { action: "none", reason: "Observe mode is passive" });
  assert.deepEqual(state.threads, {});
  assert.ok(!JSON.stringify(state).includes("Private text"));
});

test("nothing is baselined or assessed until the conversation list is fully open", () => {
  const state = emptyState();
  setMode(state, "observe");
  assert.deepEqual(inspectInbox(state, [{ id: "100", unread: true, pos: 0 }], { listReady: false }).open, null);
  assert.equal(state.inboxBaseline, null);
  inspectInbox(state, [], { listReady: true });
  assert.equal(state.inboxBaseline, null, "an empty list is not a baseline");
  inspectInbox(state, [{ id: "100", unread: true, pos: 0 }]);
  assert.equal(publicStatus(state).baselineUnread, 1);
});

test("old unread conversations rendered lazily further down are not new arrivals", () => {
  const state = emptyState();
  setMode(state, "observe");
  inspectInbox(state, [{ id: "1", unread: false, pos: 0 }, { id: "2", unread: true, pos: 1 }]);
  // Facebook renders more of the list: backlog appears lower down.
  inspectInbox(state, [{ id: "1", unread: false, pos: 0 }, { id: "2", unread: true, pos: 1 }, { id: "50", unread: true, pos: 40 }, { id: "51", unread: true, pos: 41 }]);
  assert.equal(state.events.filter((e) => e.type === "unread-observed").length, 0);
  // A genuinely new conversation arrives at the top, and a read one becomes unread.
  inspectInbox(state, [{ id: "60", unread: true, pos: 0 }, { id: "1", unread: true, pos: 1 }, { id: "2", unread: true, pos: 2 }, { id: "50", unread: true, pos: 41 }]);
  assert.deepEqual(state.events.filter((e) => e.type === "unread-observed").map((e) => e.threadId), ["60", "1"]);
});

test("switching from the Chats list to the Marketplace list takes a fresh baseline", () => {
  const state = emptyState();
  setMode(state, "observe");
  inspectInbox(state, [{ id: "1", unread: true, pos: 0 }], { list: "chats-only" });
  // The Marketplace list opens: its top unread rows are backlog, not arrivals.
  inspectInbox(state, [{ id: "70", unread: true, pos: 0 }, { id: "71", unread: true, pos: 1 }], { list: "marketplace" });
  assert.equal(state.events.filter((e) => e.type === "unread-observed").length, 0);
  assert.equal(state.inboxBaseline.list, "marketplace");
  inspectInbox(state, [{ id: "72", unread: true, pos: 0 }, { id: "70", unread: true, pos: 1 }], { list: "marketplace" });
  assert.deepEqual(state.events.filter((e) => e.type === "unread-observed").map((e) => e.threadId), ["72"]);
});

test("activating Send after Observe leaves everything already unread for a person", () => {
  const state = emptyState();
  setMode(state, "observe");
  inspectInbox(state, [{ id: "100", unread: false }]);
  inspectInbox(state, [{ id: "100", unread: true }]); // arrived while observing
  setMode(state, "send", { allowThreads: ["100"] });
  assert.equal(inspectInbox(state, [{ id: "100", unread: true }]).open, null);
  assert.equal(inspectInbox(state, [{ id: "100", unread: true }]).open, null);
  assert.equal(publicStatus(state).baselineUnread, 1);
});

test("a service restart never restores Send", () => {
  const file = join(mkdtempSync(join(tmpdir(), "r2b-ledger-")), "state.json");
  const state = enabled("send", ["200"]);
  saveState(file, state);
  const restored = loadState(file);
  assert.equal(startupMode(restored), true);
  assert.equal(restored.mode, "off");
  assert.equal(restored.events.at(-1).type, "send-not-restored");
  assert.equal(inspectInbox(restored, [{ id: "200", unread: true }]).open, null);
  const observing = emptyState();
  setMode(observing, "observe");
  assert.equal(startupMode(observing), false);
  assert.equal(observing.mode, "observe");
});

test("Draft mode never gets a send instruction", () => {
  const state = enabled("draft", ["200"]);
  flag(state, "200");
  const decision = inspectThread(state, { threadId: "200", messages: [msg(1, "incoming", "Hi")] }, OPTS);
  const result = recordDraft(state, decision, { text: "Hello" });
  assert.equal(result.action, "none");
  assert.equal(result.draft, "Hello");
});

test("only the Marketplace list counts once lists are named; arrival reasons are recorded", () => {
  const state = emptyState();
  setMode(state, "observe");
  const base = [{ id: "1", unread: false, pos: 0, grid: "chats" }, { id: "10", unread: false, pos: 0, grid: "marketplace" },
    { id: "11", unread: true, pos: 1, grid: "marketplace" }, { id: "12", unread: true, pos: 2, grid: "marketplace" }];
  inspectInbox(state, base, { list: "marketplace" });
  assert.equal(state.inboxBaseline.unread.length, 2);
  // A friend's chat becomes unread: ignored. Conversation 12 (already unread,
  // pos 2) jumps to the top: a further message in an unanswered chat.
  inspectInbox(state, [{ id: "1", unread: true, pos: 0, grid: "chats" }, { id: "12", unread: true, pos: 0, grid: "marketplace" },
    { id: "10", unread: false, pos: 1, grid: "marketplace" }, { id: "11", unread: true, pos: 2, grid: "marketplace" }], { list: "marketplace" });
  const events = state.events.filter((e) => e.type === "unread-observed");
  assert.deepEqual(events.map((e) => [e.threadId, e.reason]), [["12", "moved-to-top"]]);
  // Removing the top row shifts the next one up by one: not an arrival.
  inspectInbox(state, [{ id: "10", unread: false, pos: 0, grid: "marketplace" }, { id: "11", unread: true, pos: 1, grid: "marketplace" }], { list: "marketplace" });
  inspectInbox(state, [{ id: "11", unread: true, pos: 0, grid: "marketplace" }], { list: "marketplace" });
  assert.equal(state.events.filter((e) => e.type === "unread-observed").length, 1);
});

test("the pilot refuses to start, or fails clearly, when the Marketplace list is not open", () => {
  const state = emptyState();
  setMode(state, "observe");
  state.authorisedAccount = "111"; state.heartbeat = { at: new Date().toISOString(), health: "healthy", account: "111", list: "chats-only", opener: "no-marketplace-control", rows: 13 };
  assert.throws(() => startPilot(state, { threadId: "500", mustContain: "Renault Master" }), /Marketplace list is not open/);
  state.heartbeat.list = "marketplace";
  startPilot(state, { threadId: "500", mustContain: "Renault Master" });
  // The list disappears (live 23 Nov: panel closed after a reload).
  state.heartbeat.list = "chats-only";
  pilotTimeout(state, Date.parse(state.pilot.requestedAt) + 10_000);
  assert.equal(state.pilot.status, "verifying", "short grace period");
  pilotTimeout(state, Date.parse(state.pilot.requestedAt) + 31_000);
  assert.equal(state.pilot.status, "failed");
  assert.match(state.pilot.error, /not open in the assistant tab \(chats-only\).*It was not opened/);
  assert.equal(state.mode, "observe");
  // With the list open but no row report, it fails after 90 s.
  state.heartbeat.list = "marketplace";
  startPilot(state, { threadId: "500", mustContain: "Renault Master" });
  pilotTimeout(state, Date.parse(state.pilot.requestedAt) + 91_000);
  assert.match(state.pilot.error, /did not report the conversation row/);
});

test("the pilot opens its one conversation only when the row text matches, drafts once, then returns to Observe", () => {
  const state = emptyState();
  setMode(state, "observe");
  state.authorisedAccount = "111"; state.heartbeat = { at: new Date().toISOString(), health: "healthy", account: "111", list: "marketplace", opener: "present", rows: 2 };
  inspectInbox(state, [{ id: "500", unread: true, pos: 0, grid: "marketplace" }, { id: "501", unread: true, pos: 1, grid: "marketplace" }], { list: "marketplace" });
  assert.throws(() => startPilot(state, { threadId: "500", mustContain: "" }));
  startPilot(state, { threadId: "500", mustContain: "Renault Master" });
  assert.equal(verifyPilot(state, { threadId: "500", found: true, rowText: "Sam · 2016 Ford Transit" }).ok, false);
  assert.equal(state.pilot.status, "mismatch");
  assert.equal(state.mode, "observe");
  assert.ok(!JSON.stringify(state.pilot).includes("Ford Transit"), "another customer's row text is not stored");

  startPilot(state, { threadId: "500", mustContain: "Renault Master" });
  assert.equal(verifyPilot(state, { threadId: "500", found: true, rowText: "Tester · 2015 Renault Master LWB" }).ok, true);
  assert.equal(state.mode, "draft");
  assert.deepEqual(state.allowThreads, ["500"]);
  // The list snapshot after the switch queues only the pilot conversation.
  assert.equal(inspectInbox(state, [{ id: "501", unread: true, pos: 0, grid: "marketplace" }, { id: "500", unread: true, pos: 1, grid: "marketplace" }], { list: "marketplace" }).open, "500");
  const snapshot = { threadId: "500", listingTitle: "2015 Renault Master LWB", listingId: "42", messages: [msg(1, "incoming", "Is this still available?")] };
  const decision = inspectThread(state, snapshot, OPTS);
  assert.equal(decision.action, "draft");
  const outcome = recordDraft(state, decision, { text: "Check the website: https://www.rent2buyvans.co.uk/" });
  assert.equal(outcome.action, "none");
  assert.equal(finishPilot(state, { snapshot, decision, outcome, askMeMs: 0 }), true);
  assert.equal(state.mode, "observe");
  assert.equal(state.pilot.status, "done");
  assert.equal(state.pilot.result.incoming, 1);
  assert.match(state.pilot.result.draft, /rent2buyvans/);
  assert.deepEqual(state.pendingOpen, []);
});

test("the monitoring verdict explains in plain words why monitoring is not working", () => {
  const state = emptyState();
  assert.equal(monitoringVerdict(state).ok, false);
  setMode(state, "observe");
  state.authorisedAccount = "111"; state.heartbeat = { at: new Date().toISOString(), health: "healthy", account: "111", list: "chats-only", opener: "no-marketplace-control", rows: 13 };
  assert.match(monitoringVerdict(state).reasons.join(" "), /Marketplace entry was not found/);
  state.heartbeat = { ...state.heartbeat, list: "marketplace", opener: "present" };
  inspectInbox(state, [{ id: "1", unread: false, pos: 0 }], { list: "marketplace" });
  assert.deepEqual(monitoringVerdict(state), { ok: true, reasons: [] });
  assert.match(monitoringVerdict(state, Date.now() + 300_000).reasons[0], /No report from the Edge assistant tab/);
});

test("a healthy Marketplace list for the locked account clears only the retry hold", () => {
  const state = enabled("observe");
  state.authorisedAccount = "111";
  state.openerHold = { at: new Date().toISOString(), reason: "Retry hold" };
  const recovered = { health: "healthy", account: "111", list: "marketplace", rows: 12, visibility: "hidden", opener: "present" };

  recordHeartbeat(state, { ...recovered, account: "222" });
  assert.ok(state.openerHold);
  recordHeartbeat(state, { ...recovered, rows: 0 });
  assert.ok(state.openerHold);
  recordHeartbeat(state, { ...recovered, opener: "tripped: conversation opened" });
  assert.ok(state.openerHold);
  recordHeartbeat(state, recovered);
  assert.ok(state.openerTrip, "a later ready list must preserve a real safety stop");
  assert.ok(state.openerHold);

  const retryOnly = enabled("observe");
  retryOnly.authorisedAccount = "111";
  retryOnly.openerHold = { at: new Date().toISOString(), reason: "Retry hold" };
  recordHeartbeat(retryOnly, recovered);
  assert.equal(retryOnly.openerHold, null);
  assert.equal(monitoringVerdict(retryOnly).ok, true);
  assert.ok(retryOnly.events.some((event) => event.type === "opener-hold-resolved"));
});

test("switching off between the claim and the send control cancels the send", () => {
  const state = enabled();
  flag(state, "200");
  const claim = recordDraft(state, inspectThread(state, { threadId: "200", messages: [msg(1, "incoming", "Hi")] }, OPTS), { text: "Hello" });
  setMode(state, "off");
  assert.equal(authoriseSend(state, claim.jobId).go, false);
});

test("a claimed reply is never repeated after a crash or restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "r2b-ledger-")), "state.json");
  const state = enabled();
  flag(state, "200");
  const snapshot = { threadId: "200", messages: [msg(1, "incoming", "Hi")] };
  const claim = recordDraft(state, inspectThread(state, snapshot, OPTS), { text: "Hello" });
  authoriseSend(state, claim.jobId);
  saveState(file, state);
  const restored = loadState(file);
  assert.equal(restored.threads["200"].jobs[0].status, "unconfirmed");
  assert.ok(restored.threads["200"].needsHuman);
  const later = inspectThread(restored, { threadId: "200", messages: [msg(1, "incoming", "Hi"), msg(2, "incoming", "Hello?")] }, OPTS);
  assert.equal(later.action, "none");
  assert.equal(authoriseSend(restored, claim.jobId).go, false);
  resumeThread(restored, "200");
  assert.equal(inspectThread(restored, { threadId: "200", messages: [msg(1, "incoming"), msg(2, "incoming"), msg(3, "incoming", "Still there?")] }, OPTS).action, "draft");
});

test("escalations stop automatic replies in that conversation", () => {
  const state = enabled();
  flag(state, "200");
  const decision = inspectThread(state, { threadId: "200", messages: [msg(1, "incoming", "I want to make a complaint")] }, OPTS);
  assert.equal(recordDraft(state, decision, { reason: "Customer needs the team" }).action, "none");
  assert.equal(inspectThread(state, { threadId: "200", messages: [msg(1, "incoming"), msg(2, "incoming", "Hello?")] }, OPTS).action, "none");
  assert.equal(publicStatus(state).needsHuman[0].reason, "Customer needs the team");
});

test("messages that arrived while the assistant was off are left for a person", () => {
  const state = enabled();
  inspectThread(state, { threadId: "300", messages: [msg(1, "incoming")] }, OPTS);
  setMode(state, "off");
  setMode(state, "send", { allowThreads: ["300"] });
  inspectInbox(state, []);
  assert.equal(inspectThread(state, { threadId: "300", messages: [msg(1, "incoming"), msg(2, "incoming", "Sent while off")] }, OPTS).action, "none");
});

test("listing titles decide the product; no default means a person decides", () => {
  const state = enabled();
  flag(state, "200");
  const d = inspectThread(state, { threadId: "200", listingTitle: "Van finance - Ford Transit", messages: [msg(1, "incoming", "Hi")] }, OPTS);
  assert.equal(d.product, "finance");
  const other = enabled();
  flag(other, "201");
  assert.equal(inspectThread(other, { threadId: "201", messages: [msg(1, "incoming", "Hi")] }, { defaultProduct: "" }).action, "none");
});

test("the live responder keeps one website Ask Me conversation per Facebook thread", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const payload = body.action === "start"
      ? { status: "ready", conversation_id: "conv-1" }
      : { status: "ready", reply: "The initial rental is due before collection.", actions: [] };
    return { ok: true, status: 200, json: async () => payload };
  };
  const thread = { id: "200", conversation: null };
  const respond = liveResponder(thread, { fetchImpl });
  const first = await draftMarketplaceReply({ product: "rent2buy", message: "When is the initial rental due?", history: [] }, { respond });
  await draftMarketplaceReply({ product: "rent2buy", message: "Is that refundable?", history: [{ role: "user", content: "x" }, { role: "assistant", content: first.text }] }, { respond });
  assert.equal(calls.filter((c) => c.body.action === "start").length, 1);
  assert.ok(calls.every((c) => c.url === "https://www.rent2buyvans.co.uk/api/jasmine"));
  assert.ok(calls.filter((c) => c.body.action === "message").every((c) => c.body.conversation_id === "conv-1"));
  assert.match(first.text, /https:\/\/www\.rent2buyvans\.co\.uk\//);
  const stock = await draftMarketplaceReply({ product: "rent2buy", message: "Is this van still available?", history: [] }, { respond });
  assert.match(stock.text, /rent2buyvans\.co\.uk/);
  assert.equal(calls.length, 3, "stock questions go to the website without an Ask Me call");
});

test("vehicle-specific Marketplace questions go to the website; general Rent2Buy questions go to Ask Me", async () => {
  const { marketplaceReplyRoute, RENT2BUY_WEBSITE } = await import("../dev/marketplace-reply-poc/reply-policy.mjs");
  for (const m of ["Hi, is this still available?", "How much per month is the Renault Master?", "What's the mileage on it?",
    "Can you hold it for me until Saturday?", "Is it manual or automatic?", "What year is it?", "Can you keep it for me until Friday?"]) {
    assert.ok(marketplaceReplyRoute("rent2buy", m)?.text?.includes(RENT2BUY_WEBSITE), m);
  }
  for (const m of ["How does Rent2Buy work?", "Do I need a deposit?", "How much is the initial rental?", "Can I return the van early?",
    "Can I keep the van at the end?", "Can I apply if I'm self-employed?", "What happens if I go over the mileage?"]) {
    assert.equal(marketplaceReplyRoute("rent2buy", m), null, m);
  }
  for (const m of ["Will I be approved?", "I want to speak to someone please", "I want to make a complaint"]) {
    assert.equal(marketplaceReplyRoute("rent2buy", m)?.reason, "Customer needs the team", m);
  }
});

test("the finder needs the Marketplace list, records only IDs, and times out clearly; mismatches report word hits without text", async () => {
  const { startFind, recordFind, findTimeout } = await import("../dev/marketplace-reply-poc/edge-live/ledger.mjs");
  const state = emptyState();
  setMode(state, "observe");
  state.authorisedAccount = "111"; state.heartbeat = { at: new Date().toISOString(), health: "healthy", account: "111", list: "chats-only", rows: 13 };
  assert.throws(() => startFind(state, { words: "Renault Master" }), /not open/);
  state.heartbeat.list = "marketplace";
  startFind(state, { words: "Renault Master" });
  assert.equal(recordFind(state, { words: "other", matches: [] }).ok, false);
  recordFind(state, { words: "Renault Master", searched: 74, matches: [{ id: "400", pos: 0, grid: "marketplace", unread: true, text: "Tester Renault Master" }] });
  assert.deepEqual(state.finder.matches, [{ id: "400", pos: 0, grid: "marketplace", unread: true }]);
  assert.ok(!JSON.stringify(state.finder).includes("Tester"));
  startFind(state, { words: "Ford" });
  findTimeout(state, Date.parse(state.finder.requestedAt) + 61_000);
  assert.equal(state.finder.status, "failed");

  startPilot(state, { threadId: "400", mustContain: "Renault Master" });
  verifyPilot(state, { threadId: "400", found: true, rowText: "Sam Jones · 2016 Renault Trafic SWB" });
  assert.deepEqual(state.pilot.wordHits, { renault: true, master: false });
  assert.equal(state.pilot.rowWords, 7);
  assert.ok(!JSON.stringify(state.pilot).includes("Trafic"));
});

test("the safety stop is service-wide: set by any tab's trip, carried over, cleared only by the owner's reset", async () => {
  const { migrateSafetyStop, resetSafetyStop, recordHeartbeat: hb } = await import("../dev/marketplace-reply-poc/edge-live/ledger.mjs");
  const state = emptyState();
  setMode(state, "observe");
  hb(state, { health: "healthy", list: "chats", opener: "tripped: a new docked chat window appeared after a click with no sign of an incoming message (1 -> 2); opener disabled", rows: 13 });
  assert.match(state.openerTrip.reason, /^a new docked chat window/);
  // A brand-new tab reports a normal status: the stop stays.
  hb(state, { health: "healthy", list: "chats", opener: "clicked Messenger", rows: 13 });
  assert.ok(state.openerTrip);
  assert.match(publicStatus(state).monitoring.reasons.join(" "), /Safety stop is set/);
  resetSafetyStop(state);
  assert.equal(state.openerTrip, null);
  assert.equal(state.resetOpenerRequested, true);
  // Carry-over of a trip logged before the stop moved into the service.
  const old = emptyState();
  logEventForTest(old, "safety-reset", "2026-11-23T21:28:10.000Z");
  logEventForTest(old, "list-opener", "2026-11-23T21:29:10.000Z", { status: "tripped: a new docked chat window appeared after a click (1 -> 2); opener disabl" });
  assert.equal(migrateSafetyStop(old), true);
  assert.equal(old.openerTrip.carriedOver, true);
  const cleared = emptyState();
  logEventForTest(cleared, "list-opener", "2026-11-23T21:29:10.000Z", { status: "tripped: x; opener disabled" });
  logEventForTest(cleared, "safety-reset", "2026-11-23T21:30:00.000Z");
  assert.equal(migrateSafetyStop(cleared), false, "a trip already reset is not carried over");
});

function logEventForTest(state, type, at, detail = {}) { state.events.push({ at, type, ...detail }); }

test("account lock: wrong account, signed out, unidentified or ineligible pauses everything", async () => {
  const { accountProblem, authoriseAccount, permitOpenerClick } = await import("../dev/marketplace-reply-poc/edge-live/ledger.mjs");
  const state = emptyState();
  setMode(state, "observe");
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "marketplace", account: "111", rows: 5 };
  assert.match(accountProblem(state), /No Facebook account is authorised/);
  authoriseAccount(state, "111");
  assert.equal(accountProblem(state), null);
  state.heartbeat.account = "222"; // e.g. the Vansco account
  assert.match(accountProblem(state), /^Wrong Facebook account: signed in as 222, authorised account is 111/);
  assert.throws(() => startPilot(state, { threadId: "5", mustContain: "^Van + Nissan" }), /Wrong Facebook account/);
  assert.equal(permitOpenerClick(state).ok, false);
  state.heartbeat.account = null;
  assert.match(accountProblem(state), /cannot be identified/);
  state.heartbeat = { ...state.heartbeat, account: "111", health: "signed-out" };
  assert.match(accountProblem(state), /^Login required/);
  state.heartbeat.health = "marketplace-unavailable";
  assert.match(accountProblem(state), /^Marketplace unavailable/);
  assert.match(publicStatus(state).monitoring.reasons.join(" "), /Marketplace unavailable/);
});

test("retry limit: growing delays, hold after 8 attempts, retried every 30 minutes while on hold; success resets the series", async () => {
  const { authoriseAccount, permitOpenerClick, resetSafetyStop, recordHeartbeat: hb } = await import("../dev/marketplace-reply-poc/edge-live/ledger.mjs");
  const state = emptyState();
  setMode(state, "observe");
  authoriseAccount(state, "111");
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "chats", account: "111", rows: 5 };
  let now = 1_000_000;
  const delays = [];
  for (let i = 0; i < 8; i++) {
    let wait = 0;
    while (!permitOpenerClick(state, now).ok) { now += 1_000; wait += 1_000; }
    delays.push(wait);
  }
  assert.deepEqual(delays, [0, 20_000, 40_000, 80_000, 160_000, 320_000, 600_000, 600_000]);
  now += 600_000;
  const held = permitOpenerClick(state, now);
  assert.equal(held.hold, true);
  assert.match(held.reason, /after 8 attempts/);
  assert.equal(permitOpenerClick(state, now + 60_000).ok, false, "on hold a minute later");
  assert.equal(permitOpenerClick(state, now + 1_800_000).ok, true, "one automatic retry after 30 minutes");
  assert.equal(permitOpenerClick(state, now + 1_800_000 + 1_000).ok, false, "then on hold again for 30 minutes");
  assert.match(publicStatus(state).monitoring.reasons.join(" "), /Opener on hold/);
  resetSafetyStop(state);
  assert.equal(permitOpenerClick(state, now).ok, true);
  hb(state, { health: "healthy", list: "marketplace", account: "111", opener: "present", rows: 5 });
  assert.equal(state.openerAttempts.count, 0, "a successful open resets the series");
});

test("monitoring continues across an approved send: an enquiry arriving during or right after it is still reported", async () => {
  const { authoriseAccount, approveSend, recordSendResult, authoriseSend } = await import("../dev/marketplace-reply-poc/edge-live/ledger.mjs");
  const state = emptyState();
  setMode(state, "observe");
  authoriseAccount(state, "111");
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "marketplace", account: "111", rows: 3 };
  const list = (rows) => inspectInbox(state, rows.map((r, pos) => ({ ...r, pos, grid: "marketplace" })), { list: "marketplace" });
  list([{ id: "1", unread: false }, { id: "2", unread: false }]); // baseline
  state.threads["1"] = { id: "1", listingId: "9", jobs: [{ id: "j", status: "draft", text: "Hello https://x/", customer: "Hi" }], seen: ["m1"], history: [] };
  approveSend(state, { threadId: "1", jobId: "j", text: "Hello https://x/" });
  assert.equal(list([{ id: "1", unread: false }, { id: "2", unread: false }]).open, "1", "the approved conversation opens");
  const send = inspectThread(state, { threadId: "1", listingId: "9", messages: [{ id: "m1", direction: "incoming", text: "Hi" }] }, OPTS);
  assert.equal(send.action, "send");
  // Enquiry 2 arrives while the reply is being sent.
  list([{ id: "3", unread: true }, { id: "1", unread: false }, { id: "2", unread: false }]);
  authoriseSend(state, send.jobId);
  recordSendResult(state, send.jobId, { confirmed: true, outgoingId: "o1" });
  assert.equal(state.mode, "observe");
  assert.ok(state.inboxBaseline, "the list snapshot is kept, not retaken");
  // Enquiry 3 arrives right after the send: reported as a new arrival.
  list([{ id: "4", unread: true }, { id: "3", unread: true }, { id: "1", unread: false }, { id: "2", unread: false }]);
  const reported = state.events.filter((e) => ["unread-observed", "unread-not-opened"].includes(e.type)).map((e) => e.threadId);
  assert.deepEqual(reported, ["3", "4"]);
});

// ---- Automatic replies with catch-up (mode "auto") ----
import { recordHeartbeat as beatAuto, messageTime, confidentRent2Buy, permitOpenerClick as permitAuto } from "../dev/marketplace-reply-poc/edge-live/ledger.mjs";
const R2B_TITLE = "Marketplace £535 – 2023 Ford Deliver 9 - Visit us at Rent2BuyVans.co.uk View buyer More Options";
const LINK = "https://www.rent2buyvans.co.uk/";
const FROM = Date.parse("2026-11-24T12:00:00.000Z");
// A Facebook-format message ID carrying the given send time (bits 111-151).
function mid(ms, salt = 1) {
  const big = (0x80n << 160n) | (BigInt(ms) << 16n) | BigInt(salt & 0xffff);
  return "mid.$" + Buffer.from(big.toString(16).padStart(42, "0"), "hex").toString("base64url") + "x";
}
const at = (hhmm) => Date.parse("2026-11-24T" + hhmm + ":00.000Z");
const cust = (hhmm, text = "Hello", salt = 1) => ({ id: mid(at(hhmm), salt), direction: "incoming", text });
const ours = (hhmm, text = "Our reply " + LINK) => ({ id: mid(at(hhmm), 9), direction: "outgoing", text });
function autoOn(now = at("13:30")) {
  const state = emptyState();
  state.authorisedAccount = "1";
  beatAuto(state, { health: "healthy", list: "marketplace", account: "1", rows: 3 });
  setMode(state, "observe");
  setMode(state, "auto");
  inspectInbox(state, [{ id: "100", unread: true }]); // first snapshot
  return state;
}
const open = (state, id, messages, title = R2B_TITLE) => {
  if (!state.pendingOpen.includes(id)) state.pendingOpen.push(id);
  return inspectThread(state, { threadId: id, listingId: "1784523559333260", listingTitle: title, messages }, OPTS);
};
const answer = (state, decision, text = "Ask Me answer.\n\nYou can browse current vans and apply online at " + LINK) => {
  const send = recordDraft(state, decision, { text });
  if (send.action !== "send") return send;
  assert.deepEqual(authoriseSend(state, send.jobId), { go: true });
  recordSendResult(state, send.jobId, { confirmed: true, outgoingId: mid(Date.now() - 1000, 7) });
  return send;
};

test("message IDs carry a verifiable send time; anything else is unknown", () => {
  assert.equal(new Date(messageTime("mid.$gAAQfrD0VH-KoPuV18WiDaAsKWL7-")).toISOString(), "2026-11-24T12:55:30.601Z");
  assert.equal(new Date(messageTime("7530977511398328435")).toISOString(), "2026-11-24T12:55:57.513Z");
  assert.equal(messageTime(mid(at("12:10"))), at("12:10"));
  assert.equal(messageTime("mid.$in12"), null);
  assert.equal(messageTime(mid(Date.now() + 3_600_000)), null, "a time in the future is not trusted");
});

test("catch-up answers only unanswered customer messages since 12:00, batched into one reply", () => {
  const state = autoOn();
  // Before the cutoff: excluded.
  assert.equal(open(state, "200", [cust("11:50", "old question")]).action, "none");
  // Two unanswered messages after the cutoff (an older one before it is excluded): one reply.
  const d = open(state, "300", [cust("11:40", "very old"), ours("11:45"), cust("12:05", "Do I need a deposit?", 2), cust("12:06", "And can I pay weekly?", 3)]);
  assert.equal(d.action, "draft");
  assert.equal(d.auto, true);
  assert.equal(d.message, "Do I need a deposit?\nAnd can I pay weekly?");
  assert.equal(d.messageIds.length, 2);
  assert.equal(answer(state, d).action, "send");
  // Already answered: reopening sends nothing.
  assert.equal(open(state, "300", [cust("12:05", "Do I need a deposit?", 2), cust("12:06", "And can I pay weekly?", 3), ours("12:07")]).action, "none");
  // Even if our reply is not visible yet, the ledger knows those IDs were answered.
  assert.equal(open(state, "300", [cust("12:05", "Do I need a deposit?", 2), cust("12:06", "And can I pay weekly?", 3)]).action, "none");
  // A follow-up question later is answered too (no one-reply limit).
  const f = open(state, "300", [cust("12:05", "x", 2), cust("12:06", "y", 3), ours("12:07"), cust("12:40", "How long does approval take?", 4)]);
  assert.equal(f.action, "draft");
  assert.equal(f.message, "How long does approval take?");
  assert.equal(answer(state, f).action, "send");
});

test("a message whose time cannot be verified, an unclear listing, a handover, an Ask Me error or a reply without the link never sends", () => {
  const cases = [
    ["time unknown", [{ id: "mid.$in12", direction: "incoming", text: "hi" }], R2B_TITLE, { text: "Answer " + LINK }],
    ["Van Finance advert", [cust("12:10")], "2019 Ford Transit - Visit us at vanfinancecompany.co.uk", { text: "Answer " + LINK }],
    ["no Rent2Buy in title", [cust("12:10")], "2019 Ford Transit Custom", { text: "Answer " + LINK }],
    ["human handover", [cust("12:10")], R2B_TITLE, { reason: "Customer needs the team" }],
    ["Ask Me error", [cust("12:10")], R2B_TITLE, { reason: "Ask Me unavailable: Ask Me returned HTTP 503" }],
    ["no link", [cust("12:10")], R2B_TITLE, { text: "Answer without the website." }],
  ];
  for (const [name, messages, title, draft] of cases) {
    const state = autoOn();
    state.financeFrom = "2026-11-24T00:00:00.000Z"; // finance support installed; finance auto still off
    const d = open(state, "600", messages, title);
    if (d.action === "draft") assert.equal(recordDraft(state, d, draft).action, "none", name);
    assert.equal(state.events.some((e) => e.type === "claim"), false, name);
    assert.ok(state.threads["600"].needsHuman, name + " is left for a person");
  }
  assert.equal(confidentRent2Buy(R2B_TITLE), true);
  assert.equal(confidentRent2Buy("Rent2Buy - Van Finance Company"), false);
});

test("rows with customer activity since the cutoff are queued once; ours, older or already-checked rows are not", () => {
  const now = Date.now();
  const state = autoOn();
  state.autoFrom = new Date(now - 3 * 3_600_000).toISOString(); // cutoff 3 hours ago
  const rows = [
    { id: "100", unread: true, pos: 0, age: "now", you: false },   // customer just wrote
    { id: "110", unread: false, pos: 1, age: "5m", you: true },    // we replied last
    { id: "120", unread: false, pos: 2, age: "2h", you: false },   // within the window
    { id: "130", unread: true, pos: 3, age: "4h", you: false },    // before the cutoff
    { id: "140", unread: true, pos: 4, age: null, you: false },    // age unknown
  ];
  inspectInbox(state, rows);
  // 140 is a new unread arrival with no readable age: opened and checked by message time.
  assert.deepEqual(state.pendingOpen, ["140", "100", "120"]);
  open(state, "140", [cust("11:00")]);
  // Once checked, the same rows are not queued again until there is newer activity.
  open(state, "100", [cust("12:10")]);
  open(state, "120", [cust("12:10")]);
  state.pendingOpen = [];
  inspectInbox(state, rows);
  assert.deepEqual(state.pendingOpen, []);
  state.autoChecked["100"] = new Date(now - 120_000).toISOString(); // checked 2 minutes ago, new message now
  inspectInbox(state, rows);
  assert.deepEqual(state.pendingOpen, ["100"]);
  // A conversation that cannot be read within 4 minutes is dropped and left for a person.
  state.autoQueuedAt["100"] = new Date(now - 300_000).toISOString();
  inspectInbox(state, [{ id: "100", unread: true, pos: 0, age: "4m", you: false }]);
  assert.deepEqual(state.pendingOpen, []);
  assert.equal(state.events.findLast((e) => e.type === "left-for-person").threadId, "100");
});

test("Auto stays on after a restart; STOP cancels a claimed reply; 2 unconfirmed sends stop Auto; the opener recovers by itself", () => {
  const restarted = autoOn();
  assert.equal(startupMode(restarted), false);
  assert.equal(restarted.mode, "auto");

  const stopped = autoOn();
  const send = recordDraft(stopped, open(stopped, "900", [cust("12:10")]), { text: "Answer " + LINK });
  assert.equal(send.action, "send");
  setMode(stopped, "off");
  assert.equal(authoriseSend(stopped, send.jobId).go, false);

  const failing = autoOn();
  for (const id of ["801", "802"]) {
    const s = recordDraft(failing, open(failing, id, [cust("12:10")]), { text: "Answer " + LINK });
    recordSendResult(failing, s.jobId, { confirmed: false, error: "No message appeared" });
  }
  assert.equal(failing.mode, "observe");
  assert.equal(failing.events.at(-1).type, "auto-stopped");
});

// ---- Van Finance support (25 Nov 2026) ----
const VFC_TITLE = "Marketplace £9,995 – 2019 Ford Transit Custom - Visit us at VanFinanceCompany.co.uk View buyer More Options";
const VFC_LINK = "https://www.vanfinancecompany.co.uk/";
const financeReady = () => { const s = autoOn(); s.financeFrom = "2026-11-24T00:00:00.000Z"; return s; };

test("products come from the advert title and domain; unidentified or ambiguous go to a person", () => {
  assert.equal(resolveProduct(R2B_TITLE), "rent2buy");
  assert.equal(resolveProduct(VFC_TITLE), "finance");
  assert.equal(resolveProduct("2019 Ford Transit - vanfinancecompany.co.uk"), "finance");
  assert.equal(resolveProduct("Rent2Buy - Van Finance Company"), null, "ambiguous");
  assert.equal(resolveProduct("2019 Ford Transit Custom"), null, "unidentified, no default");
  const state = financeReady();
  if (!state.pendingOpen.includes("650")) state.pendingOpen.push("650");
  const d = inspectThread(state, { threadId: "650", listingId: "1", listingTitle: "2019 Ford Transit Custom", messages: [cust("12:10")] }, {});
  assert.equal(d.action, "none");
  assert.equal(state.threads["650"].needsHuman, "No verified listing product");
  assert.equal(state.threads["650"].product, null, "not classified as Rent2Buy in the CRM");
});

test("verified finance adverts auto-reply only with the switch on and the finance link", () => {
  const state = financeReady();
  state.financeAuto = true;
  const d = open(state, "660", [cust("12:10", "Can I get finance if I'm self-employed?")], VFC_TITLE);
  assert.equal(d.action, "draft");
  assert.equal(d.product, "finance");
  assert.equal(answer(state, d, "Yes, self-employed applicants can apply.\n\nYou can find out more and apply online at " + VFC_LINK).action, "send");
  const noLink = financeReady(); noLink.financeAuto = true;
  const d2 = open(noLink, "661", [cust("12:10")], VFC_TITLE);
  assert.equal(recordDraft(noLink, d2, { text: "Answer " + LINK }).action, "none", "Rent2Buy link is not enough");
  assert.match(noLink.threads["661"].needsHuman, /Van Finance website link/);
});

test("finance switch off: reply is held for a person and reported as needs_human", () => {
  const state = financeReady();
  const d = open(state, "670", [cust("12:10")], VFC_TITLE);
  assert.equal(recordDraft(state, d, { text: "Answer " + VFC_LINK }).action, "none");
  assert.match(state.threads["670"].needsHuman, /Van Finance automatic replies are not switched on/);
  assert.ok(state.events.some((e) => e.type === "escalate" && e.threadId === "670"), "CRM sees it as needing a person");
  assert.equal(state.events.some((e) => e.type === "claim"), false);
});

test("blocked Rent2Buy replies are also reported as needs_human", () => {
  const state = autoOn();
  const d = open(state, "675", [cust("12:10")]);
  assert.equal(recordDraft(state, d, { text: "Answer without the website." }).action, "none");
  assert.ok(state.events.some((e) => e.type === "escalate" && e.threadId === "675"));
});

test("historical finance conversations are never answered automatically", () => {
  const state = autoOn();
  state.financeFrom = new Date(at("12:30")).toISOString();
  state.financeAuto = true;
  const d = open(state, "680", [cust("12:10", "Old finance question")], VFC_TITLE);
  assert.equal(d.action, "none");
  assert.equal(state.threads["680"].needsHuman, null, "not reopened or flagged");
  const noStart = autoOn(); noStart.financeAuto = true; // no financeFrom recorded: everything is history
  assert.equal(open(noStart, "681", [cust("12:10")], VFC_TITLE).action, "none");
  const loaded = loadState(join(mkdtempSync(join(tmpdir(), "fbm-")), "missing.json"));
  assert.equal(loaded.financeAuto, undefined, "finance auto is off by default");
});

test("finance questions route to the Van Finance Ask Me engine with safe wording", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => (body.action === "start" ? { status: "ready", conversation_id: "c1" } : { status: "ready", reply: "Yes, you can apply." }) };
  };
  const thread = { id: "690" };
  const draft = await draftMarketplaceReply({ product: "finance", message: "Can I apply if I'm a sole trader?" }, { respond: liveResponder(thread, { fetchImpl }) });
  assert.ok(urls.every((u) => u.startsWith("https://www.vanfinancecompany.co.uk/api/jasmine")));
  assert.equal(draft.text, "Yes, you can apply.\n\nYou can find out more and apply online at " + VFC_LINK);
  const disclaimer = await draftMarketplaceReply({ product: "finance", message: "Bad credit?" }, { respond: async () => ({ status: "ready", reply: "You can apply. Approval isn’t guaranteed; it depends on affordability." }) });
  assert.ok(disclaimer.text, "a not-guaranteed disclaimer is safe");
  for (const unsafe of ["You are guaranteed approval.", "Rates from 9.9% APR.", "It would be £250 per month.", "This van is still available."]) {
    const held = await draftMarketplaceReply({ product: "finance", message: "Tell me more" }, { respond: async () => ({ status: "ready", reply: unsafe }) });
    assert.ok(held.reason && !held.text, unsafe);
  }
});

test("short-term hire enquiries get a polite no with the right website", async () => {
  for (const [product, link] of [["rent2buy", LINK], ["finance", VFC_LINK]]) {
    for (const message of ["Do you do daily hire?", "Can I hire a van for the weekend?", "Looking for short term van rental", "What's your day rate?"]) {
      const draft = await draftMarketplaceReply({ product, message }, { respond: async () => { throw new Error("should not reach Ask Me"); } });
      assert.match(draft.text, /don't offer daily or short-term van hire/, message);
      assert.ok(draft.text.includes(link), product + " link");
    }
  }
  const weekly = await draftMarketplaceReply({ product: "rent2buy", message: "Is the weekly rental fixed?" }, { respond: async () => ({ status: "ready", reply: "Yes." }) });
  assert.doesNotMatch(weekly.text, /short-term/, "Rent2Buy weekly rental is not short-term hire");
});
