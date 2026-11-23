import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { marketplaceListingId, marketplaceRegistry, FIXTURE_RECEIPTS } from "../dev/marketplace-reply-poc/observation.mjs";
import { createReplySimulator } from "../dev/marketplace-reply-poc/state.mjs";
import { draftMarketplaceReply } from "../dev/marketplace-reply-poc/assistant.mjs";

const incoming = (id, sequence) => ({ id, sequence, direction: "incoming" });
const outgoing = (id, sequence) => ({ id, sequence, direction: "outgoing" });
const thread = (id, listing, messages, flags = {}) => ({
  id, listingUrl: "/marketplace/item/" + listing + "/", alreadyRead: true, historyReady: true, messages, ...flags,
});

function setup(t, now) {
  const dir = mkdtempSync(join(tmpdir(), "marketplace-observer-test-"));
  const file = join(dir, "state.json");
  t.after(() => {
    rmSync(file, { force: true });
    rmSync(file + ".next", { force: true });
    rmdirSync(dir);
  });
  const open = () => createReplySimulator(file, now);
  return { open, log: open() };
}

const observe = (log, threads, health = "healthy", recovering = false) => log.observeBrowser({ health, threads, recovering });

test("matches exact receipt IDs across URL variants and rejects missing or conflicting records", () => {
  assert.equal(marketplaceListingId("https://facebook.com/marketplace/item/1001/?ref=listing"), "1001");
  assert.equal(marketplaceListingId("https://wrong.test/marketplace/item/1001/"), null);
  assert.equal(marketplaceListingId("/marketplace/item/1001/edit"), null);
  const registry = marketplaceRegistry(FIXTURE_RECEIPTS);
  assert.equal(registry.get("1001").product, "finance");
  assert.equal(registry.get("2002").product, "rent2buy");
  assert.equal(registry.has("9000"), false);
  const original = FIXTURE_RECEIPTS[1].metadata;
  const collision = { ...FIXTURE_RECEIPTS[1], metadata: { ...original, marketplace_listing_url: "/marketplace/item/1001/" } };
  assert.equal(marketplaceRegistry([...FIXTURE_RECEIPTS, collision, FIXTURE_RECEIPTS[0]]).get("1001").product, undefined);
});

test("records later incoming IDs once across a refresh, duplicate tabs and a receiver restart", (t) => {
  const { log, open } = setup(t);
  const baseline = thread("100", "1001", [incoming("mid.$a", 10), outgoing("mid.$seller", 11)]);
  const first = observe(log, [baseline]);
  assert.equal(first.counts.baseline, 1);
  assert.equal(first.counts.outgoing, 1);
  assert.equal(first.totalAccepted, 0);
  const next = thread("100", "1001", [...baseline.messages, incoming("mid.$b", 12), incoming("mid.$c", 13)]);
  const report = observe(log, [next]);
  assert.deepEqual(report.accepted.map((event) => event.messageId), ["mid.$b", "mid.$c"]);
  assert.equal(report.totalAccepted, 2);
  assert.equal(observe(log, [next]).accepted.length, 0);
  const recovered = open();
  assert.equal(observe(recovered, [next]).totalAccepted, 2);
  assert.equal(observe(recovered, [next]).counts.duplicate, 3);
  assert.equal(observe(recovered, [thread("100", "1001", [incoming("mid.$older-not-mounted", 4)])]).counts.historical, 1);
});

test("keeps unread or partial threads, uncertain direction and missing identities out of the ledger", (t) => {
  const { log } = setup(t);
  const report = observe(log, [
    thread("100", "1001", [incoming("mid.$unread", 1)], { alreadyRead: false }),
    thread("200", "2002", [incoming("mid.$loading", 1)], { historyReady: false }),
    thread("300", "9999", [incoming("mid.$other", 1)]),
    thread("400", "1001", [{ direction: "unknown", id: "mid.$maybe", sequence: 1 }, incoming("", 2), incoming("mid.$no-order")]),
  ]);
  assert.equal(report.counts.unread, 1);
  assert.equal(report.counts.identity, 4);
  assert.equal(report.counts.unmatched, 1);
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(log.snapshot().browserObserver.ledger, {});
  assert.equal(observe(log, [thread("100", "1001", [incoming("mid.$unread", 1)])]).counts.baseline, 1);
});

test("pauses on auth loss and rejects a different listing on the same conversation", (t) => {
  const { log, open } = setup(t);
  observe(log, [thread("100", "1001", [incoming("mid.$old", 1)])]);
  assert.deepEqual(observe(log, [thread("100", "1001", [incoming("mid.$new", 2)])], "security-challenge").accepted, []);
  assert.equal(observe(open(), [thread("100", "2002", [incoming("mid.$new", 2)])]).counts.unmatched, 1);
  const recovered = observe(log, [thread("100", "1001", [incoming("mid.$new", 2)])]);
  assert.equal(recovered.totalAccepted, 0);
  assert.equal(recovered.totalHeldForReview, 1);
});

test("counts a closed unread notice only once until an explicit read, including across a restart", (t) => {
  const { log, open } = setup(t);
  const read = (messages) => thread("100", "1001", messages, { open: true });
  const closed = (alreadyRead) => thread("100", "1001", [incoming("mid.$not-visible", 3)], {
    open: false, alreadyRead, historyReady: false,
  });
  const history = [incoming("mid.$history", 1)];
  observe(log, [read(history)]);
  assert.equal(observe(log, [closed(true)]).counts.closed, 1);
  const unread = observe(log, [closed(false)]);
  assert.equal(unread.counts.unread, 1);
  assert.equal(unread.totalUnreadNotices, 1);
  assert.equal(unread.totalAccepted, 0);
  const restored = open();
  observe(restored, []);
  assert.equal(observe(restored, [closed(false)]).totalUnreadNotices, 1);
  assert.deepEqual(restored.snapshot().browserObserver.ledger["100"].seen, ["mid.$history"]);
  const backlog = [...history, incoming("mid.$during-closed", 2)];
  assert.equal(observe(restored, [read(backlog)]).totalHeldForReview, 1);
  assert.equal(observe(restored, [closed(false)]).totalUnreadNotices, 2);
  assert.equal(observe(restored, [read(backlog)]).totalAccepted, 0);
  assert.equal(observe(restored, [read([...backlog, incoming("mid.$after", 3)])]).totalAccepted, 1);
});

test("holds messages found after a heartbeat gap, even when the thread initially reloads incomplete", (t) => {
  let now = 10_000;
  const { log } = setup(t, () => now);
  const initial = thread("200", "2002", [incoming("mid.$old", 1)]);
  observe(log, [initial]);
  now += 8_000;
  const partial = observe(log, [{ ...initial, historyReady: false }]);
  assert.equal(partial.recovering, true);
  const afterGap = { ...initial, messages: [...initial.messages, incoming("mid.$during-gap", 2)] };
  assert.equal(observe(log, [afterGap]).totalHeldForReview, 1);
  const afterReload = { ...initial, messages: [...afterGap.messages, incoming("mid.$during-reload", 3)] };
  const browserAgain = observe(log, [afterReload], "healthy", true);
  assert.equal(browserAgain.totalHeldForReview, 2);
  assert.equal(browserAgain.totalAccepted, 0);
  assert.equal(observe(log, [afterReload]).totalHeldForReview, 2);
  assert.deepEqual(observe(log, [{ ...initial, messages: [...afterReload.messages, incoming("mid.$new", 4)] }])
    .accepted.map(({ messageId }) => messageId), ["mid.$new"]);
});

test("resolved lanes can use the existing Ask Me adapter with no control over the inbox", async (t) => {
  const { log } = setup(t);
  const finance = thread("100", "1001", [incoming("mid.$f1", 1)]);
  const rent2buy = thread("200", "2002", [incoming("mid.$r1", 1)]);
  observe(log, [finance, rent2buy]);
  finance.messages.push(incoming("mid.$f2", 2));
  rent2buy.messages.push(incoming("mid.$r2", 2));
  const { accepted } = observe(log, [finance, rent2buy]);
  assert.deepEqual(accepted.map((row) => [row.threadId, row.product]), [["100", "finance"], ["200", "rent2buy"]]);
  const good = await draftMarketplaceReply({ product: accepted[0].product, message: "Do your vans have a warranty?" });
  const rejected = await draftMarketplaceReply({ product: accepted[1].product, message: "What APR does the lender charge?" });
  assert.match(good.text, /warranty/);
  assert.match(rejected.reason, /product boundary/);
  assert.equal(log.snapshot().threads.length, 0);
});

test("the observer package stays scoped to the local fixture and contains no host or extension permissions", () => {
  const manifest = JSON.parse(readFileSync(new URL("../dev/marketplace-reply-poc/observer-extension/manifest.json", import.meta.url)));
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://127.0.0.1/__marketplace-reply-poc/observer"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.background, undefined);
});
