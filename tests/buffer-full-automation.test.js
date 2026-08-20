import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  bufferAutomationSlots,
  londonLocalMinutesToUtcIso,
  normalizeBufferAutomationConfig,
} from "../lib/bufferAutomation.js";
import { buildBufferCreatePostInput } from "../lib/bufferPublishing.js";
import {
  buildAutomatedFacebookCaption,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("final automation is armed for 21 August with ten posts and ten Reels per Page", () => {
  const config = normalizeBufferAutomationConfig(DEFAULT_BUFFER_AUTOMATION_CONFIG);
  assert.equal(config.enabled, true);
  assert.equal(config.startDate, "2026-08-21");
  assert.equal(config.vanFinancePostsPerDay, 10);
  assert.equal(config.vanFinanceReelsPerDay, 10);
  assert.equal(config.rent2buyPostsPerDay, 10);
  assert.equal(config.rent2buyReelsPerDay, 10);
  assert.equal(config.slotGapMinutes, 38);
});

test("Finance schedule alternates 10 posts and 10 Reels across twelve hours with Rent2Buy offset ten minutes", () => {
  const finance = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance", "2026-08-21");
  const rent = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy", "2026-08-21");
  assert.deepEqual(finance.map((slot) => slot.localTime), [
    "08:00", "08:38", "09:16", "09:54", "10:32", "11:10", "11:48", "12:26", "13:04", "13:42",
    "14:20", "14:58", "15:36", "16:14", "16:52", "17:30", "18:08", "18:46", "19:24", "20:02",
  ]);
  assert.deepEqual(rent.map((slot) => slot.localTime), [
    "08:10", "08:48", "09:26", "10:04", "10:42", "11:20", "11:58", "12:36", "13:14", "13:52",
    "14:30", "15:08", "15:46", "16:24", "17:02", "17:40", "18:18", "18:56", "19:34", "20:12",
  ]);
  assert.deepEqual(finance.map((slot) => slot.mediaKind), Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? "image" : "video"));
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length, 10);
  assert.equal(finance.filter((slot) => slot.mediaKind === "video").length, 10);
});

test("London schedule conversion handles BST and winter correctly", () => {
  assert.equal(londonLocalMinutesToUtcIso("2026-08-21", 8 * 60), "2026-08-21T07:00:00.000Z");
  assert.equal(londonLocalMinutesToUtcIso("2026-12-21", 8 * 60), "2026-12-21T08:00:00.000Z");
});

test("Buffer custom schedule uses dueAt without draft or share-now behaviour", () => {
  const input = buildBufferCreatePostInput({
    destination: "Rent2Buy Facebook",
    text: "REGISTRATION: AB12CDE",
    mediaUrl: "https://example.com/reel.mp4",
    mediaKind: "video",
    draft: false,
    dueAt: "2026-08-21T08:30:00.000Z",
  });
  assert.equal(input.mode, "customScheduled");
  assert.equal(input.dueAt, "2026-08-21T08:30:00.000Z");
  assert.equal(input.saveToDraft, false);
  assert.equal(input.metadata.facebook.type, "reel");
  assert.equal("shareNow" in input, false);
});

test("automated captions keep direct website URLs and add no tracking redirect", () => {
  const vehicle = {
    registration: "AB12CDE",
    vanDescription: "Ford Transit Custom",
  };
  const finance = buildAutomatedFacebookCaption(vehicle, "vanFinance");
  const rent = buildAutomatedFacebookCaption(vehicle, "rent2buy");
  const reel = buildAutomatedReelCaption({ productKey: "rent2buy", registration: "AB12CDE", title: "Ford Transit Custom" });
  for (const text of [finance, rent, reel]) {
    assert.doesNotMatch(text, /utm_/i);
    assert.doesNotMatch(text, /\/track|\/r\//i);
  }
  assert.match(finance, /https:\/\/www\.vanfinancecompany\.co\.uk\/van-finance\/AB12CDE/);
  assert.match(rent, /https:\/\/www\.rent2buyvans\.co\.uk\/van-pages\/AB12CDE/);
});

test("worker keeps the Buffer Free queue cap while filling the larger daily target gradually", () => {
  const worker = source("api/buffer-facebook-automation-worker.js");
  assert.match(worker, /CHANNEL_QUEUE_LIMIT = 10/);
  assert.match(worker, /MIN_SCHEDULE_LEAD_MS/);
  assert.match(worker, /dateKey < automationConfig\.startDate/);
  assert.match(worker, /REEL_COOLDOWN_MS = 48/);
  assert.match(worker, /recentBufferReelRegistrations/);
  assert.match(worker, /!excluded\.has\(registration\)/);
  assert.doesNotMatch(worker, /shareNow/);
  assert.match(worker, /customScheduled|createBufferScheduledPost/);
});

test("legacy five-plus-five settings are superseded without losing the pause state", () => {
  const configSource = source("lib/bufferAutomationConfig.js");
  assert.match(configSource, /buffer-automation-v3\/config-/);
  assert.match(configSource, /buffer-automation-v2\/config-/);
  assert.match(configSource, /enabled: legacyConfig\.enabled/);
});

test("Daily Reels live-status observer cannot rerender its own status mutation forever", () => {
  const liveStatus = source("public/buffer-live-status.js");
  assert.match(liveStatus, /MutationObserver/);
  assert.match(liveStatus, /lastPayload && !document\.getElementById\(STATUS_ID\)/);
});

test("temporary ten-Reel proof control is removed", () => {
  const reelBridge = source("public/daily-reels/buffer-drafts.js");
  assert.doesNotMatch(reelBridge, /Queue 10 Rent2Buy Reels to Buffer/);
  assert.doesNotMatch(reelBridge, /runRent2BuyBatchProof/);
  assert.match(reelBridge, /Buffer Draft/);
});

test("Vercel runs automation and delivery reconciliation hourly", () => {
  const vercel = JSON.parse(source("vercel.json"));
  const schedules = new Map(vercel.crons.map((entry) => [entry.path, entry.schedule]));
  assert.equal(schedules.get("/api/buffer-facebook-automation-worker"), "5 * * * *");
  assert.equal(schedules.get("/api/buffer-publish-status"), "35 * * * *");
});

test("delivery status route supports cron GET and cleans delivered Reel blobs", () => {
  const status = source("api/buffer-publish-status.js");
  assert.match(status, /\["GET", "POST"\]/);
  assert.match(status, /cleanDeliveredReelBlobs/);
  assert.match(status, /await del\(url\)/);
  assert.match(status, /facebook_live: true/);
});
