// Durable decision ledger for the live Edge Marketplace assistant.
//
// The browser extension reports what it sees; this ledger alone decides whether a
// reply may be drafted or sent. Every decision is persisted before the extension
// is told to act, so a browser crash, Edge restart or Windows reboot can never
// cause the same customer message to be answered twice.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RENT2BUY_WEBSITE } from "../reply-policy.mjs";

// "auto": automatic replies to brand-new Rent2Buy conversations only (see the
// Automatic replies section). Never restored after a restart.
export const MODES = ["off", "observe", "draft", "send", "auto"];
const THREAD_ID = /^\d{1,32}$/;
const MESSAGE_ID = /^[\w.:$-]{1,200}$/;
const MAX_SEEN = 400;
const MAX_EVENTS = 300;
const OPEN_JOB = new Set(["claimed", "typed"]);

export function emptyState() {
  return {
    version: 1,
    mode: "off",
    allowAll: false,
    allowThreads: [],
    enabledAt: null,
    inboxBaseline: null,
    pendingOpen: [],
    observedUnread: [],
    threads: {},
    events: [],
    heartbeat: null,
  };
}

export function loadState(file) {
  try {
    const state = { ...emptyState(), ...JSON.parse(readFileSync(file, "utf8")) };
    // A send instruction that was handed out but never reported back is
    // treated as unconfirmed after a restart. It is never repeated.
    for (const thread of Object.values(state.threads)) {
      for (const job of thread.jobs) {
        if (OPEN_JOB.has(job.status)) {
          job.status = "unconfirmed";
          thread.needsHuman ??= "A reply was being sent when the assistant stopped. Check the conversation.";
        }
      }
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

// Called once when the service starts. Send is never restored from disk: after
// any restart (service, Edge or Windows) it must be switched on deliberately.
// Carry a trip recorded before the stop moved into the service: the last
// "tripped" opener event after the last owner reset.
export function migrateSafetyStop(state) {
  if (state.openerTrip) return false;
  const lastReset = state.events.findLast((e) => e.type === "safety-reset")?.at || "";
  const trip = state.events.findLast((e) => e.type === "list-opener" && /^tripped: /.test(e.status || "") && e.at > lastReset);
  if (!trip) return false;
  state.openerTrip = { at: trip.at, reason: trip.status.replace(/^tripped: /, "").replace(/; opener disabl.*$/, ""), carriedOver: true };
  logEvent(state, "safety-stop", { reason: state.openerTrip.reason, carriedOver: true });
  return true;
}

// ---- Facebook account lock ----
// The assistant works only in the owner's authorised seller account. Anything
// else (another account such as Vansco, signed out, unidentifiable, or
// Marketplace unavailable) pauses it: no clicks, navigation, reads or sends.
export function authoriseAccount(state, id) {
  const account = String(id || "");
  if (!/^\d{1,32}$/.test(account)) throw new TypeError("No Facebook account to authorise");
  state.authorisedAccount = account;
  logEvent(state, "account-authorised", { account });
}

export function accountProblem(state) {
  const hb = state.heartbeat;
  if (!hb) return "The Edge assistant tab has not reported yet";
  if (hb.health === "signed-out") return "Login required: Facebook is signed out in the assistant tab";
  if (hb.health === "security-challenge") return "Facebook is showing a security check in the assistant tab";
  if (hb.health === "marketplace-unavailable") return "Marketplace unavailable: Facebook shows the Marketplace ineligible page for the signed-in account";
  if (!state.authorisedAccount) return "No Facebook account is authorised yet";
  if (!hb.account) return "Facebook account cannot be identified in the assistant tab";
  if (hb.account !== state.authorisedAccount) return "Wrong Facebook account: signed in as " + hb.account + ", authorised account is " + state.authorisedAccount;
  return null;
}

// ---- Retry limit for opening the Marketplace list ----
// Every list-opening click needs the service's permission. Delays grow from 20 s
// to 10 min; after 8 failed attempts the opener retries on a 30-minute hold.
// Counted here, so reloads and restarts cannot start a fresh series.
const OPENER_MAX_ATTEMPTS = 8;
const OPENER_HOLD_RETRY_MS = 1_800_000;
export function permitOpenerClick(state, now = Date.now()) {
  const problem = accountProblem(state);
  if (problem) return { ok: false, hold: true, reason: problem };
  if (state.openerHold) {
    // Automatic recovery without the owner: while on hold, one attempt every 30
    // minutes (the idle-only visibility assist can then reopen the list).
    const last = Date.parse(state.openerHold.lastTryAt || state.openerHold.at);
    if (now - last < OPENER_HOLD_RETRY_MS) return { ok: false, hold: true, reason: state.openerHold.reason };
    state.openerHold.lastTryAt = new Date(now).toISOString();
    return { ok: true, attempt: "hold retry" };
  }
  const a = (state.openerAttempts ??= { count: 0, lastAt: 0 });
  const delay = a.count ? Math.min(20_000 * 2 ** (a.count - 1), 600_000) : 0;
  // During an owner-requested show the delay is skipped; the attempt still counts.
  const ownerShow = (state.showUntil && now < Date.parse(state.showUntil)) || state.heartbeat?.visibility === "visible";
  if (!ownerShow && now - a.lastAt < delay) return { ok: false, reason: "waiting for the retry delay" };
  if (a.count >= OPENER_MAX_ATTEMPTS) {
    state.openerHold = { at: new Date(now).toISOString(), reason: "The Marketplace list could not be opened after " + OPENER_MAX_ATTEMPTS + " attempts. Retrying every 30 minutes; press \"Reset safety stop\" to try now." };
    logEvent(state, "opener-hold", { reason: state.openerHold.reason });
    return { ok: false, hold: true, reason: state.openerHold.reason };
  }
  a.count++;
  a.lastAt = now;
  return { ok: true, attempt: a.count };
}

export function resetSafetyStop(state) {
  const had = Boolean(state.openerTrip || state.openerHold);
  state.openerTrip = null;
  state.openerHold = null;
  state.openerAttempts = { count: 0, lastAt: 0 };
  state.resetOpenerRequested = true;
  logEvent(state, "safety-reset", { requested: true, hadStop: had });
}

// Auto stays on after a restart (owner's decision, 24 Nov 2026): it acts only
// once the account lock and the Marketplace list check pass, and catches up
// from the persisted ledger. Owner-approved Send is never restored.
export function startupMode(state) {
  if (state.mode !== "send") return false;
  setMode(state, "off");
  logEvent(state, "send-not-restored", { reason: "Service restarted; Send must be switched on again" });
  return true;
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const pending = file + "." + process.pid + ".next";
  writeFileSync(pending, JSON.stringify(state, null, 1), { encoding: "utf8", mode: 0o600 });
  renameSync(pending, file);
}

export function logEvent(state, type, detail = {}) {
  state.events.push({ at: new Date().toISOString(), type, ...detail });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

const TEST_BUYER_NAME = /^\p{L}[\p{L} '.-]{1,39}$/u;
export function setMode(state, mode, { allowThreads, allowAll, testBuyer } = {}) {
  if (!MODES.includes(mode)) throw new TypeError("Unknown mode");
  // Auto may be limited to one named test buyer (for example "Van"). Cleared
  // whenever Auto ends.
  if (mode === "auto") {
    // An invalid name is refused, never silently widened to everyone.
    if (testBuyer && !TEST_BUYER_NAME.test(String(testBuyer).trim())) throw new TypeError("Invalid test buyer name");
    if (testBuyer !== undefined) state.autoTestBuyer = testBuyer ? String(testBuyer).trim() : null;
  } else {
    state.autoTestBuyer = null;
    state.autoCheck = [];
  }
  // Off and Observe are passive: neither opens conversations nor records
  // message history. Activating Draft or Send from either takes a fresh
  // baseline, so nothing that arrived while passive is answered automatically.
  const wasOff = ["off", "observe"].includes(state.mode) && ["draft", "send", "auto"].includes(mode);
  if (mode === "auto" && state.mode !== "auto") state.autoFailures = 0;
  state.mode = mode;
  if (Array.isArray(allowThreads)) state.allowThreads = allowThreads.filter((id) => THREAD_ID.test(String(id))).map(String);
  if (typeof allowAll === "boolean") state.allowAll = allowAll;
  if (mode === "off" || mode === "observe") {
    state.enabledAt = mode === "observe" ? new Date().toISOString() : null;
    state.inboxBaseline = null;
    state.pendingOpen = [];
    state.observedUnread = [];
  } else if (wasOff) {
    // Everything already unread when the assistant is switched on is left
    // for a person. Only conversations that become unread afterwards count.
    state.enabledAt = new Date().toISOString();
    state.inboxBaseline = null;
    // Messages that arrived while the assistant was off belong to a person.
    for (const thread of Object.values(state.threads)) thread.rebaseline = true;
  }
  logEvent(state, "mode", { mode, allowAll: state.allowAll, allowThreads: state.allowThreads });
}

// Internal switches for a pilot or an approved send keep the list snapshot, so
// an enquiry arriving at that moment is still reported (monitoring continues).
function switchMode(state, mode, opts) {
  const baseline = state.inboxBaseline;
  setMode(state, mode, opts);
  if (baseline) state.inboxBaseline = baseline;
}

export function recordHeartbeat(state, { health, visibility, url, rows, unread, list, opener, ext, account }) {
  const previous = state.heartbeat;
  state.heartbeat = {
    at: new Date().toISOString(), health: String(health || "unknown"), visibility: String(visibility || ""),
    url: String(url || "").slice(0, 200), rows: Number(rows) || 0, unread: Number(unread) || 0,
    list: String(list || "none").slice(0, 40), opener: String(opener || "").slice(0, 160),
    ext: typeof ext === "string" ? ext.slice(0, 20) : null,
    account: typeof account === "string" && /^\d{1,32}$/.test(account) ? account : null,
  };
  if (list === "marketplace" && state.openerAttempts?.count) state.openerAttempts = { count: 0, lastAt: 0 };
  if (state.mode !== "off" && health !== previous?.health && health !== "healthy" && health !== "loading") {
    logEvent(state, "health", { health });
  }
  // Log opener changes by kind (ignoring the click method in brackets), and a
  // repeated kind at most every 10 minutes, so retries never flood the log.
  const kind = (value) => String(value || "").replace(/\s*\(.*$/, "");
  // A trip reported by ANY assistant tab sets the service-wide safety stop. It
  // survives new tabs, reloads and restarts; only the owner's reset clears it.
  if (/^tripped: /.test(String(opener || "")) && !state.openerTrip) {
    state.openerTrip = { at: new Date().toISOString(), reason: String(opener).replace(/^tripped: /, "").replace(/; opener disabled$/, "").slice(0, 200) };
    logEvent(state, "safety-stop", { reason: state.openerTrip.reason });
  }
  if (state.openerHold && !state.openerTrip && !/^disabled/.test(state.heartbeat.opener) &&
      state.heartbeat.health === "healthy" && state.heartbeat.list === "marketplace" &&
      state.heartbeat.rows > 0 && !accountProblem(state)) {
    state.openerHold = null;
    logEvent(state, "opener-hold-resolved", { rows: state.heartbeat.rows });
  }
  if (state.mode !== "off" && opener && opener !== previous?.opener && !/^(?:present|waiting)/.test(opener)) {
    const last = state.events.findLast((e) => e.type === "list-opener");
    if (!last || kind(last.status) !== kind(opener) || Date.now() - Date.parse(last.at) > 600_000) {
      logEvent(state, "list-opener", { status: state.heartbeat.opener, list: state.heartbeat.list });
    }
  }
}

const MAX_LIST_SEEN = 3000;
const TOP_ROWS = 5;
const PRIMARY_LIST = "marketplace";

// Inbox list snapshot: [{ id, unread, pos, grid }]. pos = index within its
// list; grid = the list's name (newer extensions). When lists are named, only
// the Marketplace list counts: ordinary Messenger chats are ignored.
//
// A conversation counts as a new arrival only when:
//   read-to-unread  it was seen read and is now unread;
//   new-at-top      it is unread, never seen before, and in the top 5 rows;
//   moved-to-top    it was already unread lower down (pos >= 2) and jumped to
//                   the top, i.e. a further message in an unanswered chat.
// Old unread conversations that Facebook renders lazily further down never
// count. Nothing is assessed until the list is fully open.
export function inspectInbox(state, threads, { listReady = true, list = null } = {}) {
  if (state.mode === "off") return { open: null };
  // An owner-approved send goes straight to its verified conversation; reopening
  // the Marketplace list is not needed (that step needs the tab on screen).
  if (state.mode === "send" && state.approvedSend && !listReady) return { open: state.approvedSend.threadId };
  if (!listReady) return { open: null, waiting: "Conversation list is not open yet" };
  let rows = (Array.isArray(threads) ? threads : []).filter((row) => THREAD_ID.test(String(row?.id))).slice(0, 600);
  if (rows.some((row) => typeof row.grid === "string")) rows = rows.filter((row) => row.grid === PRIMARY_LIST);
  if (!rows.length) return { open: null, waiting: "No Marketplace conversations visible" };
  const unread = rows.filter((row) => row.unread === true).map((row) => String(row.id));
  // A different list (for example Chats, then Marketplace) gets a fresh baseline.
  const first = !state.inboxBaseline || (list !== null && state.inboxBaseline.list !== list);
  const seenList = (state.listSeen ??= {});
  const fresh = [];
  for (const row of rows) {
    const id = String(row.id);
    const prev = seenList[id];
    const prevState = typeof prev === "string" ? prev : prev?.s;
    const prevPos = typeof prev === "object" && prev ? prev.p : undefined;
    const pos = Number.isFinite(row.pos) ? row.pos : 0;
    if (!first && row.unread === true) {
      if (prevState === "read") fresh.push({ id, pos, reason: "read-to-unread" });
      else if (prevState === undefined && pos < TOP_ROWS) fresh.push({ id, pos, reason: "new-at-top" });
      else if (prevState === "unread" && Number.isFinite(prevPos) && prevPos >= 2 && pos === 0) fresh.push({ id, pos, reason: "moved-to-top" });
    }
    delete seenList[id];
    seenList[id] = { s: row.unread === true ? "unread" : "read", p: pos };
  }
  const keys = Object.keys(seenList);
  for (const id of keys.slice(0, Math.max(0, keys.length - MAX_LIST_SEEN))) delete seenList[id];

  if (first) {
    state.inboxBaseline = { at: new Date().toISOString(), unread, list };
    if (state.mode === "observe") state.observedUnread = unread;
    logEvent(state, "baseline", { list, rows: rows.length, unreadLeftForPerson: unread.length });
    // Only an explicitly queued pilot conversation can be waiting here.
    if (state.mode !== "auto") return { open: state.mode === "observe" ? null : state.pendingOpen[0] || null };
  }
  if (state.mode === "observe") {
    // Passive: record the arrival, nothing more. Nothing is queued to open,
    // so read status and message content are untouched.
    for (const f of fresh) logEvent(state, "unread-observed", { threadId: f.id, reason: f.reason, pos: f.pos, list });
    state.observedUnread = unread;
    return { open: null };
  }
  if (state.mode === "auto") return autoInbox(state, rows, first ? [] : fresh, first);
  for (const f of fresh) {
    // Draft and Send open only allowlisted conversations (or all, when the
    // owner has deliberately ticked "all conversations").
    if (!(state.allowAll || state.allowThreads.includes(f.id))) {
      logEvent(state, "unread-not-opened", { threadId: f.id, reason: f.reason, why: "Not on the allowlist" });
      continue;
    }
    if (state.pendingOpen.includes(f.id) || state.threads[f.id]?.needsHuman) continue;
    state.pendingOpen.push(f.id);
    logEvent(state, "unread", { threadId: f.id, reason: f.reason });
  }
  return { open: state.pendingOpen[0] || null };
}

// ---- Verify-first pilot: one named conversation, read and drafted once ----
// Started from Observe. The extension reports the visible list-row text of
// that one conversation; only if it contains the expected words (for example
// "Renault Master") is the conversation opened, in Draft mode restricted to it.
// After the draft is recorded the assistant returns to Observe. Never sends.
const PILOT_TIMEOUT_MS = 180_000;
// ---- Finder: which visible Marketplace rows contain given words ----
// The extension matches the words inside the page and returns only conversation
// IDs and list positions; no row text leaves the page.
export function startFind(state, { words }) {
  const w = String(words || "").trim();
  if (w.length < 3) throw new TypeError("Enter at least 3 characters to find");
  if (accountProblem(state)) throw new TypeError(accountProblem(state));
  if (state.heartbeat?.list !== "marketplace") {
    throw new TypeError("The Marketplace list is not open in the assistant tab yet. Wait for the green monitoring banner.");
  }
  state.finder = { words: w, status: "searching", requestedAt: new Date().toISOString(), matches: [], searched: 0 };
  logEvent(state, "find", { status: "searching", words: w });
  return state.finder;
}

export function recordFind(state, { words, matches, searched }) {
  const finder = state.finder;
  if (!finder || finder.status !== "searching" || normalise(words) !== normalise(finder.words)) return { ok: false };
  finder.matches = (Array.isArray(matches) ? matches : []).filter((m) => THREAD_ID.test(String(m?.id))).slice(0, 20)
    .map((m) => ({ id: String(m.id), pos: Number(m.pos) || 0, grid: String(m.grid || "").slice(0, 20), unread: m.unread === true }));
  finder.searched = Number(searched) || 0;
  finder.status = "done";
  finder.finishedAt = new Date().toISOString();
  logEvent(state, "find", { status: "done", words: finder.words, matches: finder.matches.length, searched: finder.searched });
  return { ok: true };
}

export function findTimeout(state, now = Date.now()) {
  if (state.finder?.status === "searching" && now - Date.parse(state.finder.requestedAt) > 60_000) {
    state.finder.status = "failed";
    state.finder.error = "The Edge tab did not report back in time (is the Marketplace list open, and the extension 0.3.4 or later?)";
  }
}

export function startPilot(state, { threadId, mustContain }) {
  const id = String(threadId || "");
  const words = String(mustContain || "").trim();
  if (!THREAD_ID.test(id)) throw new TypeError("Pilot needs a conversation ID");
  if (words.length < 3) throw new TypeError("Pilot needs words that must appear in the conversation row");
  if (state.mode !== "observe") throw new TypeError("Start the pilot from Observe mode");
  if (accountProblem(state)) throw new TypeError(accountProblem(state));
  if (state.heartbeat?.list !== "marketplace") {
    throw new TypeError("The Marketplace list is not open in the assistant tab yet (" + (state.heartbeat?.list || "no report") + "). Wait for the green monitoring banner, then run the pilot.");
  }
  state.pilot = { threadId: id, mustContain: words, status: "verifying", requestedAt: new Date().toISOString(), result: null };
  logEvent(state, "pilot", { status: "verifying", threadId: id, mustContain: words });
  return state.pilot;
}

export function cancelPilot(state, why = "Cancelled") {
  if (!state.pilot || ["done", "mismatch", "failed", "cancelled"].includes(state.pilot.status)) return;
  const wasOpening = state.pilot.status === "opening";
  state.pilot.status = why === "Cancelled" ? "cancelled" : "failed";
  state.pilot.error = why;
  logEvent(state, "pilot", { status: state.pilot.status, threadId: state.pilot.threadId, why });
  if (wasOpening) switchMode(state, "observe");
}

export function verifyPilot(state, { threadId, found, rowText }) {
  const pilot = state.pilot;
  if (!pilot || pilot.status !== "verifying" || String(threadId) !== pilot.threadId) return { ok: false };
  if (!found) {
    cancelPilot(state, "The conversation is not in the visible Marketplace list");
    return { ok: false };
  }
  const text = normalise(rowText);
  // Facebook keeps placeholder rows with no text for entries it is not drawing
  // (live, 23:11). Wait for the text; the pilot still times out clearly.
  if (!text) return { ok: false, waiting: "row not rendered yet" };
  const words = normalise(pilot.mustContain);
  // Several required parts can be joined with "+": every part must be present
  // as whole words. A part starting with "^" must begin the row, where Facebook
  // shows the sender's name (so "^Van" cannot match "van" in a listing title).
  const parts = pilot.mustContain.split("+").map((p) => p.trim()).filter(Boolean);
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partHit = (part) => {
    const anchored = part.startsWith("^");
    const body = normalise(anchored ? part.slice(1) : part);
    return new RegExp((anchored ? "^" : "(?:^|[^a-z0-9])") + escape(body) + "(?:$|[^a-z0-9])").test(text);
  };
  const matched = parts.length > 1 || parts[0]?.startsWith("^") ? parts.every(partHit) : text.includes(words);
  if (!matched) {
    // Another customer's row text is not stored.
    pilot.status = "mismatch";
    pilot.error = "The conversation row does not contain \"" + pilot.mustContain + "\". It was not opened.";
    // Which expected parts were present (no row text is stored).
    pilot.wordHits = parts.length > 1 || parts[0]?.startsWith("^")
      ? Object.fromEntries(parts.map((p) => [p, partHit(p)]))
      : Object.fromEntries(words.split(" ").filter(Boolean).map((w) => [w, text.includes(w)]));
    pilot.rowWords = text.split(" ").filter(Boolean).length;
    logEvent(state, "pilot", { status: "mismatch", threadId: pilot.threadId });
    return { ok: false };
  }
  pilot.rowText = String(rowText).replace(/\s+/g, " ").trim().slice(0, 300);
  pilot.status = "opening";
  pilot.openedAt = new Date().toISOString();
  switchMode(state, "draft", { allowThreads: [pilot.threadId], allowAll: false });
  state.pendingOpen = [pilot.threadId];
  logEvent(state, "pilot", { status: "opening", threadId: pilot.threadId });
  return { ok: true };
}

// The pilot never waits silently: it fails with a plain explanation when the
// Marketplace list is not open, or when the Edge tab does not report in time.
const PILOT_LIST_GRACE_MS = 30_000;
const PILOT_VERIFY_MS = 90_000;
export function pilotTimeout(state, now = Date.now()) {
  const pilot = state.pilot;
  const list = state.heartbeat?.list;
  if (pilot?.status === "verifying") {
    const waited = now - Date.parse(pilot.requestedAt);
    if (list !== "marketplace" && waited > PILOT_LIST_GRACE_MS) {
      cancelPilot(state, "The Marketplace list is not open in the assistant tab (" + (list || "none") + "), so the conversation could not be checked. It was not opened. The assistant keeps reopening the list; run the pilot again when the banner is green.");
    } else if (waited > PILOT_VERIFY_MS) {
      cancelPilot(state, "The Edge tab did not report the conversation row in time. It was not opened. Check that the extension shows version 0.3.0 or later.");
    }
  }
  if (pilot?.status === "opening" && now - Date.parse(pilot.openedAt) > PILOT_TIMEOUT_MS) {
    cancelPilot(state, "The conversation did not finish loading in time");
  }
}

// Called after the pilot conversation has been read (and drafted, if new).
export function finishPilot(state, { snapshot, structure, decision, outcome, askMeMs }) {
  const pilot = state.pilot;
  if (!pilot || pilot.status !== "opening" || String(snapshot?.threadId) !== pilot.threadId) return false;
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const count = (direction) => messages.filter((m) => m.direction === direction).length;
  pilot.result = {
    messages: messages.length, incoming: count("incoming"), outgoing: count("outgoing"), unknown: messages.length - count("incoming") - count("outgoing"),
    latestIncoming: messages.filter((m) => m.direction === "incoming").slice(-3).map((m) => String(m.text || "").slice(0, 300)),
    listingId: snapshot.listingId || null, listingTitle: String(snapshot.listingTitle || "").slice(0, 200),
    customerMessage: decision?.message || null,
    draft: outcome?.draft || null,
    noDraftReason: outcome?.draft ? null : outcome?.reason || decision?.reason || null,
    askMeMs: askMeMs ?? null,
    structure: structure || null,
  };
  pilot.status = "done";
  pilot.finishedAt = new Date().toISOString();
  logEvent(state, "pilot", { status: "done", threadId: pilot.threadId, draft: Boolean(outcome?.draft) });
  switchMode(state, "observe");
  return true;
}

// ---- Facebook system notices and sender-name lines (live pilot, 23 Nov 2026) ----
// A Marketplace conversation starts with Facebook's own notices, which carry
// message IDs like customer messages: "Van started this chat. View buyer
// profile" and "To help identify and reduce scams and fraud, Meta may use
// technology to review Marketplace messages." They are never customer text.
const FACEBOOK_NOTICES = [
  /\bstarted this chat\b/i,
  /\bview buyer profile\b/i,
  /\bmay use technology to review marketplace messages\b/i,
  /^to help identify and reduce scams\b/i,
];
export const isFacebookNotice = (text) => FACEBOOK_NOTICES.some((pattern) => pattern.test(String(text || "")));
// A bubble's text can begin with the sender's name on its own line ("Van\nWhat's
// the vehicle's history?"). Drop a short first line with no punctuation.
export function cleanMessageText(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].length <= 40 && !/[.?!,:;]/.test(lines[0]) && lines[0].split(" ").length <= 4) lines.shift();
  return lines.join("\n");
}


export function resolveProduct(listingTitle, defaultProduct) {
  const text = String(listingTitle || "");
  if (/\brent[\s-]*(?:2|to)[\s-]*buy\b/i.test(text)) return "rent2buy";
  if (/\bfinance\b/i.test(text)) return "finance";
  return defaultProduct === "finance" || defaultProduct === "rent2buy" ? defaultProduct : null;
}

// Open-thread snapshot. Returns the customer text to answer, or a reason not to.
// ---- Supervised send: one approved draft, word for word, to one conversation ----
// The owner approves an exact draft (by job ID) for one conversation. The
// assistant switches to Send restricted to that conversation, opens it, types
// that text, re-checks with the service immediately before pressing Send,
// confirms the outgoing message appeared, and returns to Observe whatever the
// outcome. Nothing else is sent; a new customer message cancels it.
export function approveSend(state, { threadId, jobId, text }) {
  const id = String(threadId || "");
  const thread = state.threads[id];
  const job = thread?.jobs.find((j) => j.id === jobId);
  if (!job || !["draft", "cancelled"].includes(job.status)) throw new TypeError("That draft was not found or is not waiting for approval");
  if (normalise(job.text) !== normalise(text)) throw new TypeError("The approved text does not match the draft exactly");
  if (state.mode !== "observe") throw new TypeError("Approve the send from Observe mode");
  if (accountProblem(state)) throw new TypeError(accountProblem(state));
  // A draft cancelled before Send was pressed (never sent) is re-issued as a
  // fresh copy of the identical text: the extension never presses Send twice
  // for the same claim.
  let approvedJob = job;
  if (job.status === "cancelled") {
    approvedJob = { ...job, id: randomUUID(), status: "draft", at: new Date().toISOString(), outgoingId: null, supersedes: job.id };
    job.status = "superseded";
    thread.jobs.push(approvedJob);
  }
  thread.needsHuman = null; // the owner has explicitly approved this send
  switchMode(state, "send", { allowThreads: [id], allowAll: false });
  state.approvedSend = { threadId: id, jobId: approvedJob.id, at: new Date().toISOString() };
  state.pendingOpen = [id];
  logEvent(state, "send-approved", { threadId: id, jobId });
  return state.approvedSend;
}

function endApprovedSend(state, outcome) {
  if (!state.approvedSend) return;
  logEvent(state, "send-approved-end", { threadId: state.approvedSend.threadId, outcome });
  state.approvedSend = null;
  switchMode(state, "observe");
}

export function approvedSendTimeout(state, now = Date.now()) {
  if (state.approvedSend && now - Date.parse(state.approvedSend.at) > 180_000) endApprovedSend(state, "timed out before sending");
}

export function inspectThread(state, snapshot, { defaultProduct } = {}) {
  const threadId = String(snapshot?.threadId || "");
  if (!THREAD_ID.test(threadId)) return { action: "none", reason: "No conversation identity" };
  if (state.mode === "off") return { action: "none", reason: "Assistant is off" };
  const approved = state.approvedSend;
  if (approved && approved.threadId === threadId && state.mode === "send") {
    state.pendingOpen = state.pendingOpen.filter((id) => id !== threadId);
    const thread = state.threads[threadId];
    const job = thread?.jobs.find((j) => j.id === approved.jobId);
    const seen = new Set(thread?.seen || []);
    const newCustomer = (snapshot.messages || []).filter((m) => m?.direction === "incoming" && !seen.has(m.id) && !isFacebookNotice(m.text));
    if (!job || job.status !== "draft") { endApprovedSend(state, "draft no longer available"); return { action: "none", reason: "Approved draft no longer available" }; }
    // Duplicate guard: if the conversation already shows our approved reply, record
    // it as delivered and send nothing.
    const head = normalise(job.text).slice(0, 40);
    const already = (snapshot.messages || []).find((m) => m?.direction === "outgoing" && normalise(m.text).startsWith(head));
    if (already) { job.status = "confirmed"; job.outgoingId = already.id; endApprovedSend(state, "already in the conversation; not sent again"); return { action: "none", reason: "Approved reply already sent" }; }
    if (newCustomer.length) { endApprovedSend(state, "cancelled: the customer sent a new message"); return { action: "none", reason: "New customer message since the draft" }; }
    // Send-time verification: the open conversation must show the listing the pilot verified.
    if (!snapshot.listingId || (thread.listingId && snapshot.listingId !== thread.listingId)) { endApprovedSend(state, "cancelled: the open conversation does not show the verified listing"); return { action: "none", reason: "Listing does not match the verified conversation" }; }
    job.status = "claimed";
    logEvent(state, "claim", { threadId, jobId: job.id, approved: true });
    return { action: "send", jobId: job.id, text: job.text };
  }
  // Observe never reads, stores or forwards message content.
  if (state.mode === "observe") return { action: "none", reason: "Observe mode is passive" };
  const flagged = state.pendingOpen.includes(threadId);
  state.pendingOpen = state.pendingOpen.filter((id) => id !== threadId);
  const messages = (Array.isArray(snapshot.messages) ? snapshot.messages : [])
    .filter((m) => typeof m?.id === "string" && MESSAGE_ID.test(m.id) && ["incoming", "outgoing"].includes(m.direction))
    .filter((m) => !isFacebookNotice(m.text))
    .map((m) => ({ ...m, text: cleanMessageText(m.text) }))
    .slice(-120);
  if (!messages.length) {
    if (flagged) logEvent(state, "unreadable", { threadId, reason: "No message IDs visible in the opened conversation" });
    return { action: "none", reason: "Conversation history not visible" };
  }

  const existing = state.threads[threadId];
  const thread = existing || {
    id: threadId, listingId: null, listingTitle: "", product: null, seen: [], firstSeenAt: new Date().toISOString(),
    history: [], jobs: [], conversation: null, needsHuman: null,
  };
  state.threads[threadId] = thread;
  if (snapshot.listingId && /^\d{1,32}$/.test(snapshot.listingId)) thread.listingId = snapshot.listingId;
  if (snapshot.listingTitle) thread.listingTitle = String(snapshot.listingTitle).slice(0, 200);
  thread.product = resolveProduct(thread.listingTitle, defaultProduct);

  const priorSeen = new Set(thread.seen);
  const seen = new Set(thread.seen);
  const fresh = messages.filter((m) => !seen.has(m.id));
  for (const m of fresh) seen.add(m.id);
  thread.seen = [...seen].slice(-MAX_SEEN);
  for (const m of fresh.filter((item) => item.direction === "outgoing")) confirmByObservation(thread, m);

  let customer;
  // Automatic replies: answer the customer messages after our last reply that
  // were sent at or after the catch-up start (time decoded from the Facebook
  // message ID), and that no reply of ours already covers. All of them together
  // get one reply. A message whose time cannot be verified goes to a person.
  let auto = false;
  if (state.mode === "auto") {
    if (!flagged) return { action: "none", reason: "Conversation was not queued" };
    (state.autoChecked ??= {})[threadId] = new Date().toISOString();
    if (state.autoQueuedAt) delete state.autoQueuedAt[threadId];
    thread.rebaseline = false;
    const raw = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    if (state.autoTestBuyer && !raw.some((m) => normalise(m?.text).startsWith(normalise(state.autoTestBuyer) + " started this chat"))) {
      logEvent(state, "left-for-person", { threadId, why: "Not the test buyer" });
      return { action: "none", reason: "Not the test buyer" };
    }
    const from = autoFrom(state);
    const covered = new Set(thread.jobs.filter((j) => ["confirmed", "claimed", "typed", "unconfirmed"].includes(j.status)).flatMap((j) => j.messageIds || []));
    const lastOutgoing = messages.findLastIndex((m) => m.direction === "outgoing");
    const recent = messages.slice(lastOutgoing + 1)
      .filter((m) => m.direction === "incoming" && !covered.has(m.id))
      .map((m) => ({ ...m, sentAt: messageTime(m.id) }))
      .filter((m) => m.sentAt === null || m.sentAt >= from);
    if (!recent.length) return { action: "none", reason: "No unanswered customer message since " + new Date(from).toISOString() };
    if (recent.some((m) => m.sentAt === null)) {
      thread.needsHuman = "Message time could not be verified";
      logEvent(state, "escalate", { threadId, reason: thread.needsHuman });
      return { action: "none", reason: thread.needsHuman };
    }
    customer = recent;
    auto = true;
  } else if (!existing || existing.rebaseline) {
    thread.rebaseline = false;
    // First sight. Only a conversation that became unread after the assistant
    // was switched on may be answered: its trailing incoming messages are new.
    const lastOutgoing = messages.findLastIndex((m) => m.direction === "outgoing");
    customer = flagged ? messages.slice(lastOutgoing + 1).filter((m) => m.direction === "incoming" && !priorSeen.has(m.id)) : [];
    if (!customer.length) {
      logEvent(state, "baseline-thread", { threadId, messages: messages.length });
      return { action: "none", reason: "Existing history recorded as baseline" };
    }
  } else {
    customer = fresh.filter((m) => m.direction === "incoming");
  }
  if (!customer.length) return { action: "none", reason: "No new customer message" };
  logEvent(state, "incoming", { threadId, messageIds: customer.map((m) => m.id) });

  if (thread.needsHuman) return { action: "none", reason: "Conversation is with the team: " + thread.needsHuman };
  if (thread.jobs.some((job) => OPEN_JOB.has(job.status) || job.status === "unconfirmed")) {
    thread.needsHuman = "A previous reply could not be confirmed";
    return { action: "none", reason: thread.needsHuman };
  }
  if (!thread.product) {
    thread.needsHuman = "No verified listing product";
    logEvent(state, "escalate", { threadId, reason: thread.needsHuman });
    return { action: "none", reason: thread.needsHuman };
  }
  const text = customer.map((m) => String(m.text || "").trim()).filter(Boolean).join("\n").slice(0, 3000);
  if (!text) return { action: "none", reason: "Customer message has no text (photo or sticker)" };
  return { action: "draft", threadId, product: thread.product, message: text, messageIds: customer.map((m) => m.id), ...(auto ? { auto: true } : {}) };
}

// ---- Auto test restriction: only the named test buyer ----
// For each new conversation the extension reports its list-row text (as for the
// pilot) BEFORE anything is opened. Facebook starts the row with the sender's
// name ("Van · 2023 Ford ..."). Any other sender's conversation is never opened.
const AUTO_CHECK_MS = 60_000;
export function autoCheckThread(state) {
  return state.mode === "auto" && state.autoTestBuyer ? state.autoCheck?.[0]?.threadId || null : null;
}
export function recordAutoCheck(state, { threadId, found, rowText }) {
  const check = state.autoCheck?.[0];
  if (!autoCheckThread(state) || String(threadId) !== check.threadId) return { ok: false };
  const text = normalise(rowText);
  if (found && !text) return { ok: false, waiting: "row not rendered yet" };
  state.autoCheck.shift();
  if (found && text.startsWith(normalise(state.autoTestBuyer) + " ·")) {
    if (!state.pendingOpen.includes(check.threadId)) state.pendingOpen.push(check.threadId);
    logEvent(state, "unread", { threadId: check.threadId, auto: true, testBuyer: state.autoTestBuyer });
    return { ok: true };
  }
  // Another sender's row text is not stored.
  logEvent(state, "left-for-person", { threadId: check.threadId, why: found ? "Not the test buyer (not opened)" : "Row not visible (not opened)" });
  return { ok: false };
}
export function autoCheckTimeout(state, now = Date.now()) {
  const check = state.autoCheck?.[0];
  if (check && now - Date.parse(check.at) > AUTO_CHECK_MS) {
    state.autoCheck.shift();
    logEvent(state, "left-for-person", { threadId: check.threadId, why: "Row check timed out (not opened)" });
  }
}

// ---- Automatic replies (mode "auto") ----
// Every unanswered customer message sent since the catch-up start is answered,
// several at once in one reply, only for a listing whose title names Rent2Buy
// and only with an ordinary Ask Me or website answer containing the Rent2Buy
// link. Complaints, requests for a person and Ask Me failures go to a person.
const AUTO_START = "2026-11-24T12:00:00.000Z"; // 12:00 UK time (GMT), owner's cutoff
const AUTO_MAX_FAILURES = 2;
const AUTO_OPEN_MS = 240_000;
const AUTO_RECHECK_MS = 45_000;
const AGE_UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
export const autoFrom = (state) => Date.parse(state.autoFrom || AUTO_START);

// Facebook message IDs ("mid.$" + 21 bytes, base64url) carry the send time in
// milliseconds at bits 111-151 (verified 24 Nov 2026 against 4 live messages).
// Numeric IDs carry it in the bits above 22. Anything else: unknown (null).
export function messageTime(id, now = Date.now()) {
  const text = String(id || "");
  let ms = null;
  // 29 base64url characters; the first 21 decoded bytes hold the fields.
  const mid = /^mid\.\$([A-Za-z0-9_-]{29})$/.exec(text);
  if (mid) {
    const bytes = Buffer.from(mid[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").subarray(0, 21);
    if (bytes.length === 21) ms = Number((BigInt("0x" + bytes.toString("hex")) >> 16n) & ((1n << 41n) - 1n));
  } else if (/^\d{15,20}$/.test(text)) {
    ms = Number(BigInt(text) >> 22n);
  }
  return ms !== null && ms > Date.parse("2020-01-01") && ms < now + 300_000 ? ms : null;
}

// Which conversations to open. Besides unread arrivals, any Marketplace row
// whose last message is the customer's ("You:" absent) and whose last activity
// (Facebook's "5m", "2h"... age; the upper bound of the real time) is at or
// after the catch-up start, and newer than our last check of that conversation.
// This catches up after Edge or Windows was closed, and on follow-up questions.
function autoInbox(state, rows, fresh, first, now = Date.now()) {
  const from = autoFrom(state);
  const checked = (state.autoChecked ??= {});
  const queuedAt = (state.autoQueuedAt ??= {});
  const head = state.pendingOpen[0];
  if (head && queuedAt[head] && now - Date.parse(queuedAt[head]) > AUTO_OPEN_MS) {
    state.pendingOpen.shift();
    delete queuedAt[head];
    checked[head] = new Date(now).toISOString();
    logEvent(state, "left-for-person", { threadId: head, why: "Conversation could not be read within 4 minutes" });
  }
  const queue = (id, reason) => {
    if (state.threads[id]?.needsHuman || state.pendingOpen.includes(id)) return;
    if (state.autoTestBuyer) {
      if (!(state.autoCheck ??= []).some((c) => c.threadId === id)) {
        state.autoCheck.push({ threadId: id, at: new Date(now).toISOString() });
        logEvent(state, "auto-check", { threadId: id, reason });
      }
      return;
    }
    state.pendingOpen.push(id);
    queuedAt[id] = new Date(now).toISOString();
    logEvent(state, "unread", { threadId: id, reason, auto: true });
  };
  const upperOf = (row) => {
    const age = /^(\d{1,4})([mhdw])$/.exec(String(row?.age || ""));
    // Facebook may round ages to the nearest unit ("2h" can mean 1h30m), so the
    // latest possible activity is half a unit later than the shown age.
    return age ? now - Math.max(0, Number(age[1]) - 0.5) * AGE_UNIT[age[2]] : row?.age === "now" ? now : null;
  };
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const f of fresh) {
    const row = byId.get(f.id);
    const upper = upperOf(row);
    if (row?.you === true || (upper !== null && upper < from)) continue;
    queue(f.id, f.reason);
  }
  let aged = 0, ours = 0;
  for (const row of rows) {
    const upper = upperOf(row);
    if (upper === null) continue;
    aged++;
    if (row.you === true) { ours++; continue; }
    if (upper < from) continue;
    if (upper <= (Date.parse(checked[row.id] || "") || 0) + AUTO_RECHECK_MS) continue;
    queue(String(row.id), "customer activity since the catch-up start");
  }
  if (first) logEvent(state, "catchup-scan", { rows: rows.length, withAge: aged, lastMessageOurs: ours, queued: state.pendingOpen.length });
  return { open: state.pendingOpen[0] || null };
}
const ukDate = (value) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
export function autoSentToday(state, now = Date.now()) {
  const today = ukDate(now);
  return (state.autoLog || []).filter((entry) => ukDate(entry.at) === today).length;
}
// Titles look like "2023 Ford Deliver 9 - Visit us at Rent2BuyVans.co.uk".
// Any mention of finance (for example Van Finance adverts) is not confident.
export function confidentRent2Buy(listingTitle) {
  const text = String(listingTitle || "");
  return /rent\s*(?:2|to)\s*buy/i.test(text) && !/finance/i.test(text);
}
function autoSendBlock(state, thread, decision, job) {
  if (!decision.auto) return "Not checked for an automatic reply";
  if (thread.product !== "rent2buy" || !confidentRent2Buy(thread.listingTitle)) return "Listing not confidently identified as Rent2Buy";
  if (!thread.listingId) return "Listing not verified in the conversation";
  if (!String(job.text).includes(RENT2BUY_WEBSITE)) return "Reply does not contain the Rent2Buy website link";
  if (thread.jobs.some((other) => other !== job && OPEN_JOB.has(other.status))) return "Another reply is already in progress";
  if (accountProblem(state)) return accountProblem(state);
  return null;
}

function confirmByObservation(thread, outgoing) {
  const job = thread.jobs.findLast((item) => OPEN_JOB.has(item.status) || item.status === "unconfirmed");
  if (!job) return;
  // Same matching as the page: opening words or the reply's link, anywhere.
  const reply = normalise(job.text);
  const head = reply.slice(0, 40);
  const link = (reply.match(/https?:\/\/\S+/) || [""])[0].replace(/\/+$/, "");
  const seen = normalise(outgoing.text);
  if (head && (seen.includes(head) || (link && seen.includes(link)))) {
    job.status = "confirmed";
    job.outgoingId = outgoing.id;
    if (thread.needsHuman === "A previous reply could not be confirmed") thread.needsHuman = null;
  }
}

const normalise = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

// Record the Ask Me outcome and decide whether the extension may send it.
export function recordDraft(state, decision, draft) {
  const thread = state.threads[decision.threadId];
  if (draft.reason) {
    thread.needsHuman = draft.reason;
    logEvent(state, "escalate", { threadId: thread.id, reason: draft.reason });
    return { action: "none", reason: draft.reason };
  }
  const job = {
    id: randomUUID(), messageIds: decision.messageIds, customer: decision.message, text: draft.text,
    at: new Date().toISOString(), status: "draft", outgoingId: null,
  };
  thread.jobs.push(job);
  thread.history.push({ role: "user", content: decision.message });
  if (state.mode === "auto") {
    const blocked = autoSendBlock(state, thread, decision, job);
    if (blocked) {
      thread.needsHuman = "Not sent automatically: " + blocked;
      logEvent(state, "draft", { threadId: thread.id, jobId: job.id, sendBlocked: blocked });
      return { action: "none", reason: thread.needsHuman, draft: draft.text };
    }
    job.auto = true;
    job.status = "claimed";
    (state.autoLog ??= []).push({ at: job.at, threadId: thread.id, jobId: job.id });
    state.autoLog = state.autoLog.slice(-200);
    logEvent(state, "claim", { threadId: thread.id, jobId: job.id, auto: true });
    return { action: "send", jobId: job.id, text: draft.text };
  }
  const allowed = state.allowAll || state.allowThreads.includes(thread.id);
  if (state.mode !== "send" || !allowed) {
    logEvent(state, "draft", { threadId: thread.id, jobId: job.id, sendBlocked: state.mode === "send" ? "thread not on allowlist" : "mode " + state.mode });
    return { action: "none", reason: "Draft only", draft: draft.text };
  }
  job.status = "claimed";
  logEvent(state, "claim", { threadId: thread.id, jobId: job.id });
  return { action: "send", jobId: job.id, text: draft.text };
}

function findJob(state, jobId) {
  for (const thread of Object.values(state.threads)) {
    const job = thread.jobs.find((item) => item.id === jobId);
    if (job) return { thread, job };
  }
  return {};
}

// Last-moment check immediately before the send control is pressed.
export function authoriseSend(state, jobId) {
  const { thread, job } = findJob(state, jobId);
  if (!job || job.status !== "claimed") return { go: false, reason: "Unknown or already used send claim" };
  const sendAllowed = state.mode === "send" && (state.allowAll || state.allowThreads.includes(thread.id));
  const autoAllowed = state.mode === "auto" && job.auto === true && !accountProblem(state)
    && !thread.jobs.some((other) => other !== job && other.status === "typed");
  if (!(sendAllowed || autoAllowed) || thread.needsHuman) {
    job.status = "cancelled";
    logEvent(state, "cancel", { threadId: thread.id, jobId });
    return { go: false, reason: "Sending was switched off" };
  }
  job.status = "typed";
  return { go: true };
}

export function recordSendResult(state, jobId, { confirmed, outgoingId, error }) {
  const { thread, job } = findJob(state, jobId);
  if (!job) return;
  const endApproved = state.approvedSend?.jobId === jobId;
  if (confirmed) {
    job.status = "confirmed";
    job.outgoingId = typeof outgoingId === "string" ? outgoingId.slice(0, 200) : null;
    if (job.outgoingId) thread.seen = [...new Set([...thread.seen, job.outgoingId])].slice(-MAX_SEEN);
    thread.history.push({ role: "assistant", content: job.text });
    thread.history = thread.history.slice(-12);
    logEvent(state, "sent", { threadId: thread.id, jobId });
  } else if (job.status !== "confirmed") {
    job.status = job.status === "claimed" ? "cancelled" : "unconfirmed";
    thread.needsHuman = "A reply could not be confirmed" + (error ? ": " + String(error).slice(0, 120) : "");
    logEvent(state, "unconfirmed", { threadId: thread.id, jobId, error: String(error || "") });
  }
  // Automatic replies stop (back to Observe) after 2 failed sends in a row.
  if (job.auto) {
    state.autoFailures = confirmed ? 0 : (state.autoFailures || 0) + 1;
    if (state.autoFailures >= AUTO_MAX_FAILURES && state.mode === "auto") {
      setMode(state, "observe");
      logEvent(state, "auto-stopped", { reason: AUTO_MAX_FAILURES + " automatic replies in a row could not be confirmed" });
    }
  }
  if (endApproved) endApprovedSend(state, confirmed ? "sent and confirmed" : "not confirmed: " + String(error || ""));
}

export function resumeThread(state, threadId) {
  const thread = state.threads[threadId];
  if (!thread) return false;
  thread.needsHuman = null;
  for (const job of thread.jobs) if (job.status === "unconfirmed") job.status = "abandoned";
  logEvent(state, "resume", { threadId });
  return true;
}

const OPENER_TEXT = {
  "no-messenger-button": "Could not find the Messenger button at the top of the Facebook page.",
  "no-marketplace-control": "The Messenger panel is open but its Marketplace entry was not found.",
  "messenger-panel-not-found": "Clicking Messenger did not show the chat panel; retrying every 10 minutes.",
};
const HEALTH_TEXT = {
  "signed-out": "Facebook is signed out in Edge.",
  "security-challenge": "Facebook is showing a security check. Complete it in Edge.",
  loading: "The Facebook page is still loading.",
};

// Is the assistant genuinely watching the Marketplace list right now?
export function monitoringVerdict(state, now = Date.now()) {
  const hb = state.heartbeat;
  const reasons = [];
  if (state.mode === "off") reasons.push("The assistant is Off.");
  const problem = accountProblem(state);
  if (problem) reasons.push(problem + ".");
  if (state.openerHold) reasons.push("Opener on hold: " + state.openerHold.reason);
  if (!hb) reasons.push("The Edge extension has not connected to this service yet.");
  else {
    const age = Math.round((now - Date.parse(hb.at)) / 1000);
    if (age > 150) reasons.push("No report from the Edge assistant tab for " + age + " s: Edge may be closed or asleep, or the extension disabled.");
    if (hb.health !== "healthy") reasons.push(HEALTH_TEXT[hb.health] || "The Facebook page is not healthy (" + hb.health + ").");
    if (state.openerTrip && hb.list !== "marketplace") reasons.push("Safety stop is set (" + state.openerTrip.reason + "), so the list opener will not click. Check that no customer conversation was opened, then press \"Reset safety stop\".");
    else if (/^tripped|^disabled/.test(hb.opener)) reasons.push("Safety stop: " + hb.opener.replace(/^(?:tripped|disabled): /, "") + ". The list opener switched itself off. Check that no customer conversation was opened, then press \"Reset safety stop\".");
    else if (hb.list !== "marketplace") reasons.push(OPENER_TEXT[hb.opener] || (/^Marketplace click had no effect/.test(hb.opener) ? "The Marketplace entry in the Messenger panel was clicked but the Marketplace list did not open. Retrying every 15 s with a different click method (" + hb.opener + ")." : null) || "The Marketplace conversation list is not open in the assistant tab (" + (hb.list || "none") + ").");
    if (!hb.rows) reasons.push("No conversations are visible in the assistant tab.");
  }
  if (state.mode !== "off" && !state.inboxBaseline) reasons.push("Waiting for the first full snapshot of the Marketplace list.");
  return { ok: reasons.length === 0, reasons };
}

export function publicStatus(state) {
  const threads = Object.values(state.threads);
  return {
    monitoring: monitoringVerdict(state),
    pilot: state.pilot || null,
    finder: state.finder || null,
    approvedSend: state.approvedSend || null,
    safetyStop: state.openerTrip || null,
    account: { signedIn: state.heartbeat?.account || null, authorised: state.authorisedAccount || null, problem: accountProblem(state) },
    openerHold: state.openerHold || null,
    openerAttempts: state.openerAttempts?.count || 0,
    mode: state.mode,
    allowAll: state.allowAll,
    allowThreads: state.allowThreads,
    enabledAt: state.enabledAt,
    auto: { sentToday: autoSentToday(state), from: new Date(autoFrom(state)).toISOString(), testBuyer: state.autoTestBuyer || null },
    baselineUnread: state.inboxBaseline?.unread.length ?? null,
    observedUnread: state.mode === "observe" ? (state.observedUnread || []) : [],
    pendingOpen: state.pendingOpen,
    heartbeat: state.heartbeat,
    counts: {
      threads: threads.length,
      sent: threads.flatMap((t) => t.jobs).filter((j) => j.status === "confirmed").length,
      drafts: threads.flatMap((t) => t.jobs).filter((j) => j.status === "draft").length,
      needsHuman: threads.filter((t) => t.needsHuman).length,
    },
    needsHuman: threads.filter((t) => t.needsHuman).map((t) => ({ threadId: t.id, listingTitle: t.listingTitle, reason: t.needsHuman })),
    recentJobs: threads.flatMap((t) => t.jobs.map((j) => ({ threadId: t.id, ...j }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15),
    events: state.events.slice(-40).reverse(),
  };
}
