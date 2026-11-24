// Local service for the live Edge Marketplace assistant.
//   node dev/marketplace-reply-poc/edge-live/service.mjs
// Listens on 127.0.0.1 only. Starts in Off mode unless the saved state says otherwise.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { draftMarketplaceReply } from "../assistant.mjs";
import { liveResponder } from "./askme-live.mjs";
import {
  authoriseSend, inspectInbox, inspectThread, loadState, logEvent, publicStatus, recordDraft,
  recordHeartbeat, recordSendResult, resumeThread, saveState, setMode, startupMode,
  startPilot, verifyPilot, cancelPilot, pilotTimeout, finishPilot, startFind, recordFind, findTimeout,
  migrateSafetyStop, resetSafetyStop, approveSend, approvedSendTimeout,
  autoCheckThread, recordAutoCheck, autoCheckTimeout,
  authoriseAccount, accountProblem, permitOpenerClick,
} from "./ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.R2B_ASSISTANT_PORT || 4618);
const STATE_FILE = process.env.R2B_ASSISTANT_STATE
  || join(process.env.LOCALAPPDATA || HERE, "Rent2BuyMarketplaceAssistant", "state.json");
const STOP_FILE = join(dirname(STATE_FILE), "STOP");
const DIAGNOSTICS_FILE = join(dirname(STATE_FILE), "inbox-diagnostics.json");
// Latest structural snapshot per source (the assistant tab, or your own tab via
// the popup). Kept outside the ledger; no message text is ever included.
let diagnostics = existsSync(DIAGNOSTICS_FILE) ? JSON.parse(readFileSync(DIAGNOSTICS_FILE, "utf8")) : {};
const DEFAULT_PRODUCT = process.env.R2B_DEFAULT_PRODUCT ?? "rent2buy";
// The extension in this install. When its version on disk is newer than the
// one running in Edge, the extension reloads itself (see background.js).
const EXTENSION_DIR = process.env.R2B_EXTENSION_DIR || join(HERE, "extension");
function expectedExtensionVersion() {
  try { return JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8")).version; } catch { return null; }
}
const STUB = process.env.R2B_ASKME_STUB === "1";
// Test-only Facebook-shaped page; never enabled in normal use.
const fixture = process.env.R2B_FIXTURE === "1"
  ? (await import("./test/fb-fixture.mjs")).createFixture(join(dirname(STATE_FILE), "fb-fixture.json"))
  : null;

let state = loadState(STATE_FILE);
const sendWasOn = startupMode(state);
migrateSafetyStop(state);
saveState(STATE_FILE, state);
let queue = Promise.resolve();
// Serialise every state change so two tabs or retries can never race a claim.
const locked = (fn) => (queue = queue.then(fn, fn));

function enforceStopFile() {
  if (existsSync(STOP_FILE) && state.mode !== "off") {
    setMode(state, "off");
    logEvent(state, "stop-file");
  }
}

async function stubResponder(request) {
  if (/warranty/i.test(request.message)) return { status: "ready", reply: "Stub answer about warranty.", actions: [] };
  return { status: "ready", reply: "Stub Ask Me answer.", actions: [] };
}

async function handleThread(body) {
  const decision = inspectThread(state, body, { defaultProduct: DEFAULT_PRODUCT });
  saveState(STATE_FILE, state);
  if (decision.action !== "draft") {
    finishPilot(state, { snapshot: body, structure: body.structure, decision });
    return decision;
  }
  const thread = state.threads[decision.threadId];
  const started = performance.now();
  let draft;
  try {
    draft = await draftMarketplaceReply(
      { product: decision.product, message: decision.message, history: thread.history.slice(-8) },
      { respond: STUB ? stubResponder : liveResponder(thread) },
    );
  } catch (error) {
    draft = { reason: "Ask Me unavailable: " + error.message };
  }
  logEvent(state, "askme", { threadId: thread.id, ms: Math.round(performance.now() - started) });
  enforceStopFile();
  const result = recordDraft(state, decision, draft);
  finishPilot(state, { snapshot: body, structure: body.structure, decision, outcome: result, askMeMs: Math.round(performance.now() - started) });
  saveState(STATE_FILE, state);
  return result;
}

// Owner-requested: regenerate the waiting draft for one conversation from the
// same customer message through the normal pipeline (after a routing fix).
async function redraftLatest(threadId) {
  const thread = state.threads[threadId];
  const job = thread?.jobs.findLast((j) => j.status === "draft");
  if (!job) throw new Error("No waiting draft for that conversation");
  const draft = await draftMarketplaceReply({ product: thread.product, message: job.customer, history: [] }, { respond: STUB ? stubResponder : liveResponder(thread) });
  if (!draft.text) throw new Error("The new draft was handed to a person: " + draft.reason);
  job.status = "superseded";
  thread.jobs.push({ ...job, id: crypto.randomUUID(), text: draft.text, status: "draft", at: new Date().toISOString(), supersedes: job.id });
  logEvent(state, "redraft", { threadId });
}

function statusWithExtension() {
  const status = publicStatus(state);
  const expected = expectedExtensionVersion();
  const running = state.heartbeat?.ext || null;
  return {
    ...status,
    // A pre-0.3.0 extension reports no version and cannot update itself.
    tabCensus: state.tabCensus || null,
    ...(process.env.R2B_TAB_CREATE_GAP_MS ? { tabCreateGapMs: Number(process.env.R2B_TAB_CREATE_GAP_MS) } : {}),
    extension: { running, expected, updatePending: Boolean(expected && state.heartbeat && running !== expected), manualReloadNeeded: Boolean(state.heartbeat && !running) },
    ...(fixture ? { fixtureHome: "http://127.0.0.1:" + PORT + "/__fb/inbox/" } : {}),
  };
}

const ROUTES = {
  "GET /status": () => statusWithExtension(),
  "POST /control": async (body) => {
    if (body.resumeThread) resumeThread(state, String(body.resumeThread));
    if (body.cancelPilot) cancelPilot(state);
    if (body.mode === "auto" && state.mode !== "auto") {
      // Automatic replies start only from a healthy, monitored Observe state.
      if (state.mode !== "observe") throw new Error("Switch on automatic replies from Observe mode");
      if (accountProblem(state)) throw new Error(accountProblem(state));
      if (state.openerTrip || state.openerHold) throw new Error("Clear the safety stop first");
      if (state.heartbeat?.list !== "marketplace") throw new Error("The Marketplace list is not open in the assistant tab yet");
    }
    // Catch-up start for automatic replies (default 12:00 UK, 24 Nov 2026).
    if (body.autoFrom) {
      const at = Date.parse(body.autoFrom);
      if (!Number.isFinite(at) || at > Date.now()) throw new Error("Invalid catch-up start");
      state.autoFrom = new Date(at).toISOString();
      logEvent(state, "auto-from", { from: state.autoFrom });
    }
    if (body.mode) { cancelPilot(state); setMode(state, body.mode, body.mode === "auto" ? { allowAll: false, testBuyer: body.testBuyer ?? null } : body); }
    if (body.startPilot) startPilot(state, body.startPilot);
    if (body.find) startFind(state, body.find);
    if (body.approveSend) approveSend(state, body.approveSend);
    if (body.authoriseAccount) authoriseAccount(state, body.authoriseAccount);
    if (body.redraft) await redraftLatest(String(body.redraft));
    if (body.showAssistantTab) { state.showTab = { seconds: Math.min(Number(body.showAssistantTab.seconds) || 10, 20), at: new Date().toISOString() }; state.showUntil = new Date(Date.now() + (state.showTab.seconds + 10) * 1000).toISOString(); logEvent(state, "show-tab-requested", { seconds: state.showTab.seconds }); }
    if (body.resetOpener) resetSafetyStop(state);
    return statusWithExtension();
  },
  "POST /stop": () => { cancelPilot(state); setMode(state, "off"); logEvent(state, "emergency-stop"); return statusWithExtension(); },
  "POST /heartbeat": (body) => {
    recordHeartbeat(state, body);
    // Clear only once the page reports a real, non-tripped opener status (a fresh
    // page reports an empty status before it has checked the stop).
    if (state.resetOpenerRequested && body.stopFlag === false) state.resetOpenerRequested = false; // page confirmed the stop is cleared
    pilotTimeout(state);
    approvedSendTimeout(state);
    findTimeout(state);
    autoCheckTimeout(state);
    // Paused in any account problem: the page does nothing at all.
    const paused = state.mode === "off" ? null : accountProblem(state);
    if (paused) return { mode: state.mode, paused, extensionVersion: expectedExtensionVersion() };
    return {
      mode: state.mode,
      verifyThread: state.pilot?.status === "verifying" ? state.pilot.threadId : autoCheckThread(state),
      findWords: state.finder?.status === "searching" ? state.finder.words : null,
      resetOpener: state.resetOpenerRequested === true,
      safetyStop: state.openerTrip?.reason || null,
      // Handed to the page once, within a minute of the owner's request.
      showTab: (() => { const t = state.showTab; state.showTab = null; return t && Date.now() - Date.parse(t.at) < 60_000 ? t : null; })(),
      extensionVersion: expectedExtensionVersion(),
    };
  },
  "POST /pilot/verify": (body) => autoCheckThread(state) === String(body.threadId) ? recordAutoCheck(state, body) : verifyPilot(state, body),
  "POST /find/result": (body) => recordFind(state, body),
  "POST /opener-note": (body) => { logEvent(state, "opener-note", { note: String(body.note || "").slice(0, 200) }); return { ok: true }; },
  "POST /tab-event": (body) => {
    const detail = Object.fromEntries(Object.entries(body).filter(([k, v]) => k !== "kind" && (typeof v !== "string" || v.length <= 200)));
    logEvent(state, String(body.kind || "tab-event").slice(0, 40), detail);
    return { ok: true };
  },
  "POST /tab-census": (body) => {
    const census = { at: new Date().toISOString(), tabs: Number(body.tabs) || 0, facebookTabs: Number(body.facebookTabs) || 0, pinnedFacebookTabs: Number(body.pinnedFacebookTabs) || 0, assistantTabId: body.assistantTabId ?? null, assistantTitleMarked: body.assistantTitleMarked ?? null };
    const prev = state.tabCensus;
    if (prev && (prev.facebookTabs !== census.facebookTabs || prev.pinnedFacebookTabs !== census.pinnedFacebookTabs)) {
      logEvent(state, "tab-census-change", { facebookTabs: prev.facebookTabs + " -> " + census.facebookTabs, pinnedFacebookTabs: prev.pinnedFacebookTabs + " -> " + census.pinnedFacebookTabs });
    }
    state.tabCensus = census;
    return { ok: true };
  },
  "POST /assist": (body) => { logEvent(state, "visibility-assist", { opened: Boolean(body.opened) }); return { ok: true }; },
  "POST /opener/permit": () => permitOpenerClick(state),
  "POST /inbox": (body) => accountProblem(state) ? { mode: state.mode, open: null, paused: accountProblem(state) } : ({ mode: state.mode, ...inspectInbox(state, body.threads, { listReady: body.listReady !== false, list: typeof body.list === "string" ? body.list.slice(0, 40) : null }) }),
  "POST /thread": (body) => accountProblem(state) ? { action: "none", reason: accountProblem(state) } : handleThread(body),
  "POST /go": (body) => authoriseSend(state, String(body.jobId)),
  "POST /sent": (body) => { recordSendResult(state, String(body.jobId), body); return { ok: true }; },
  "GET /diagnostics": () => diagnostics,
  "POST /diagnostics": (body) => {
    const source = body.source === "your-tab" ? "your-tab" : "assistant-tab";
    if (!body.snapshot || typeof body.snapshot !== "object") throw new Error("No snapshot");
    diagnostics = { ...diagnostics, [source]: { receivedAt: new Date().toISOString(), ...body.snapshot } };
    writeFileSync(DIAGNOSTICS_FILE, JSON.stringify(diagnostics, null, 1));
    return { ok: true };
  },
};

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 400_000) throw new Error("Body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return send(response, 200, readFileSync(join(HERE, "control.html"), "utf8"), "text/html; charset=utf-8");
    }
    if (fixture && url.pathname.startsWith("/__fb/")) {
      const body = request.method === "POST" ? await readJson(request) : null;
      if (fixture(request, response, url, body)) return;
      return send(response, 200, readFileSync(join(HERE, "test", "fb-shape.html"), "utf8"), "text/html; charset=utf-8");
    }
    const route = ROUTES[request.method + " " + url.pathname];
    if (!route) return send(response, 404, { error: "Not found" });
    // A custom header cannot be sent cross-site without a CORS preflight,
    // which this server never approves.
    if (request.method === "POST" && request.headers["x-r2b-assistant"] !== "1") return send(response, 403, { error: "Forbidden" });
    const body = request.method === "POST" ? await readJson(request) : {};
    const run = async () => {
      enforceStopFile();
      const value = await route(body);
      saveState(STATE_FILE, state);
      return value;
    };
    // Only the thread route awaits Ask Me; it is serialised. Every other route is
    // synchronous, so Stop and the send check are never queued behind a draft.
    const result = url.pathname === "/thread" ? await locked(run) : await run();
    send(response, 200, result);
  } catch (error) {
    send(response, 400, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ event: "listening", port: PORT, stateFile: STATE_FILE, mode: state.mode, sendWasOn, stub: STUB }));
});
