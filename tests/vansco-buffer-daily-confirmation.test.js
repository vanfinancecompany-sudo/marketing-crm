import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarizeVanscoPublishedLedger } from "../lib/vanscoPublishedLedger.js";

const row = (sourceId, activityType, day = "2026-10-11", extras = {}) => ({
  activity_date: day,
  activity_type: activityType,
  source: "buffer_publish",
  source_id: "vansco-buffer:" + sourceId,
  metadata: { buffer_status: "sent" },
  occurred_at: day + "T19:00:00Z",
  ...extras,
});

test("Vansco published counts use deduplicated Buffer-sent records for the UK activity date", () => {
  const rows = [
    row("a", "vansco_facebook_post"),
    row("b", "vansco_facebook_post"),
    row("b", "vansco_facebook_post"),
    row("c", "vansco_facebook_story"),
    row("d", "vansco_333_google_business_post"),
    row("e", "vansco_airport_google_business_post"),
    row("f", "vansco_new_forest_google_business_post"),
    row("old", "vansco_facebook_post", "2026-10-10"),
    row("scheduled", "vansco_facebook_post", "2026-10-11", { metadata: { buffer_status: "scheduled" } }),
    row("manual", "vansco_facebook_post", "2026-10-11", { source: "posting_desk" }),
    row("untracked", "vansco_facebook_post", "2026-10-11", { source_id: "untracked" }),
  ];
  const summary = summarizeVanscoPublishedLedger(rows, "2026-10-11");
  assert.equal(summary.facebookPosts, 2);
  assert.equal(summary.facebookStories, 1);
  assert.deepEqual(summary.googleBusiness, { vansco333: 1, southamptonAirport: 1, newForest: 1 });
  assert.equal(summary.total, 6);
  assert.equal(summary.source, "buffer_sent_activity_ledger");
});

test("Vansco status API uses durable calendar-day sent rows, not recent-100 snapshot as publication truth", async () => {
  const source = await readFile(new URL("../api/vansco-facebook-automation-status.js", import.meta.url), "utf8");
  assert.match(source, /loadVanscoPublishedLedger\(dateKey\)/);
  assert.match(source, /sentToday: ledger\?\.facebookPosts \?\? sentToday/);
  assert.match(source, /sentCountConfirmed: Boolean\(ledger\)/);
  assert.match(source, /providerCheckedAt: liveSnapshot\?\.checkedAt/);
});

test("Content Operations displays UK publishing close and final Buffer confirmation", async () => {
  const source = await readFile(new URL("../pages/DashboardPage.jsx", import.meta.url), "utf8");
  assert.match(source, /Publishing 08:00–21:00 UK/);
  assert.match(source, /final Buffer check due 23:05/);
  assert.match(source, /FINAL CHECK PENDING/);
  assert.match(source, /DAY SHORT/);
  assert.match(source, /DAY COMPLETE/);
  assert.match(source, /sentCountConfirmed === true/);
});

test("next-day worker refill cannot reset today's published count in shared Buffer status", async () => {
  const source = await readFile(new URL("../api/buffer-publish-status.js", import.meta.url), "utf8");
  assert.match(source, /loadVanscoPublishedLedger\(todayKey\)/);
  assert.match(source, /const posts = ledger\?\.facebookPosts \?\? 0/);
  assert.doesNotMatch(source, /Math\.max\(0, Number\(status\?\.buffer\?\.providerSent\)/);
});
