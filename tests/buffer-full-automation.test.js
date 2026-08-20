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

test("final automation is armed for 21 August with five posts and five Reels per Page", () => {
  const config = normalizeBufferAutomationConfig(DEFAULT_BUFFER_AUTOMATION_CONFIG);
  assert.equal(config.enabled, true);
  assert.equal(config.startDate, "2026-08-21");
  assert.equal(config.vanFinancePostsPerDay, 5);
  assert.equal(config.vanFinanceReelsPerDay, 5);
  assert.equal(config.rent2buyPostsPerDay, 5);
  assert.equal(config.rent2buyReelsPerDay, 5);
});

test("Finance schedule alternates across twelve hours and Rent2Buy is offset ten minutes", () => {
  const finance = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance", "2026-08-21");
  const rent = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy", "2026-08-21");
  assert.deepEqual(finance.map((slot) => slot.localTime), [
    "08:00", "09:20", "10:40", "12:00", "13:20", "14:40", "16:00", "17:20", "18:40", "20:00",
  ]);
  assert.deepEqual(rent.map((slot) => slot.localTime), [
    "08:10", "09:30", "10:50", "12:10", "13:30", "14:50", "16:10", "17:30", "18:50", "20:10",
  ]);
  assert.deepEqual(finance.map((slot) => slot.mediaKind), [
    "image", "video", "image", "video", "image", "video", "image", "video", "image", "video",
  ]);
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length, 5);
  assert.equal(finance.filter((slot) => slot.mediaKind === "video").length, 5);
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

test("worker has queue, lead-time, start-date and Reel cooldown safety guards", () => {
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
