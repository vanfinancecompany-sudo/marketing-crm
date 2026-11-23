import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createReplySimulator, LISTINGS } from "../dev/marketplace-reply-poc/state.mjs";
import { draftMarketplaceReply } from "../dev/marketplace-reply-poc/assistant.mjs";
import { createFixtureMiddleware } from "../dev/marketplace-reply-poc/plugin.mjs";

function removeFixture(folder) {
  for (const file of ["state.json", "state.json.next"]) rmSync(join(folder, file), { force: true });
  rmdirSync(folder);
}

function setup(t, options) {
  const folder = mkdtempSync(join(tmpdir(), "marketplace-reply-state-"));
  t.after(() => removeFixture(folder));
  const file = join(folder, "state.json");
  let time = Date.UTC(2026, 10, 23, 12);
  const restart = () => createReplySimulator(file, () => time, options);
  return { simulator: restart(), restart, advance: (ms) => { time += ms; } };
}

function observe(simulator, { health = "healthy", showReceipt = true } = {}) {
  return simulator.observe({
    health,
    rows: simulator.snapshot().threads.map(({ id, listingId, turns }) => ({
      threadId: id,
      listingId,
      incomingIds: turns.map((turn) => turn.id),
      outgoingIds: showReceipt ? turns.flatMap((turn) => turn.outgoing ? [turn.outgoing.id] : []) : [],
    })),
  });
}

test("defaults off, excludes earlier threads, and routes the two fixture listings", async (t) => {
  const { simulator } = setup(t);
  assert.equal(simulator.snapshot().enabled, false);
  simulator.addEnquiry("finance");
  assert.equal(await observe(simulator), null);
  simulator.setEnabled(true);
  assert.equal(await observe(simulator), null);
  simulator.addEnquiry("finance");
  simulator.addEnquiry("rent2buy");
  assert.equal((await observe(simulator)).text, LISTINGS["1001"].reply);
  assert.equal((await observe(simulator)).text, LISTINGS["2002"].reply);
  assert.equal(await observe(simulator), null);
  assert.equal(simulator.snapshot().threads[0].sendCount, 0);
});

test("records one acknowledgement despite duplicate observations and dispatch attempts", async (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("finance");
  const reply = await observe(simulator);
  assert.equal(await observe(simulator), null);
  assert.equal(simulator.deliver(reply), true);
  assert.equal(simulator.deliver(reply), false);
  assert.equal(simulator.snapshot().threads[0].status, "Sending");

  const recovered = restart();
  assert.equal(await observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Sent");
  assert.equal(recovered.snapshot().threads[0].sendCount, 1);
  assert.equal(await observe(recovered), null);
});

test("reconciles a delayed receipt after restart without a second send", async (t) => {
  const { simulator, advance, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("rent2buy");
  const reply = await observe(simulator);
  assert.equal(simulator.deliver(reply), true);
  advance(8_001);
  const recovered = restart();
  assert.equal(await observe(recovered, { showReceipt: false }), null);
  assert.equal(recovered.snapshot().threads[0].status, "Unconfirmed");
  assert.equal(await observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Sent");
  assert.equal(recovered.snapshot().threads[0].sendCount, 1);
});

test("leaves a missing receipt unconfirmed after losing the browser before dispatch", async (t) => {
  const { simulator, advance, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("rent2buy");
  assert.ok(await observe(simulator));
  advance(8_001);
  const recovered = restart();
  assert.equal(await observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].status, "Unconfirmed");
  assert.equal(recovered.snapshot().threads[0].sendCount, 0);
});

test("skips unknown listings, mismatched observations and conversations already answered", async (t) => {
  const { simulator } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("unmatched");
  simulator.addEnquiry("answered");
  const finance = simulator.addEnquiry("finance");
  assert.equal(await simulator.observe({
    health: "healthy",
    rows: [
      { threadId: "thread-1", listingId: "9999", incomingIds: ["thread-1:1"], outgoingIds: [] },
      { threadId: finance.id, listingId: "2002", incomingIds: [finance.turns[0].id], outgoingIds: [] },
    ],
  }), null);
  assert.deepEqual(simulator.snapshot().threads.map(({ status, sendCount }) => [status, sendCount]), [
    ["Unmatched", 0], ["Already answered", 0], ["Unmatched", 0],
  ]);
});

test("the off switch blocks an outstanding claim and survives restart", async (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  simulator.addEnquiry("finance");
  const reply = await observe(simulator);
  simulator.setEnabled(false);
  assert.equal(simulator.deliver(reply), false);
  const recovered = restart();
  assert.equal(recovered.snapshot().enabled, false);
  assert.equal(await observe(recovered), null);
  assert.equal(recovered.snapshot().threads[0].sendCount, 0);
});

test("pauses on a security challenge, sign-out or layout fault and requires re-enabling", async (t) => {
  for (const health of ["signed-out", "security-challenge", "layout-changed"]) {
    const { simulator } = setup(t);
    simulator.setEnabled(true);
    simulator.addEnquiry("finance");
    assert.equal(await observe(simulator, { health }), null);
    assert.equal(simulator.snapshot().pauseReason, health);
    assert.equal(await observe(simulator), null);
    simulator.setEnabled(false);
    simulator.setEnabled(true);
    assert.equal(await observe(simulator), null);
    simulator.addEnquiry("rent2buy");
    assert.equal((await observe(simulator)).text, LISTINGS["2002"].reply);
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

test("Finance and Rent2Buy follow-ups recover context after restart and return to their original threads", async (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  const finance = simulator.addEnquiry("finance", "Do your vans come with a warranty?");
  const rent2buy = simulator.addEnquiry("rent2buy", "When is the initial rental payment due?");
  const first = await observe(simulator);
  const second = await observe(simulator);
  assert.equal(first.threadId, finance.id);
  assert.equal(first.listingId, "1001");
  assert.equal(second.threadId, rent2buy.id);
  assert.match(second.text, /initial rental.*before collection/i);
  assert.equal(simulator.deliver(first), true);
  assert.equal(simulator.deliver(second), true);
  assert.equal(await observe(simulator), null);

  const recovered = restart();
  const financeTurn = recovered.addFollowUp(finance.id, "Does that include the gearbox?");
  const r2bTurn = recovered.addFollowUp(rent2buy.id, "When is that due?");
  const financeAnswer = await observe(recovered);
  const rent2buyAnswer = await observe(recovered);
  assert.deepEqual([financeAnswer.threadId, financeAnswer.turnId], [finance.id, financeTurn.id]);
  assert.match(financeAnswer.text, /warranty covers the gearbox/i);
  assert.deepEqual([rent2buyAnswer.threadId, rent2buyAnswer.turnId], [rent2buy.id, r2bTurn.id]);
  assert.match(rent2buyAnswer.text, /initial rental is due before collection/i);
  assert.doesNotMatch(rent2buyAnswer.text, /gearbox|lender|finance/i);

  assert.equal(recovered.deliver({ ...financeAnswer, threadId: rent2buy.id }), false);
  assert.equal(recovered.deliver(financeAnswer), true);
  assert.equal(recovered.deliver(financeAnswer), false);
  assert.equal(recovered.deliver(rent2buyAnswer), true);
  assert.equal(await observe(recovered), null);
  assert.deepEqual(recovered.snapshot().threads.map(({ sendCount }) => sendCount), [2, 2]);
});

test("wrong-product, unmatched and explicit human requests pause the relevant conversations", async (t) => {
  const { simulator } = setup(t);
  simulator.setEnabled(true);
  const unknown = simulator.addEnquiry("unmatched", "What documents do I need?");
  const crossed = simulator.addEnquiry("rent2buy", "What APR does the lender charge?");
  const human = simulator.addEnquiry("finance", "Can I speak to a person about my application?");
  assert.equal(await observe(simulator), null);
  assert.equal(await observe(simulator), null);
  assert.equal(await observe(simulator), null);
  simulator.addFollowUp(human.id, "What documents do I need?");
  assert.equal(await observe(simulator), null);
  const threads = simulator.snapshot().threads;
  assert.deepEqual(threads.map(({ id }) => id), [unknown.id, crossed.id, human.id]);
  assert.deepEqual(threads.map(({ reviewReason }) => reviewReason), [
    "No verified listing match", "Question crosses the listing's product boundary", "Customer needs the team",
  ]);
  assert.ok(threads.every((thread) => thread.status === "Needs human" && thread.sendCount === 0));
});

test("an unsupported question or rejected model output requires a human", async () => {
  const context = { product: "rent2buy", vehicle: {}, history: [], message: "Can you fit a fridge freezer in it?" };
  assert.match((await draftMarketplaceReply(context)).reason, /referred/);
  const bad = await draftMarketplaceReply({ ...context, message: "What documents do I need?" }, {
    requestReply: async () => ({ reply: "Our lenders will decide.", action: "none" }),
  });
  assert.match(bad.reason, /could not verify/);
  assert.equal(bad.text, undefined);
});

test("a pending draft is claimed once and is discarded if replies are turned off", async (t) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let calls = 0;
  const { simulator } = setup(t, { draftReply: () => { calls++; return pending; } });
  simulator.setEnabled(true);
  simulator.addEnquiry("finance", "What documents do I need?");
  const first = observe(simulator);
  assert.equal(await observe(simulator), null);
  assert.equal(calls, 1);
  simulator.setEnabled(false);
  simulator.setEnabled(true);
  finish({ text: "Proof of identity and address." });
  assert.equal(await first, null);
  assert.equal(await observe(simulator), null);
  assert.equal(simulator.snapshot().threads[0].sendCount, 0);
});

test("a later turn waits for confirmation of the earlier turn", async (t) => {
  const { simulator } = setup(t);
  simulator.setEnabled(true);
  const thread = simulator.addEnquiry("finance", "Do your vans come with a warranty?");
  const first = await observe(simulator);
  simulator.addFollowUp(thread.id, "Does that include the gearbox?");
  assert.equal(await observe(simulator), null);
  assert.equal(simulator.deliver(first), true);
  assert.equal(await observe(simulator, { showReceipt: false }), null);
  assert.match((await observe(simulator)).text, /gearbox/);
});

test("only trusted incoming identities deduplicate observations across restart", async (t) => {
  const { simulator, restart } = setup(t);
  simulator.setEnabled(true);
  const finance = simulator.addEnquiry("finance", "What documents do I need?");
  const second = simulator.addEnquiry("finance", "What documents do I need?");
  const observation = { direction: "incoming", id: "mock-entry:01" };
  const firstTurn = simulator.addFollowUp(finance.id, "And what paperwork should I bring?", observation);

  const recovered = restart();
  const replay = recovered.addFollowUp(finance.id, firstTurn.message, observation);
  assert.equal(replay.id, firstTurn.id);
  assert.equal(replay.duplicate, true);
  assert.match(recovered.addFollowUp(finance.id, "Changed content", observation).ignored, /Conflicting/);
  assert.match(recovered.addFollowUp(finance.id, "This is an outgoing reply", { ...observation, direction: "outgoing" }).ignored, /Direction/);
  assert.match(recovered.addFollowUp(finance.id, firstTurn.message, { direction: "incoming" }).ignored, /stable/);
  assert.notEqual(recovered.addFollowUp(finance.id, firstTurn.message, { ...observation, id: "mock-entry:02" }).id, firstTurn.id);
  assert.notEqual(recovered.addFollowUp(second.id, firstTurn.message, observation).id, firstTurn.id);
  assert.deepEqual(recovered.snapshot().threads.map((thread) => thread.turns.length), [3, 2]);
});

test("the benchmark transport uses the same adapter gates and times only local work", async () => {
  const seen = [];
  const times = [];
  const options = {
    respond: async (request) => {
      seen.push(request);
      return { status: "ready", reply: "The team can confirm the details.", actions: [{ type: "contact" }] };
    },
    onAdapterTime: (ms) => times.push(ms),
  };
  const message = "When can I return it?";
  const history = [{ role: "user", content: "Can I return my Rent2Buy van early?" }];
  const result = await draftMarketplaceReply({ product: "rent2buy", message, history }, options);
  const wrongProduct = await draftMarketplaceReply({ product: "rent2buy", message: "What APR does the lender charge?", history }, options);
  assert.match(result.reason, /referred/);
  assert.match(wrongProduct.reason, /boundary/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].channel, "marketplace");
  assert.equal(seen[0].product, "rent2buy");
  assert.deepEqual(seen[0].history, history);
  assert.equal(times.length, 2);
  assert.ok(times.every((ms) => Number.isFinite(ms) && ms >= 0));
});
