// Focused end-to-end check of automatic replies (mode "auto") with catch-up,
// using the real extension in Microsoft Edge against the local Facebook-shaped
// page. No Facebook access; Ask Me stubbed. Edge runs off-screen, so the
// monitoring tab and the reply tab are genuine background tabs.
//   node dev/marketplace-reply-poc/edge-live/test/e2e-auto.mjs
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, "..", "extension");
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 4629; // never the live service on 4618
const BASE = "http://127.0.0.1:" + PORT;
const DEBUG = 9335;
const work = mkdtempSync(join(tmpdir(), "r2b-auto-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (name) => console.log("PASS " + name);
const R2B = "2023 Ford Deliver 9 - Visit us at Rent2BuyVans.co.uk";
const LINK = "https://www.rent2buyvans.co.uk/";
const MIN = 60_000;

const ext = join(work, "extension");
cpSync(EXT, ext, { recursive: true });
for (const file of ["manifest.json", "background.js", "content.js", "popup.js", "popup.html"]) {
  const path = join(ext, file);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("127.0.0.1:4618", "127.0.0.1:" + PORT).replaceAll(String.raw`127\.0\.0\.1:4618`, String.raw`127\.0\.0\.1:` + PORT));
}
let service;
function startService() {
  service = spawn(process.execPath, [join(HERE, "..", "service.mjs")], {
    env: { ...process.env, R2B_ASSISTANT_PORT: String(PORT), R2B_EXTENSION_DIR: ext, R2B_ASSISTANT_STATE: join(work, "state.json"), R2B_ASKME_STUB: "1", R2B_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((ok) => service.stdout.once("data", ok));
}
const stopService = () => new Promise((ok) => { if (service.exitCode !== null) return ok(); service.once("exit", ok); service.kill(); });
let edge;

const api = (path, body) => fetch(BASE + path, body ? { method: "POST", headers: { "Content-Type": "application/json", "x-r2b-assistant": "1" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const fb = (path, body) => fetch(BASE + "/__fb/api/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
async function waitFor(fn, label, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(300); }
  throw new Error("Timed out waiting for: " + label);
}
const outgoing = async (id) => ((await fb("state")).threads[id]?.messages || []).filter((m) => m.out);
const replies = async (id, n) => { const o = await outgoing(id); return o.length >= n ? o : null; };
// Watch the monitoring tab throughout: it must stay on the Marketplace list.
const lists = new Set();
let watching = true;
(async () => { while (watching) { const s = await api("/status").catch(() => null); if (s?.heartbeat && s.mode === "auto") lists.add(s.heartbeat.list); await sleep(250); } })();

try {
  await startService();
  const now = Date.now();
  // While "offline": an old message before the cutoff, an unanswered one after
  // it, and an answered conversation with an unanswered follow-up after it.
  await fb("customer", { threadId: "100", name: "Sam", listing: R2B, notice: true, text: "Old question before the cutoff", at: now - 180 * MIN });
  await fb("customer", { threadId: "200", name: "Ann", listing: R2B, notice: true, text: "Do I need a deposit?", at: now - 50 * MIN });
  await fb("customer", { threadId: "300", name: "Bob", listing: R2B, notice: true, text: "How does it work?", at: now - 45 * MIN });
  await fb("send", { threadId: "300", text: "Answered earlier by the team." });
  await fb("customer", { threadId: "300", text: "Can I pay weekly?", at: now - 30 * MIN + 10_000 });
  await api("/control", { mode: "observe", autoFrom: new Date(now - 120 * MIN).toISOString() });
  edge = spawn(EDGE, ["--user-data-dir=" + join(work, "profile"), "--no-first-run", "--no-default-browser-check", "--window-position=-3000,0", "--window-size=1200,900", "--remote-debugging-port=" + DEBUG, "--load-extension=" + ext, BASE + "/"], { stdio: "ignore" });
  await waitFor(async () => (await api("/status")).heartbeat?.account === "100000000000001", "test account reported");
  await api("/control", { authoriseAccount: "100000000000001" });
  await waitFor(async () => { const s = await api("/status"); return s.heartbeat?.list === "marketplace" && s.baselineUnread !== null ? s : null; }, "list open in Observe");
  const on = await api("/control", { mode: "auto" });
  assert.equal(on.mode, "auto", JSON.stringify(on.error || ""));

  const [r200] = await waitFor(() => replies("200", 1), "catch-up reply to the unanswered message");
  const r300 = await waitFor(() => replies("300", 2), "catch-up reply to the unanswered follow-up");
  assert.match(r200.text, /rent2buyvans\.co\.uk/);
  assert.match(r300.at(-1).text, /rent2buyvans\.co\.uk/);
  await sleep(5_000);
  assert.equal((await outgoing("100")).length, 0, "message before the cutoff not answered");
  const scan = (await api("/status")).events.find((e) => e.type === "catchup-scan");
  assert.ok(scan && scan.withAge >= 3, "row ages read: " + JSON.stringify(scan));
  pass("catch-up: unanswered messages since the cutoff answered (new chat and follow-up), each with the link; older message left alone");

  await fb("customer", { threadId: "200", text: "And is insurance included?" });
  const r200b = await waitFor(() => replies("200", 2), "reply to a follow-up question");
  assert.match(r200b.at(-1).text, /rent2buyvans\.co\.uk/);
  await fb("customer", { threadId: "500", name: "Cat", listing: R2B, notice: true, text: "Hi" });
  await fb("customer", { threadId: "500", text: "How much is the deposit?" });
  await waitFor(() => replies("500", 1), "reply to two quick messages");
  await sleep(10_000);
  assert.equal((await outgoing("500")).length, 1, "two quick messages answered with one reply");
  pass("follow-up question answered; two messages sent together answered with one reply");

  await fb("customer", { threadId: "600", name: "Kim", listing: "2019 Ford Transit - Visit us at vanfinancecompany.co.uk", notice: true, text: "how does it work?" });
  await fb("customer", { threadId: "700", name: "Lee", listing: R2B, notice: true, text: "I want to make a complaint" });
  await waitFor(async () => { const s = await api("/status"); return ["600", "700"].every((id) => s.needsHuman.some((n) => n.threadId === id)) ? s : null; }, "Van Finance advert and complaint left for a person", 120_000);
  await sleep(8_000);
  const fbState = await fb("state");
  assert.equal(fbState.sends, 5, "exactly 4 automatic replies plus the seeded team reply (no duplicates)");
  pass("Van Finance advert and complaint left for a person; no duplicate replies anywhere");

  // Service restart with Auto on: a message arriving while it is down is caught up.
  await stopService();
  // The test page lives in the service, so write the message into its saved data.
  const fbFile = join(work, "fb-fixture.json");
  const saved = JSON.parse(readFileSync(fbFile, "utf8"));
  const id = (ms) => "mid.$" + Buffer.from(((0x80n << 160n) | (BigInt(ms) << 16n) | 77n).toString(16).padStart(42, "0"), "hex").toString("base64url") + "x";
  const t0 = Date.now();
  saved.threads["900"] = { name: "Dan", listing: R2B, listingId: "1119983400609221", unread: true, updated: ++saved.seq, messages: [
    { id: id(t0 - 1000), at: t0 - 1000, out: false, text: "Dan started this chat. View buyer profile" },
    { id: id(t0), at: t0, out: false, text: "Can I apply if I'm self-employed?" }] };
  writeFileSync(fbFile, JSON.stringify(saved));
  await sleep(5_000);
  await startService();
  assert.equal((await api("/status")).mode, "auto", "Auto stays on after a restart");
  await waitFor(() => replies("900", 1), "reply to the message that arrived while the service was down", 120_000);
  await sleep(8_000);
  assert.equal((await fb("state")).sends, 6);
  pass("after a service restart Auto was still on and caught up the message that arrived while it was down, once");

  await api("/stop", {});
  await fb("customer", { threadId: "950", name: "Eve", listing: R2B, notice: true, text: "how does it work?" });
  await sleep(10_000);
  assert.equal((await outgoing("950")).length, 0);
  pass("STOP: no reply after the stop");

  watching = false;
  assert.deepEqual([...lists], ["marketplace"], "monitoring tab reported only the Marketplace list while Auto was on");
  pass("monitoring tab stayed on the Marketplace list throughout");
} finally {
  watching = false;
  try { execFileSync("taskkill", ["/PID", String(edge?.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  service?.kill();
}
