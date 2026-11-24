// Focused end-to-end check of automatic replies (mode "auto") with the real
// extension in Microsoft Edge against the local Facebook-shaped page. No
// Facebook access; Ask Me stubbed. Edge runs off-screen, so the assistant tab
// and the reply tab are genuine background tabs.
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

const ext = join(work, "extension");
cpSync(EXT, ext, { recursive: true });
for (const file of ["manifest.json", "background.js", "content.js", "popup.js", "popup.html"]) {
  const path = join(ext, file);
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("127.0.0.1:4618", "127.0.0.1:" + PORT).replaceAll(String.raw`127\.0\.0\.1:4618`, String.raw`127\.0\.0\.1:` + PORT));
}
const service = spawn(process.execPath, [join(HERE, "..", "service.mjs")], {
  env: { ...process.env, R2B_ASSISTANT_PORT: String(PORT), R2B_EXTENSION_DIR: ext, R2B_ASSISTANT_STATE: join(work, "state.json"), R2B_ASKME_STUB: "1", R2B_FIXTURE: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((ok) => service.stdout.once("data", ok));
let edge;

const api = (path, body) => fetch(BASE + path, body ? { method: "POST", headers: { "Content-Type": "application/json", "x-r2b-assistant": "1" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
const fb = (path, body) => fetch(BASE + "/__fb/api/" + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
async function waitFor(fn, label, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(300); }
  throw new Error("Timed out waiting for: " + label);
}
const outgoing = async (id) => ((await fb("state")).threads[id]?.messages || []).filter((m) => m.out);
// Watch the monitoring tab throughout: it must stay on the Marketplace list.
const lists = new Set();
let watching = true;
(async () => { while (watching) { const s = await api("/status").catch(() => null); if (s?.heartbeat && s.mode === "auto") lists.add(s.heartbeat.list); await sleep(250); } })();

try {
  await fb("customer", { threadId: "100", name: "Sam", listing: R2B, notice: true, text: "Old unread question before switch-on" });
  await fb("customer", { threadId: "200", listing: R2B, text: "Earlier question" });
  await fb("send", { threadId: "200", text: "Answered earlier by the team." });
  await fb("read", { threadId: "200" });
  await api("/control", { mode: "observe" });
  edge = spawn(EDGE, ["--user-data-dir=" + join(work, "profile"), "--no-first-run", "--no-default-browser-check", "--window-position=-3000,0", "--window-size=1200,900", "--remote-debugging-port=" + DEBUG, "--load-extension=" + ext, BASE + "/"], { stdio: "ignore" });
  await waitFor(async () => (await api("/status")).heartbeat?.account === "100000000000001", "test account reported", 90_000);
  await api("/control", { authoriseAccount: "100000000000001" });
  await waitFor(async () => { const s = await api("/status"); return s.heartbeat?.list === "marketplace" && s.baselineUnread !== null ? s : null; }, "list open in Observe", 90_000);
  const on = await api("/control", { mode: "auto" });
  assert.equal(on.mode, "auto", JSON.stringify(on.error || ""));
  await waitFor(async () => (await api("/status")).baselineUnread !== null, "auto baseline");
  pass("Auto switched on from a monitored Observe state; 1 already-unread conversation left for a person");

  await fb("customer", { threadId: "500", name: "Van", listing: R2B, notice: true, text: "how does it work?" });
  const sent = await waitFor(async () => { const o = await outgoing("500"); return o.length ? o : null; }, "automatic reply in the new conversation", 90_000);
  const s1 = await waitFor(async () => { const s = await api("/status"); return s.counts.sent === 1 && s.recentJobs[0]?.status === "confirmed" ? s : null; }, "delivery confirmed");
  assert.match(sent[0].text, /rent2buyvans\.co\.uk/);
  assert.equal(s1.auto.sentToday, 1);
  await waitFor(async () => { const ev = (await api("/status")).events; return ev.some((e) => e.type === "reply-tab-opened") && ev.some((e) => e.type === "reply-tab-closed"); }, "reply tab opened and closed", 30_000);
  assert.equal((await outgoing("100")).length, 0);
  pass("new Rent2Buy enquiry answered once in a background reply tab, with the website link, delivery confirmed; old unread chat untouched");

  await fb("customer", { threadId: "500", text: "and what about insurance?" });
  await fb("customer", { threadId: "100", text: "Hello again" });
  await fb("customer", { threadId: "600", name: "Kim", listing: "2019 Ford Transit - Visit us at vanfinancecompany.co.uk", notice: true, text: "how does it work?" });
  await fb("customer", { threadId: "700", name: "Lee", listing: R2B, notice: true, text: "I want to make a complaint" });
  await fb("customer", { threadId: "750", name: "Max", listing: R2B, text: "is it automatic?" });
  const s2 = await waitFor(async () => { const s = await api("/status"); return ["600", "700"].every((id) => s.needsHuman.some((n) => n.threadId === id)) ? s : null; }, "Van Finance advert and complaint handed to a person", 120_000);
  await sleep(8_000);
  const fbState = await fb("state");
  assert.equal(fbState.sends, 2, "only the one automatic reply (plus the seeded team reply)");
  assert.equal((await outgoing("500")).length, 1);
  assert.ok(s2.events.some((e) => e.type === "left-for-person" && e.threadId === "750"), "a chat without Facebook's start notice is left for a person");
  pass("no second reply in the answered chat; old chat, Van Finance advert, complaint and an unproven-new chat all left for a person");

  await api("/stop", {});
  await fb("customer", { threadId: "800", name: "Ann", listing: R2B, notice: true, text: "how does it work?" });
  await sleep(10_000);
  assert.equal((await outgoing("800")).length, 0);
  pass("STOP: no reply to a new enquiry after the stop");

  // Test restriction: Auto limited to the buyer "Van".
  await api("/control", { mode: "observe" });
  await waitFor(async () => { const s = await api("/status"); return s.heartbeat?.list === "marketplace" && s.baselineUnread !== null ? s : null; }, "Observe baseline");
  const limited = await api("/control", { mode: "auto", testBuyer: "Van" });
  assert.equal(limited.auto?.testBuyer, "Van", JSON.stringify(limited.error || ""));
  await waitFor(async () => (await api("/status")).baselineUnread !== null, "auto baseline (test buyer)");
  await fb("customer", { threadId: "960", name: "Kim", listing: R2B, notice: true, text: "how does it work?" });
  await waitFor(async () => (await api("/status")).events.some((e) => e.type === "left-for-person" && e.threadId === "960"), "other buyer left for a person", 60_000);
  await fb("customer", { threadId: "970", name: "Van", listing: R2B, notice: true, text: "how does it work?" });
  await waitFor(async () => (await outgoing("970")).length === 1, "reply to the test buyer", 90_000);
  await sleep(3_000);
  const kim = (await fb("state")).threads["960"];
  assert.equal(kim.unread, true, "the other buyer's conversation was never opened");
  assert.equal(kim.messages.filter((m) => m.out).length, 0);
  await api("/control", { mode: "observe" });
  pass("test restriction: another buyer's new enquiry was never opened (still unread, no reply); Van's was answered once");

  watching = false;
  assert.deepEqual([...lists], ["marketplace"], "monitoring tab reported only the Marketplace list while Auto was on");
  pass("monitoring tab stayed on the Marketplace list throughout; no report from the reply tab (0.3.20 fix)");
} finally {
  watching = false;
  try { execFileSync("taskkill", ["/PID", String(edge?.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  service.kill();
}
