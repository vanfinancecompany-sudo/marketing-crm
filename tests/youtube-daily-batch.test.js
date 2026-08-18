import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_YOUTUBE_COOLDOWN_HOURS,
  DAILY_YOUTUBE_MIN_IMAGES,
  DAILY_YOUTUBE_TARGET_PER_PRODUCT,
  DAILY_YOUTUBE_TEMPLATE_KEY,
  normalizeDailyYouTubeImageUrl,
  selectDailyYouTubeCandidates,
} from "../lib/youtubeDailyBatch.js";

function candidate(registration, imageCount = 10) {
  return {
    registration,
    images: Array.from({ length: imageCount }, (_, index) => `https://example.com/${registration}-${index}.jpg`),
  };
}

function history(registration, occurredAt, productKey = "vanFinance") {
  return {
    occurred_at: occurredAt,
    metadata: { registration, product_key: productKey },
  };
}

test("daily YouTube batch locks TikTok, 10 images and 10 per product defaults", () => {
  assert.equal(DAILY_YOUTUBE_TEMPLATE_KEY, "tiktokPunch");
  assert.equal(DAILY_YOUTUBE_MIN_IMAGES, 10);
  assert.equal(DAILY_YOUTUBE_TARGET_PER_PRODUCT, 10);
  assert.equal(DAILY_YOUTUBE_COOLDOWN_HOURS, 48);
});

test("daily batch converts Wix gallery references into downloadable public URLs", () => {
  assert.equal(
    normalizeDailyYouTubeImageUrl("wix:image://v1/abc123/photo.jpg#originWidth=1600&originHeight=1200"),
    "https://static.wixstatic.com/media/abc123",
  );
  assert.equal(
    normalizeDailyYouTubeImageUrl("//static.wixstatic.com/media/xyz789"),
    "https://static.wixstatic.com/media/xyz789",
  );
  assert.equal(
    normalizeDailyYouTubeImageUrl("https://static.wixstatic.com/media/live123"),
    "https://static.wixstatic.com/media/live123",
  );
});

test("daily YouTube batch rejects fewer than 10 images and registrations used inside 48 hours", () => {
  const now = Date.parse("2026-08-18T18:00:00.000Z");
  const rows = [
    candidate("AA24AAA", 9),
    candidate("BB24BBB", 10),
    candidate("CC24CCC", 10),
  ];
  const historyRows = [
    history("BB24BBB", new Date(now - 47 * 60 * 60 * 1000).toISOString()),
    history("CC24CCC", new Date(now - 49 * 60 * 60 * 1000).toISOString()),
  ];

  const selected = selectDailyYouTubeCandidates({ candidates: rows, historyRows, now });
  assert.deepEqual(selected.map((item) => item.registration), ["CC24CCC"]);
});

test("registration becomes eligible at the 48 hour boundary", () => {
  const now = Date.parse("2026-08-18T18:00:00.000Z");
  const selected = selectDailyYouTubeCandidates({
    candidates: [candidate("DD24DDD")],
    historyRows: [
      history("DD24DDD", new Date(now - 48 * 60 * 60 * 1000).toISOString()),
    ],
    now,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].registration, "DD24DDD");
});

test("daily batch fills only the remaining daily allowance", () => {
  const selected = selectDailyYouTubeCandidates({
    candidates: Array.from({ length: 12 }, (_, index) => candidate(`AB2${index}XYZ`)),
    generatedToday: 7,
    now: Date.parse("2026-08-18T18:00:00.000Z"),
  });
  assert.equal(selected.length, 3);
});

test("reserved registrations prevent the same vehicle crossing Finance and Rent2Buy in one batch", () => {
  const selected = selectDailyYouTubeCandidates({
    candidates: [candidate("EE24EEE"), candidate("FF24FFF")],
    reservedRegistrations: ["EE24EEE"],
    now: Date.parse("2026-08-18T18:00:00.000Z"),
  });
  assert.deepEqual(selected.map((item) => item.registration), ["FF24FFF"]);
});

test("never-used vehicles are preferred, then the oldest previously used vehicle", () => {
  const now = Date.parse("2026-08-18T18:00:00.000Z");
  const selected = selectDailyYouTubeCandidates({
    candidates: [candidate("GG24GGG"), candidate("HH24HHH"), candidate("JJ24JJJ")],
    historyRows: [
      history("GG24GGG", new Date(now - 80 * 60 * 60 * 1000).toISOString()),
      history("HH24HHH", new Date(now - 120 * 60 * 60 * 1000).toISOString()),
    ],
    now,
  });

  assert.deepEqual(selected.map((item) => item.registration), ["JJ24JJJ", "HH24HHH", "GG24GGG"]);
});
