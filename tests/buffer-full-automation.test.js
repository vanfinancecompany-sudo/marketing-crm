import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  FACEBOOK_STORY_TARGET_PER_DAY,
  bufferAutomationSlots,
  bufferPostMediaKind,
  extractBufferRegistration,
  facebookStoryTargetForProduct,
  londonLocalMinutesToUtcIso,
  normalizeBufferAutomationConfig,
} from "../lib/bufferAutomation.js";
import { alignBufferAutomationConfigToDailyTargets } from "../lib/bufferAutomationConfig.js";
import { buildBufferCreatePostInput } from "../lib/bufferPublishing.js";
import {
  buildAutomatedFacebookCaption,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("final automation is armed for 21 August with ten Facebook outputs and ten Reels per Page", () => {
  const config = normalizeBufferAutomationConfig(DEFAULT_BUFFER_AUTOMATION_CONFIG);
  assert.equal(config.enabled, true);
  assert.equal(config.startDate, "2026-08-21");
  assert.equal(config.vanFinancePostsPerDay, 10);
  assert.equal(config.vanFinanceReelsPerDay, 10);
  assert.equal(config.rent2buyPostsPerDay, 10);
  assert.equal(config.rent2buyReelsPerDay, 10);
  assert.equal(config.slotGapMinutes, 38);
  assert.equal(FACEBOOK_STORY_TARGET_PER_DAY, 3);
});

test("Facebook schedule reserves three Story slots inside the daily Facebook total", () => {
  const finance = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance", "2026-08-21");
  const rent = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy", "2026-08-21");
  assert.deepEqual(finance.map((slot) => slot.localTime), [
    "08:00", "08:38", "09:16", "09:54", "10:32", "11:10", "11:48", "12:26", "13:04",
    "13:42", "14:20", "14:58", "15:36", "16:14", "16:52", "17:30", "18:08",
  ]);
  assert.deepEqual(rent.map((slot) => slot.localTime), [
    "08:10", "08:48", "09:26", "10:04", "10:42", "11:20", "11:58", "12:36", "13:14",
    "13:52", "14:30", "15:08", "15:46", "16:24", "17:02", "17:40", "18:18",
  ]);
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length, 7);
  assert.equal(finance.filter((slot) => slot.mediaKind === "video").length, 10);
  assert.equal(rent.filter((slot) => slot.mediaKind === "image").length, 7);
  assert.equal(rent.filter((slot) => slot.mediaKind === "video").length, 10);
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length + facebookStoryTargetForProduct(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance"), 10);
  assert.equal(rent.filter((slot) => slot.mediaKind === "image").length + facebookStoryTargetForProduct(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy"), 10);
});

test("an eight-post Content Operations target becomes five feed posts plus three Stories for both brands", () => {
  const aligned = alignBufferAutomationConfigToDailyTargets(DEFAULT_BUFFER_AUTOMATION_CONFIG, {
    van_finance_facebook_post: 8,
    rent2buy_facebook_post: 4,
    van_finance_reel: 8,
    rent2buy_reel: 8,
    off_day: false,
  });
  assert.equal(aligned.vanFinancePostsPerDay, 8);
  assert.equal(aligned.rent2buyPostsPerDay, 8);
  assert.equal(aligned.vanFinanceReelsPerDay, 8);
  assert.equal(aligned.rent2buyReelsPerDay, 8);
  for (const productKey of ["vanFinance", "rent2buy"]) {
    const slots = bufferAutomationSlots(aligned, productKey, "2026-08-26");
    assert.equal(slots.filter((slot) => slot.mediaKind === "image").length, 5);
    assert.equal(slots.filter((slot) => slot.mediaKind === "video").length, 8);
    assert.equal(facebookStoryTargetForProduct(aligned, productKey), 3);
  }
});

test("Stories are a distinct Buffer media kind instead of accidental image posts", () => {
  assert.equal(bufferPostMediaKind({
    schedulingType: "automatic",
    metadata: { type: "story" },
    assets: [{ mimeType: "image/jpeg" }],
  }), "story");
  assert.equal(bufferPostMediaKind({
    schedulingType: "notification",
    assets: [{ mimeType: "image/jpeg" }],
  }), "story");
  assert.equal(bufferPostMediaKind({
    schedulingType: "automatic",
    metadata: { type: "post" },
    assets: [{ mimeType: "image/jpeg" }],
  }), "image");
  assert.equal(bufferPostMediaKind({
    schedulingType: "automatic",
    assets: [{ mimeType: "video/mp4" }],
  }), "video");
});

test("labelled Northern Ireland registrations are kept for Buffer cooldown and dedupe", () => {
  assert.equal(extractBufferRegistration("REGISTRATION: XGZ4865\nYEAR: 2022"), "XGZ4865");
  assert.equal(extractBufferRegistration("REGISTRATION: AB12 CDE\nYEAR: 2022"), "AB12CDE");
});

test("Facebook Story worker uses Buffer automatic publishing with story metadata", () => {
  const storyWorker = source("api/buffer-facebook-story-automation.js");
  assert.match(storyWorker, /schedulingType:\s*"automatic"/);
  assert.doesNotMatch(storyWorker, /schedulingType:\s*"notification"/);
  assert.match(storyWorker, /type:\s*"story"/);
  assert.match(storyWorker, /FacebookPostMetadata/);
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

test("automated captions keep direct live vehicle URLs and add no tracking redirect", () => {
  const financeVehicle = {
    registration: "AB12CDE",
    vanDescription: "Ford Transit Custom",
    weblink: "https://www.vanfinancecompany.co.uk/van-finance/live-ab12cde",
  };
  const rentVehicle = {
    registration: "AB12CDE",
    vanDescription: "Ford Transit Custom",
    webLink: "https://www.rent2buyvans.co.uk/van-pages/live-ab12cde",
  };
  const finance = buildAutomatedFacebookCaption(financeVehicle, "vanFinance");
  const rent = buildAutomatedFacebookCaption(rentVehicle, "rent2buy");
  const reel = buildAutomatedReelCaption({ productKey: "rent2buy", vehicle: rentVehicle, registration: "AB12CDE", title: "Ford Transit Custom" });
  for (const text of [finance, rent, reel]) {
    assert.doesNotMatch(text, /utm_/i);
    assert.doesNotMatch(text, /\/track|\/r\//i);
  }
  assert.match(finance, /https:\/\/www\.vanfinancecompany\.co\.uk\/van-finance\/live-ab12cde/);
  assert.match(rent, /https:\/\/www\.rent2buyvans\.co\.uk\/van-pages\/live-ab12cde/);
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

test("Buffer worker follows Content Operations targets while settings keep the stored fallback values", () => {
  const configSource = source("lib/bufferAutomationConfig.js");
  const settingsSource = source("api/buffer-automation-settings.js");
  assert.match(configSource, /marketing_daily_target_schedules/);
  assert.match(configSource, /marketing_daily_target_overrides/);
  assert.match(configSource, /Math\.max\(/);
  assert.match(configSource, /vanFinancePostsPerDay: facebookTarget/);
  assert.match(configSource, /rent2buyPostsPerDay: facebookTarget/);
  assert.match(settingsSource, /useDailyTargets: false/);
});

test("legacy five-plus-five settings are superseded without losing the pause state", () => {
  const configSource = source("lib/bufferAutomationConfig.js");
  assert.match(configSource, /buffer-automation-v3\/config-/);
  assert.match(configSource, /buffer-automation-v2\/config-/);
  assert.match(configSource, /enabled: legacyConfig\.enabled/);
});

test("Daily Reels live status uses bounded refreshes instead of a document-wide mutation observer", () => {
  const liveStatus = source("public/buffer-live-status.js");
  assert.doesNotMatch(liveStatus, /MutationObserver/);
  assert.match(liveStatus, /REFRESH_MS = 60 \* 1000/);
  assert.match(liveStatus, /setInterval\(\(\) => refresh\(true\), REFRESH_MS\)/);
});

test("temporary ten-Reel proof control is removed", () => {
  const reelBridge = source("public/daily-reels/buffer-drafts.js");
  assert.doesNotMatch(reelBridge, /Queue 10 Rent2Buy Reels to Buffer/);
  assert.doesNotMatch(reelBridge, /runRent2BuyBatchProof/);
  assert.match(reelBridge, /Buffer Draft/);
});

test("Vercel runs automation through the guarded retry cron and reconciles delivery hourly", () => {
  const vercel = JSON.parse(source("vercel.json"));
  const schedules = new Map(vercel.crons.map((entry) => [entry.path, entry.schedule]));
  assert.equal(schedules.get("/api/buffer-facebook-automation-cron"), "5 * * * *");
  assert.equal(schedules.has("/api/buffer-facebook-automation-worker"), false);
  assert.equal(schedules.get("/api/buffer-publish-status"), "35 * * * *");
});

test("cron wrapper retries only transient Reel transport failures", () => {
  const cron = source("api/buffer-facebook-automation-cron.js");
  assert.match(cron, /MAX_ATTEMPTS = 2/);
  assert.match(cron, /terminated\|fetch failed\|und_err_socket/);
  assert.match(cron, /\/api\/buffer-facebook-automation-worker/);
  assert.match(cron, /retrying transient Reel failure/);
  assert.doesNotMatch(cron, /createBufferScheduledPost|BUFFER_CREATE_POST_MUTATION/);
});

test("delivery status route supports cron GET and cleans delivered Reel blobs", () => {
  const status = source("api/buffer-publish-status.js");
  assert.match(status, /\["GET", "POST"\]/);
  assert.match(status, /cleanDeliveredReelBlobs/);
  assert.match(status, /await del\(url\)/);
  assert.match(status, /facebook_live: true/);
});
