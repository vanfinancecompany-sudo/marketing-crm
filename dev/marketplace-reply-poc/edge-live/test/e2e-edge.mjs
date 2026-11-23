// End-to-end check of the real extension and service in Microsoft Edge against
// a local page with Facebook's chat structure. No Facebook access; Ask Me stubbed.
//
// Edge is launched WITHOUT browser automation, so page visibility, background
// timer throttling and tab lifecycle are the browser's real behaviour (driving
// pages with Playwright/CDP emulates focus and makes every tab "visible").
// The Edge window is placed off-screen and a control page is the active tab, so
// the assistant tab is a genuine background tab.
//
//   node dev/marketplace-reply-poc/edge-live/test/e2e-edge.mjs
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..", "extension");
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
// Own port, so a live assistant service on 4618 is never touched.
const PORT = Number(process.env.E2E_PORT || 4628);
const BASE = "http://127.0.0.1:" + PORT;
const DEBUG = 9334; // read-only target listing over HTTP; nothing attaches to pages
const work = mkdtempSync(join(tmpdir(), "r2b-e2e-"));
const stateFile = join(work, "state.json");
let profile = join(work, "edge-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const pass = (name) => { results.push("PASS " + name); console.log("PASS " + name); };

let service;
let edge;
function startService() {
  service = spawn(process.execPath, [join(HERE, "..", "service.mjs")], {
    env: { ...process.env, R2B_ASSISTANT_PORT: String(PORT), R2B_ASSISTANT_STATE: stateFile, R2B_ASKME_STUB: "1", R2B_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((ok) => service.stdout.once("data", ok));
}
const stopService = () => new Promise((ok) => { if (service.exitCode !== null) return ok(); service.once("exit", ok); service.kill(); });

// Edge 157 disables a --load-extension (command-line) extension on every later
// launch of the same profile (disable reason 1<<24, developer mode is a protected
// preference). That is a harness limit: Load unpacked from edge://extensions is
// stored differently. The restart step therefore relaunches on a fresh profile;
// adoption of a session-restored tab must be checked manually on the real PC.
let launches = 0;
function startEdge(extra = []) {
  const ext = join(work, "extension-" + ++launches);
  cpSync(EXT, ext, { recursive: true });
  for (const file of ["manifest.json", "background.js", "content.js", "popup.js", "popup.html"]) {
    const path = join(ext, file);
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("127.0.0.1:4618", "127.0.0.1:" + PORT).replaceAll(String.raw`127\.0\.0\.1:4618`, String.raw`127\.0\.0\.1:` + PORT));
  }
  edge = spawn(EDGE, [
    "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
    "--window-position=-3000,0", "--window-size=1200,900",
    "--remote-debugging-port=" + DEBUG, "--load-extension=" + ext, ...extra, BASE + "/",
  ], { stdio: "ignore" });
}
// Graceful close at browser level (no page attach): an ordinary Edge restart.
async function closeEdge() {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json());
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok) => { ws.onopen = ok; });
  ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  await new Promise((ok) => edge.once("exit", ok));
}
function killEdge() {
  // Hard kill of the whole Edge process tree: the same as a crash or power loss.
  try { execFileSync("taskkill", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
}

const api = (path, body) => fetch(BASE + path, body ? {
  method: "POST", headers: { "Content-Type": "application/json", "x-r2b-assistant": "1" }, body: JSON.stringify(body),
} : {}).then((r) => r.json());
const fb = (path, body) => fetch(BASE + "/__fb/api/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const assistantTabs = async () => (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json()))
  .filter((t) => t.type === "page" && /\/__fb\/(inbox|messages)/.test(t.url));

async function waitFor(fn, label, ms = 45_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(300);
  }
  throw new Error("Timed out waiting for: " + label);
}
const sentCount = async (n) => { const s = await api("/status"); return s.counts.sent === n ? s : null; };

try {
  await startService();
  // Seed "Facebook": one conversation already unread before switch-on, one read conversation.
  await fb("customer", { threadId: "100", name: "Sam", text: "Old unanswered message before switch-on" });
  await fb("customer", { threadId: "200", text: "Earlier question, answered by a person" });
  await fb("send", { threadId: "200", text: "Answered earlier by the team." });
  await fb("read", { threadId: "200" });
  await api("/control", { mode: "observe" });
  startEdge();

  const s0 = await waitFor(async () => { const s = await api("/status"); return s.baselineUnread !== null && s.heartbeat ? s : null; }, "assistant tab baseline", 60_000);
  assert.equal(s0.baselineUnread, 1);
  assert.equal((await assistantTabs()).length, 1);
  pass("extension opened one background assistant tab and baselined 1 already-unread conversation");

  // 0. Observe is passive: a new enquiry is noticed but never opened, read or answered.
  await fb("customer", { threadId: "300", name: "Jo", text: "Observe-only enquiry" });
  await waitFor(async () => (await api("/status")).events.some((e) => e.type === "unread-observed" && e.threadId === "300"), "observed unread");
  await sleep(8_000);
  const so = await api("/status");
  const fbo = await fb("state");
  assert.equal(fbo.threads["300"].unread, true, "conversation must stay unread");
  assert.ok(!fbo.threads["300"].messages.some((m) => m.out));
  assert.equal(so.counts.threads, 0);
  assert.equal(so.recentJobs.length, 0);
  assert.ok(!(await assistantTabs()).some((t) => t.url.includes("/messages/t/")), "assistant tab never opened a conversation");
  pass("Observe noticed the new unread conversation without opening it, changing read status, calling Ask Me or replying");

  // Row and unread classification under the conditions seen on the real account.
  // Assistant-tab diagnostics refresh about once a minute (background timers are throttled).
  const diag = await waitFor(async () => {
    const d = (await api("/diagnostics"))["assistant-tab"];
    return d?.rows.some((r) => r.id === "300") ? d : null;
  }, "diagnostics including conversation 300", 150_000);
  const row = (id) => diag.rows.find((r) => r.id === id);
  assert.equal(row("300").unread, true);
  assert.ok(row("300").signals.dot && row("300").signals.bold, JSON.stringify(row("300").signals));
  assert.equal(row("200").unread, false, "read row with a 'Mark as unread' label must be read");
  assert.ok(row("300").size[1] <= 80, "row is one conversation, not the whole list: " + row("300").size);
  for (const id of ["901", "902", "903"]) assert.equal(row(id).unread, false);
  assert.ok(diag.threadLinkPatterns.includes("/__fb/marketplace/t/#/"));
  assert.ok(!JSON.stringify(diag).includes("Observe-only enquiry"), "diagnostics must not contain message text");
  pass(`diagnostics: per-conversation rows (${row("300").size[1]}px), unread by dot+bold, 'Mark as unread' rows read, contact links not unread, no message text`);

  // Deliberate activation: everything unread now is left for a person.
  await api("/control", { mode: "send", allowThreads: ["200", "300"] });
  await waitFor(async () => (await api("/status")).baselineUnread === 2, "send baseline");
  pass("switching Observe to Send baselined both unread conversations for a person");

  // 1. New message in a closed, read conversation while the tab is in the background.
  const t0 = Date.now();
  await fb("customer", { threadId: "200", text: "Do your vans come with a warranty?" });
  const s1 = await waitFor(() => sentCount(1), "first reply");
  const latency = Date.now() - t0;
  const fb1 = await fb("state");
  assert.equal(fb1.sends, 2); // 1 seeded human reply + 1 assistant reply
  assert.equal(s1.heartbeat.visibility, "hidden");
  assert.match(fb1.threads["200"].messages.at(-1).text, /warranty/i);
  assert.match(fb1.threads["200"].messages.at(-1).text, /https:\/\/www\.rent2buyvans\.co\.uk\//);
  assert.equal(s1.recentJobs[0].customer, "Do your vans come with a warranty?");
  pass(`background tab (visibility=${s1.heartbeat.visibility}) detected the new message and replied once in ${latency} ms, with the website link`);
  assert.ok(!fb1.threads["100"].messages.some((m) => m.out));
  pass("conversation already unread at switch-on was left for a person");

  // 2. Escalation.
  await fb("customer", { threadId: "200", text: "I want to make a complaint" });
  await waitFor(async () => (await api("/status")).needsHuman.length === 1, "escalation");
  await sleep(3_000);
  assert.equal((await fb("state")).sends, 2);
  pass("complaint escalated to a person and no reply was sent");
  await api("/control", { resumeThread: "200" });

  // 3. Emergency stop.
  await api("/stop", {});
  await fb("customer", { threadId: "200", text: "Hello? Anyone there?" });
  await sleep(10_000);
  assert.equal((await fb("state")).sends, 2);
  pass("STOP: no reply to a message arriving after the stop");

  // 4. Send deliberately switched on, then Edge and the service restart.
  await api("/control", { mode: "send", allowThreads: ["200"] });
  assert.equal((await api("/status")).mode, "send");
  // Edge restart (graceful by default; E2E_CRASH=1 hard-kills) and service restart.
  if (process.env.E2E_CRASH === "1") killEdge(); else await closeEdge();
  await stopService();
  await sleep(2_000);
  await startService();
  const persisted = await api("/status");
  assert.equal(persisted.counts.sent, 1);
  assert.equal(persisted.mode, "off");
  assert.ok(persisted.events.some((e) => e.type === "send-not-restored"));
  pass("Send was NOT restored after the restart (came back Off); ledger and history survived");
  await api("/control", { mode: "send", allowThreads: ["200"] });
  profile = join(work, "edge-profile-after-restart");
  startEdge();
  await waitFor(async () => (await api("/status")).baselineUnread !== null, "baseline after restart", 60_000);
  // Messages that arrived while the assistant was off were not answered.
  await sleep(4_000);
  assert.equal((await fb("state")).sends, 2);
  pass("conversation left unread while stopped is held for a person after restart (no reply)");
  await fb("read", { threadId: "200" }); // a person opens it
  await sleep(2_000);
  await fb("customer", { threadId: "200", text: "Can I apply if I'm self-employed?" });
  await waitFor(() => sentCount(2), "reply after restart");
  await sleep(6_000);
  const fb2 = await fb("state");
  assert.equal(fb2.sends, 3);
  const tabs = await assistantTabs();
  assert.equal(tabs.length, 1, "restored assistant tab adopted, no duplicate: " + JSON.stringify(tabs.map((t) => t.url)));
  pass("after Edge and service restart: exactly one assistant tab and one reply to the new message");
  console.log("Reply after restart:", JSON.stringify(fb2.threads["200"].messages.at(-1).text));
  const asked = (await api("/status")).recentJobs[0].customer;
  assert.match(asked, /self-employed/);
  assert.doesNotMatch(asked, /complaint/);
  console.log("Ask Me request for that reply:", JSON.stringify(asked));
  assert.ok(!fb2.threads["300"].messages.some((m) => m.out));
  pass("conversation first seen in Observe was never answered automatically");
} finally {
  killEdge();
  await stopService().catch(() => {});
  writeFileSync(join(work, "results.txt"), results.join("\n"));
  console.log(results.length + " checks passed. Work dir: " + work);
}
