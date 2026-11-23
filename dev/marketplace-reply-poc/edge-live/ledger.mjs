// Durable decision ledger for the live Edge Marketplace assistant.
//
// The browser extension reports what it sees; this ledger alone decides whether a
// reply may be drafted or sent. Every decision is persisted before the extension
// is told to act, so a browser crash, Edge restart or Windows reboot can never
// cause the same customer message to be answered twice.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const MODES = ["off", "observe", "draft", "send"];
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

export function setMode(state, mode, { allowThreads, allowAll } = {}) {
  if (!MODES.includes(mode)) throw new TypeError("Unknown mode");
  const wasOff = state.mode === "off";
  state.mode = mode;
  if (Array.isArray(allowThreads)) state.allowThreads = allowThreads.filter((id) => THREAD_ID.test(String(id))).map(String);
  if (typeof allowAll === "boolean") state.allowAll = allowAll;
  if (mode === "off") {
    state.enabledAt = null;
    state.inboxBaseline = null;
    state.pendingOpen = [];
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

export function recordHeartbeat(state, { health, visibility, url, rows, unread }) {
  const previous = state.heartbeat?.health;
  state.heartbeat = {
    at: new Date().toISOString(), health: String(health || "unknown"), visibility: String(visibility || ""),
    url: String(url || "").slice(0, 200), rows: Number(rows) || 0, unread: Number(unread) || 0,
  };
  if (state.mode !== "off" && health !== previous && health !== "healthy" && health !== "loading") {
    logEvent(state, "health", { health });
  }
}

// Inbox list snapshot: [{ id, unread }]. Returns the thread to open next, if any.
export function inspectInbox(state, threads) {
  if (state.mode === "off") return { open: null };
  const rows = (Array.isArray(threads) ? threads : []).filter((row) => THREAD_ID.test(String(row?.id))).slice(0, 200);
  const unread = rows.filter((row) => row.unread === true).map((row) => String(row.id));
  if (!state.inboxBaseline) {
    state.inboxBaseline = { at: new Date().toISOString(), unread };
    if (unread.length) logEvent(state, "baseline", { excludedUnread: unread.length });
    return { open: null };
  }
  const excluded = new Set(state.inboxBaseline.unread);
  // A baseline-unread conversation that is later read and then becomes unread
  // again has a genuinely new message.
  const readNow = new Set(rows.filter((row) => row.unread === false).map((row) => String(row.id)));
  state.inboxBaseline.unread = state.inboxBaseline.unread.filter((id) => !readNow.has(id));
  for (const id of unread) {
    if (excluded.has(id) || state.pendingOpen.includes(id)) continue;
    const thread = state.threads[id];
    if (thread?.needsHuman) continue;
    state.pendingOpen.push(id);
    logEvent(state, "unread", { threadId: id });
  }
  return { open: state.pendingOpen[0] || null };
}

export function resolveProduct(listingTitle, defaultProduct) {
  const text = String(listingTitle || "");
  if (/\brent[\s-]*(?:2|to)[\s-]*buy\b/i.test(text)) return "rent2buy";
  if (/\bfinance\b/i.test(text)) return "finance";
  return defaultProduct === "finance" || defaultProduct === "rent2buy" ? defaultProduct : null;
}

// Open-thread snapshot. Returns the customer text to answer, or a reason not to.
export function inspectThread(state, snapshot, { defaultProduct } = {}) {
  const threadId = String(snapshot?.threadId || "");
  if (!THREAD_ID.test(threadId)) return { action: "none", reason: "No conversation identity" };
  if (state.mode === "off") return { action: "none", reason: "Assistant is off" };
  const flagged = state.pendingOpen.includes(threadId);
  state.pendingOpen = state.pendingOpen.filter((id) => id !== threadId);
  const messages = (Array.isArray(snapshot.messages) ? snapshot.messages : [])
    .filter((m) => typeof m?.id === "string" && MESSAGE_ID.test(m.id) && ["incoming", "outgoing"].includes(m.direction))
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
  if (!existing || existing.rebaseline) {
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
  return { action: "draft", threadId, product: thread.product, message: text, messageIds: customer.map((m) => m.id) };
}

function confirmByObservation(thread, outgoing) {
  const job = thread.jobs.findLast((item) => OPEN_JOB.has(item.status) || item.status === "unconfirmed");
  if (!job) return;
  const head = normalise(job.text).slice(0, 40);
  if (head && normalise(outgoing.text).startsWith(head)) {
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
  if (state.mode !== "send" || !(state.allowAll || state.allowThreads.includes(thread.id)) || thread.needsHuman) {
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
}

export function resumeThread(state, threadId) {
  const thread = state.threads[threadId];
  if (!thread) return false;
  thread.needsHuman = null;
  for (const job of thread.jobs) if (job.status === "unconfirmed") job.status = "abandoned";
  logEvent(state, "resume", { threadId });
  return true;
}

export function publicStatus(state) {
  const threads = Object.values(state.threads);
  return {
    mode: state.mode,
    allowAll: state.allowAll,
    allowThreads: state.allowThreads,
    enabledAt: state.enabledAt,
    baselineUnread: state.inboxBaseline?.unread.length ?? null,
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
