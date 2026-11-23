import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReplySimulator, LISTINGS } from "../dev/marketplace-reply-poc/state.mjs";
import { createFixtureMiddleware } from "../dev/marketplace-reply-poc/plugin.mjs";

function removeFixture(folder) {
  for (const file of ["state.json", "state.json.next"]) rmSync(join(folder, file), { force: true });
  rmdirSync(folder);
}

function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), "marketplace-reply-state-"));
  t.after(() => removeFixture(folder));
  const file = join(folder, "state.json");
  let time = Date.UTC(2026, 10, 23, 12);
  const restart = () => createReplySimulator(file, () => time);
  return { simulator: restart(), restart, advance: (ms) => { time += ms; } };
}

function observe(simulator, { health = "healthy", showReceipt = true } = {}) {
  return simulator.observe({
    health,
    rows: simulator.snapshot().threads.map(({ id, listingId, outgoing }) => ({
      threadId: id,
      listingId,
      outgoingId: showReceipt ? outgoing?.id : undefined,
    })),
  });
}

test("defaults off, excludes earlier threads, and routes the two fixture listings", (t) => {
  const { simulator } = setup(t);
  assert.equal(simulator.snapshot().enabled, false);
  simulator.addEnquiry("finance");
  assert.equal(observe(simulator), null);
  simulator.setEnabled(true);
  assert.equal(observe(simulator), null);
  simulator.addEnquiry("finance");
  simulator.addEnquiry("rent2buy");
  assert.equal(observe(simulator).text, LISTINGS["1001"].reply);
  assert.equal(observe(simulator).text, LISTINGS["2002"].reply);
  assert.equal(observe(simulator), null);
  assert.equal(simulator.snapshot().threads[0].sendCount, 0);
});

test("records one acknowledgement despite duplicate observations and dispatch attempts", (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("finance");
  const reply = observe(simulator);
  assert.equal(observe(simulator), null);
  assert.equal(simulator.deliver(reply), true);
  assert.equal(simulator.deliver(reply), false);
  assert.equal(simulator.snapshot().threads[0].status, "Sending");

  const recovered = restart();
  assert.equal(observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Sent");
  assert.equal(recovered.snapshot().threads[0].sendCount, 1);
  assert.equal(observe(recovered), null);
});

test("reconciles a delayed receipt after restart without a second send", (t) => {
  const { simulator, advance, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("rent2buy");
  const reply = observe(simulator);
  assert.equal(simulator.deliver(reply), true);
  advance(8_001);
  const recovered = restart();
  assert.equal(observe(recovered, { showReceipt: false }), null);
  assert.equal(recovered.snapshot().threads[0].status, "Unconfirmed");
  assert.equal(observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Sent");
  assert.equal(recovered.snapshot().threads[0].sendCount, 1);
});

test("leaves a missing receipt unconfirmed after losing the browser before dispatch", (t) => {
  const { simulator, advance, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("rent2buy");
  assert.ok(observe(simulator));
  advance(8_001);
  const recovered = restart();
  assert.equal(observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Unconfirmed");
  assert.equal(recovered.snapshot().threads[0].sendCount, 0);
});

test("skips unknown listings, mismatched observations and conversations already answered", (t) => {
  const { simulator } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("unmatched");
  simulator.addEnquiry("answered");
  const finance = simulator.addEnquiry("finance");
  assert.equal(simulator.observe({
    health: "healthy",
    rows: [
      { threadId: "thread-1", listingId: "9999" },
      { threadId: finance.id, listingId: "2002" },
    ],
  }), null);
  assert.deepEqual(simulator.snapshot().threads.map(({ status, sendCount }) => [status, sendCount]), [
    ["Unmatched", 0], ["Already answered", 0], ["Unmatched", 0],
  ]);
});

test("the off switch blocks an outstanding claim and survives restart", (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("finance");
  const reply = observe(simulator);
  simulator.setEnabled(false);
  assert.equal(simulator.deliver(reply), false);
  const recovered = restart();
  assert.equal(recovered.snapshot().enabled, false);
  assert.equal(observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].sendCount, 0);
});

test("pauses on a security challenge, sign-out or layout fault and requires re-enabling", (t) => {
  for (const health of ["signed-out", "security-challenge", "layout-changed"]) {
    const { simulator } = setup(t);
    simulator.setEnabled(true);
    simulator.addEnquiry("finance");
    assert.equal(observe(simulator, { health }), null);
    assert.equal(simulator.snapshot().pauseReason, health);
    assert.equal(observe(simulator), null);
    simulator.setEnabled(false);
    simulator.setEnabled(true);
    assert.equal(observe(simulator), null);
    simulator.addEnquiry("rent2buy");
    assert.equal(observe(simulator).text, LISTINGS["2002"].reply);
  }
});

test("the loopback fixture refuses cross-origin writes and non-fixture routes", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "marketplace-reply-http-"));
  t.after(() => removeFixture(folder));
  const middleware = createFixtureMiddleware(join(folder, "state.json"));
  const server = createServer((req, res) => middleware(req, res, () => {
    res.writeHead(404).end();
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const base = origin + "/__marketplace-reply-poc";
  const toggle = (requestOrigin) => fetch(base + "/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal((await toggle("https://example.com")).status, 403);
  assert.equal((await fetch(origin + "/api/deliver")).status, 404);
  assert.equal((await toggle(origin)).status, 200);
  assert.equal((await (await fetch(base + "/state")).json()).enabled, true);
});
