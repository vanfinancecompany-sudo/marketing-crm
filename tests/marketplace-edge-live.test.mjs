import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authoriseSend, emptyState, inspectInbox, inspectThread, loadState, publicStatus, recordDraft,
  recordSendResult, resumeThread, saveState, setMode, startupMode, startPilot, verifyPilot, finishPilot, monitoringVerdict, pilotTimeout,
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
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "chats-only", opener: "no-marketplace-control", rows: 13 };
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
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "marketplace", opener: "present", rows: 2 };
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
  state.heartbeat = { at: new Date().toISOString(), health: "healthy", list: "chats-only", opener: "no-marketplace-control", rows: 13 };
  assert.match(monitoringVerdict(state).reasons.join(" "), /Marketplace entry was not found/);
  state.heartbeat = { ...state.heartbeat, list: "marketplace", opener: "present" };
  inspectInbox(state, [{ id: "1", unread: false, pos: 0 }], { list: "marketplace" });
  assert.deepEqual(monitoringVerdict(state), { ok: true, reasons: [] });
  assert.match(monitoringVerdict(state, Date.now() + 300_000).reasons[0], /No report from the Edge assistant tab/);
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
