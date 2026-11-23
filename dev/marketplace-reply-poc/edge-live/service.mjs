// Local service for the live Edge Marketplace assistant.
//   node dev/marketplace-reply-poc/edge-live/service.mjs
// Listens on 127.0.0.1 only. Starts in Off mode unless the saved state says otherwise.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { draftMarketplaceReply } from "../assistant.mjs";
import { liveResponder } from "./askme-live.mjs";
import {
  authoriseSend, inspectInbox, inspectThread, loadState, logEvent, publicStatus, recordDraft,
  recordHeartbeat, recordSendResult, resumeThread, saveState, setMode, startupMode,
} from "./ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.R2B_ASSISTANT_PORT || 4618);
const STATE_FILE = process.env.R2B_ASSISTANT_STATE
  || join(process.env.LOCALAPPDATA || HERE, "Rent2BuyMarketplaceAssistant", "state.json");
const STOP_FILE = join(dirname(STATE_FILE), "STOP");
const DEFAULT_PRODUCT = process.env.R2B_DEFAULT_PRODUCT ?? "rent2buy";
const STUB = process.env.R2B_ASKME_STUB === "1";
// Test-only Facebook-shaped page; never enabled in normal use.
const fixture = process.env.R2B_FIXTURE === "1"
  ? (await import("./test/fb-fixture.mjs")).createFixture(join(dirname(STATE_FILE), "fb-fixture.json"))
  : null;

let state = loadState(STATE_FILE);
const sendWasOn = startupMode(state);
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
  if (decision.action !== "draft") return decision;
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
  saveState(STATE_FILE, state);
  return result;
}

const ROUTES = {
  "GET /status": () => ({ ...publicStatus(state), ...(fixture ? { fixtureHome: "http://127.0.0.1:" + PORT + "/__fb/inbox/" } : {}) }),
  "POST /control": (body) => {
    if (body.resumeThread) resumeThread(state, String(body.resumeThread));
    if (body.mode) setMode(state, body.mode, body);
    return publicStatus(state);
  },
  "POST /stop": () => { setMode(state, "off"); logEvent(state, "emergency-stop"); return publicStatus(state); },
  "POST /heartbeat": (body) => { recordHeartbeat(state, body); return { mode: state.mode }; },
  "POST /inbox": (body) => ({ mode: state.mode, ...inspectInbox(state, body.threads) }),
  "POST /thread": (body) => handleThread(body),
  "POST /go": (body) => authoriseSend(state, String(body.jobId)),
  "POST /sent": (body) => { recordSendResult(state, String(body.jobId), body); return { ok: true }; },
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
