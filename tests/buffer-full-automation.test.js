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
  isBufferApiActiveWindow,
  isBufferScheduledRunDue,
} from "../lib/bufferActiveWindow.js";
import {
  automatedReelFrameSpecs,
  buildAutomatedFacebookCaption,
  buildAutomatedReelCaption,
  isVanFinancePoorCreditReelSlot,
} from "../lib/facebookAutomationContent.js";
import { buildInstagramMirrorCaption } from "../lib/bufferInstagramMirror.js";
import { isVanFinancePoorCreditImageSlot, withVanFinancePoorCreditOpening } from "../lib/vanFinanceStaticAdHooks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("paid automation is armed with twenty feed posts plus ten Reels per Facebook Page", () => {
  const config = normalizeBufferAutomationConfig(DEFAULT_BUFFER_AUTOMATION_CONFIG);
  assert.equal(config.enabled, true);
  assert.equal(config.startDate, "2026-08-21");
  assert.equal(config.vanFinancePostsPerDay, 20);
  assert.equal(config.vanFinanceReelsPerDay, 10);
  assert.equal(config.rent2buyPostsPerDay, 20);
  assert.equal(config.rent2buyReelsPerDay, 10);
  assert.equal(config.slotGapMinutes, 38);
  assert.equal(FACEBOOK_STORY_TARGET_PER_DAY, 3);
});

test("Facebook paid schedule keeps three Stories separate from twenty feed posts", () => {
  const finance = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance", "2026-08-21");
  const rent = bufferAutomationSlots(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy", "2026-08-21");
  assert.equal(finance.length, 30);
  assert.equal(rent.length, 30);
  assert.equal(finance[0].localTime, "08:00");
  assert.equal(finance.at(-1).localTime, "22:30");
  assert.equal(rent[0].localTime, "08:10");
  assert.equal(rent.at(-1).localTime, "22:40");
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length, 20);
  assert.equal(finance.filter((slot) => slot.mediaKind === "video").length, 10);
  assert.equal(rent.filter((slot) => slot.mediaKind === "image").length, 20);
  assert.equal(rent.filter((slot) => slot.mediaKind === "video").length, 10);
  assert.equal(facebookStoryTargetForProduct(DEFAULT_BUFFER_AUTOMATION_CONFIG, "vanFinance"), 3);
  assert.equal(facebookStoryTargetForProduct(DEFAULT_BUFFER_AUTOMATION_CONFIG, "rent2buy"), 3);
});

test("Content Operations feed targets stay independent and Stories remain separate", () => {
  const aligned = alignBufferAutomationConfigToDailyTargets(DEFAULT_BUFFER_AUTOMATION_CONFIG, {
    van_finance_facebook_post: 8,
    rent2buy_facebook_post: 4,
    van_finance_reel: 8,
    rent2buy_reel: 8,
    off_day: false,
  });
  assert.equal(aligned.vanFinancePostsPerDay, 8);
  assert.equal(aligned.rent2buyPostsPerDay, 4);
  assert.equal(aligned.vanFinanceReelsPerDay, 8);
  assert.equal(aligned.rent2buyReelsPerDay, 8);

  const finance = bufferAutomationSlots(aligned, "vanFinance", "2026-08-26");
  const rent = bufferAutomationSlots(aligned, "rent2buy", "2026-08-26");
  assert.equal(finance.filter((slot) => slot.mediaKind === "image").length, 8);
  assert.equal(finance.filter((slot) => slot.mediaKind === "video").length, 8);
  assert.equal(rent.filter((slot) => slot.mediaKind === "image").length, 4);
  assert.equal(rent.filter((slot) => slot.mediaKind === "video").length, 8);
  assert.equal(facebookStoryTargetForProduct(aligned, "vanFinance"), 3);
  assert.equal(facebookStoryTargetForProduct(aligned, "rent2buy"), 3);
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
  assert.match(storyWorker, /CHANNEL_QUEUE_LIMIT = 35/);
  assert.match(storyWorker, /10 \* 60 \+ 15, 14 \* 60 \+ 15, 18 \* 60 \+ 15/);
  assert.match(storyWorker, /SAME_DAY_STORY_CATCHUP_LATEST_LOCAL_MINUTES = 23 \* 60 \+ 30/);
  assert.match(storyWorker, /same_day_catch_up/);
  assert.match(storyWorker, /createdCount/);
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

test("worker uses paid queue headroom while refilling the larger daily target gradually", () => {
  const worker = source("api/buffer-facebook-automation-worker.js");
  assert.match(worker, /CHANNEL_QUEUE_LIMIT = 35/);
  assert.match(worker, /MIN_SCHEDULE_LEAD_MS/);
  assert.match(worker, /dateKey < automationConfig\.startDate/);
  assert.match(worker, /REEL_COOLDOWN_MS = 48/);
  assert.match(worker, /recentBufferReelRegistrations/);
  assert.match(worker, /!excluded\.has\(registration\)/);
  assert.match(worker, /DAILY_YOUTUBE_TEMPLATE_KEY/);
  assert.match(worker, /marketingVanFinanceImages/);
  assert.match(worker, /marketingRent2BuyImages/);
  assert.match(worker, /facebookVehicleImageUrls/);
  assert.match(worker, /imageExtra/);
  assert.match(worker, /videoExtra/);
  assert.match(worker, /SAME_DAY_CATCHUP_LATEST_LOCAL_MINUTES = 23 \* 60 \+ 40/);
  assert.match(worker, /catchUp: true/);
  assert.match(worker, /mediaUrls,/);
  assert.doesNotMatch(worker, /templateKey:\s*["']tiktokPunch["']/);
  assert.doesNotMatch(worker, /shareNow/);
  assert.match(worker, /customScheduled|createBufferScheduledPost/);
  assert.match(worker, /fps:\s*30/);
  assert.doesNotMatch(worker, /fps:\s*24/);
});

test("Buffer worker follows Content Operations targets while settings keep the stored fallback values", () => {
  const configSource = source("lib/bufferAutomationConfig.js");
  const settingsSource = source("api/buffer-automation-settings.js");
  assert.match(configSource, /marketing_daily_target_schedules/);
  assert.match(configSource, /marketing_daily_target_overrides/);
  assert.doesNotMatch(configSource, /const facebookTarget =/);
  assert.match(configSource, /vanFinancePostsPerDay: offDay \? 0 : Number\(targets\.van_finance_facebook_post/);
  assert.match(configSource, /rent2buyPostsPerDay: offDay \? 0 : Number\(targets\.rent2buy_facebook_post/);
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
  assert.match(liveStatus, /REFRESH_MS = 5 \* 60 \* 1000/);
  assert.match(liveStatus, /MIN_REQUEST_GAP_MS = 5 \* 60 \* 1000/);
  assert.match(liveStatus, /setInterval\(\(\) => refresh\(false\), REFRESH_MS\)/);
  assert.doesNotMatch(liveStatus, /addEventListener\("focus"/);
});

test("temporary ten-Reel proof control is removed", () => {
  const reelBridge = source("public/daily-reels/buffer-drafts.js");
  assert.doesNotMatch(reelBridge, /Queue 10 Rent2Buy Reels to Buffer/);
  assert.doesNotMatch(reelBridge, /runRent2BuyBatchProof/);
  assert.match(reelBridge, /Buffer Draft/);
});

test("Vercel runs Buffer jobs at quota-safe cadence across all paid channels", () => {
  const vercel = JSON.parse(source("vercel.json"));
  const schedules = new Map(vercel.crons.map((entry) => [entry.path, entry.schedule]));
  assert.equal(schedules.get("/api/buffer-facebook-automation-cron"), "5 6-22 * * *");
  assert.equal(schedules.has("/api/buffer-facebook-automation-worker"), false);
  assert.equal(schedules.get("/api/buffer-facebook-story-automation"), "25 6-22 * * *");
  assert.equal(schedules.get("/api/buffer-instagram-mirror"), "40 6-22 * * *");
  assert.equal(schedules.get("/api/buffer-publish-status"), "5,25,45 6-22 * * *");
  assert.equal(schedules.get("/api/vansco-facebook-automation-worker"), "11 6-22 * * *");
  assert.equal(schedules.get("/api/vansco-facebook-story-automation-worker"), "31 6-22 * * *");
  assert.equal(schedules.get("/api/vansco-google-business-automation-worker"), "51 6-22 * * *");
});

test("Buffer API window follows London time across BST and winter", () => {
  assert.equal(isBufferApiActiveWindow(new Date("2026-09-28T06:05:00Z")), true);
  assert.equal(isBufferScheduledRunDue("two-hour", new Date("2026-09-28T06:05:00Z")), true);
  assert.equal(isBufferScheduledRunDue("two-hour", new Date("2026-09-28T09:05:00Z")), false);
  assert.equal(isBufferScheduledRunDue("vfc-facebook", new Date("2026-09-28T09:05:00Z")), true);
  assert.equal(isBufferApiActiveWindow(new Date("2026-09-28T21:20:00Z")), true);
  assert.equal(isBufferScheduledRunDue("vfc-facebook", new Date("2026-09-28T21:05:00Z")), true);
  assert.equal(isBufferScheduledRunDue("two-hour", new Date("2026-09-28T21:05:00Z")), true);
  assert.equal(isBufferApiActiveWindow(new Date("2026-09-28T22:20:00Z")), false);
  assert.equal(isBufferApiActiveWindow(new Date("2026-12-01T06:05:00Z")), false);
  assert.equal(isBufferApiActiveWindow(new Date("2026-12-01T07:05:00Z")), true);
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
  assert.match(status, /facebook_live: item\.destination !== "Van Finance Google Business"/);
  assert.match(status, /google_business_live: item\.destination === "Van Finance Google Business"/);
});

test("half of ten VFC automated Reels open with GOOD OR POOR CREDIT and others retain varied offers", () => {
  const openings = Array.from({ length: 10 }, (_, slotIndex) =>
    automatedReelFrameSpecs("vanFinance", slotIndex)[0].headline,
  );
  assert.equal(openings.filter((line) => line === "GOOD OR POOR CREDIT?").length, 5);
  for (let slot = 0; slot < 10; slot += 1) {
    assert.equal(isVanFinancePoorCreditReelSlot("vanFinance", slot), slot % 2 === 0);
    assert.equal(automatedReelFrameSpecs("vanFinance", slot).length, 10);
    if (slot % 2) assert.notEqual(openings[slot], "GOOD OR POOR CREDIT?");
  }
  assert.equal(openings[1], "FAST VAN FINANCE");
  assert.equal(openings[3], "YOUR NEXT VAN IS HERE");
  for (let slot = 0; slot < 10; slot += 1) {
    assert.equal(isVanFinancePoorCreditReelSlot("rent2buy", slot), false);
    const r2bFrames = automatedReelFrameSpecs("rent2buy", slot);
    assert.equal(r2bFrames.length, 10);
    assert.ok(!r2bFrames.some((frame) => /POOR CREDIT|GOOD OR BAD CREDIT/.test(frame.headline || "")));
  }
  assert.equal(automatedReelFrameSpecs("rent2buy", 0)[0].headline, "NO CREDIT CHECK VANS");
  for (let slot = 0; slot < 10; slot += 1) {
    assert.ok(!automatedReelFrameSpecs("vanFinance", slot)
      .some((frame) => /GOOD OR BAD CREDIT/.test(frame.headline || "")));
  }
});

test("only selected VFC Reel captions start with poor-credit question and Instagram mirror preserves it", () => {
  const vehicle = {
    registration: "AB12CDE",
    vanDescription: "Ford Transit Custom",
    weblink: "https://www.vanfinancecompany.co.uk/van-finance/live-ab12cde",
    webLink: "https://www.rent2buyvans.co.uk/van-pages/live-ab12cde",
  };
  const finance = buildAutomatedReelCaption({ productKey: "vanFinance", vehicle, slotIndex: 0 });
  const regular = buildAutomatedReelCaption({ productKey: "vanFinance", vehicle, slotIndex: 1 });
  const rent = buildAutomatedReelCaption({ productKey: "rent2buy", vehicle, slotIndex: 0 });
  assert.match(finance, /^GOOD OR POOR CREDIT\?\n\n/);
  assert.match(buildInstagramMirrorCaption(finance), /^GOOD OR POOR CREDIT\?\n\n/);
  assert.match(finance, /https:\/\/www\.vanfinancecompany\.co\.uk\/van-finance\/live-ab12cde$/);
  assert.doesNotMatch(regular, /^GOOD OR POOR CREDIT\?/);
  assert.doesNotMatch(rent, /^GOOD OR POOR CREDIT\?/);
  assert.match(rent, /^NO CREDIT CHECK/);
  const worker = source("api/buffer-facebook-automation-worker.js");
  assert.match(worker, /const poorCreditSlot = isVanFinancePoorCreditReelSlot\(productKey, slotInfo\.existing\)/);
  assert.match(worker, /const ready = poorCreditSlot \? null/);
  assert.match(worker, /frameSpecs: automatedReelFrameSpecs\(productKey, packIndex\)/);
  assert.match(worker, /slotIndex: slotInfo\.existing/);
  assert.match(source("api/youtube-mp4-render.js"), /"GOOD OR POOR CREDIT"/);
  assert.doesNotMatch(source("api/youtube-mp4-render.js"), /"GOOD OR BAD CREDIT"/);
});


test("VFC static advert hook alternates 50/50 without touching the full vehicle advert", () => {
  const vehicle = {
    registration: "WR67MME",
    vanDescription: "Fiat Doblo 1.6 Multijet Maxi",
    vanSpec: "YEAR: 2017\\nMILEAGE: 78,964\\nEURO: 6",
    price: "5995",
    salePrice: "125",
    weblink: "https://www.vanfinancecompany.co.uk/van-finance/WR67MME",
  };
  const baseline = buildAutomatedFacebookCaption(vehicle, "vanFinance");
  assert.match(baseline, /^FROM £99 DEPOSIT/);
  const expected = withVanFinancePoorCreditOpening(baseline, 0);
  assert.match(expected, /^GOOD OR POOR CREDIT\\?\\n\\nFROM £99 DEPOSIT/);
  assert.match(expected, /VAN FINANCE COMPANY \\| VAN FINANCE OPTIONS/);
  assert.match(expected, /REGISTRATION: WR67MME/);
  assert.match(expected, /MILEAGE: 78,964/);
  assert.match(expected, /£5,995 \\+ VAT/);
  assert.match(expected, /£125 MTH/);
  assert.ok(expected.endsWith(vehicle.weblink));
  assert.doesNotMatch(expected, /utm_|\\/track|\\/r\\//);
  const credits = Array.from({ length: 30 }, (_, i) => isVanFinancePoorCreditImageSlot(i));
  assert.equal(credits.filter(Boolean).length, 15);
  for (let i = 0; i < 30; i += 1) {
    const result = buildAutomatedFacebookCaption(vehicle, "vanFinance", { imageSlotIndex: i });
    assert.equal(result, i % 2 === 0 ? expected : baseline, `Buffer image slot ${i}`);
  }
  assert.equal(isVanFinancePoorCreditImageSlot(null), false);
  assert.equal(isVanFinancePoorCreditImageSlot(undefined), false);
  assert.equal(withVanFinancePoorCreditOpening(baseline, null), baseline);
  assert.equal(withVanFinancePoorCreditOpening(expected, 0), expected, "must not repeat hook");
});

test("Rent2Buy, Google Business, Reels and manual vehicle posting retain their own paths", () => {
  const rentVehicle = {
    registration: "WR67MME", monthly: "450",
    vanDescription: "Fiat Doblo",
    webLink: "https://www.rent2buyvans.co.uk/van-pages/live-wr67mme",
  };
  const ordinary = buildAutomatedFacebookCaption(rentVehicle, "rent2buy");
  for (let i = 0; i < 30; i += 1) {
    assert.equal(buildAutomatedFacebookCaption(rentVehicle, "rent2buy", { imageSlotIndex: i }), ordinary);
  }
  assert.match(ordinary, /^NO CREDIT CHECK/);
  const financeVehicle = {
    registration: "WR67MME", vanDescription: "Fiat Doblo", weblink: "https://www.vanfinancecompany.co.uk/van-finance/WR67MME",
  };
  assert.doesNotMatch(buildAutomatedReelCaption({ productKey: "vanFinance", vehicle: financeVehicle, slotIndex: 1 }), /^GOOD OR POOR CREDIT\\?/);
  assert.match(buildAutomatedReelCaption({ productKey: "vanFinance", vehicle: financeVehicle, slotIndex: 0 }), /^GOOD OR POOR CREDIT\\?/);
  const worker = source("api/buffer-facebook-automation-worker.js");
  assert.match(worker, /buildAutomatedFacebookCaption\\(vehicle, productKey, \\{ imageSlotIndex: slotInfo\\.existing \\}\\)/);
  assert.match(worker, /mediaUrls,\\n    mediaKind: "image"/);
  const app = source("App.jsx");
  const captionModule = source("utils/creativeUtils.js");
  assert.match(captionModule, /withVanFinancePoorCreditOpening\\(caption, index\\)/);
  assert.match(captionModule, /destination === "Van Finance Facebook" \\|\\| destination === "Van Finance Marketplace"/);
  assert.match(app, /case "Van Finance Groups & Classifieds":[\\s\\S]*?destination: "Van Finance Facebook"/);
  assert.match(app, /case "Rent2Buy Facebook Groups":[\\s\\S]*?destination: "Rent2Buy Facebook"/);
  assert.match(app, /case "Van Finance Marketplace":[\\s\\S]*?destination: "Van Finance Marketplace"/);
  assert.match(app, /case "Rent2Buy Marketplace":[\\s\\S]*?destination: "Rent2Buy Marketplace"/);
  const marketplace = source("services/marketplaceAutomation.js");
  assert.match(marketplace, /description: clean\\(caption\\) \\|\\| "Visit us at VANFINANCECOMPANY\\.co\\.uk"/);
  assert.match(marketplace, /images,\\n    imageCount: images\\.length/);
  assert.match(marketplace, /price: cashPrice/);
  assert.doesNotMatch(source("lib/vanFinanceStaticAdHooks.js"), /\b(localStorage|supabase|createBufferScheduledPost)\b/);
});
