import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_YOUTUBE_COOLDOWN_HOURS,
  DAILY_YOUTUBE_MIN_IMAGES,
  DAILY_YOUTUBE_TARGET_PER_PRODUCT,
  DAILY_YOUTUBE_TEMPLATE_KEY,
  buildRent2BuyDailyYouTubeImages,
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

test("daily YouTube batch locks Editorial Impact, 10 images and 10 per product defaults", () => {
  assert.equal(DAILY_YOUTUBE_TEMPLATE_KEY, "editorialImpact");
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

test("Rent2Buy Reels replace a contaminated Finance lead image with the Rent2Buy branded stock image", () => {
  const rent2buyPrimary = "https://static.wixstatic.com/media/rent2buy-card.png";
  const financePrimary = "https://static.wixstatic.com/media/finance-99-card.png";
  const galleryPhotos = Array.from({ length: 9 }, (_, index) => `https://example.com/photo-${index + 1}.jpg`);

  const images = buildRent2BuyDailyYouTubeImages(
    rent2buyPrimary,
    [financePrimary, ...galleryPhotos],
    galleryPhotos,
  );

  assert.equal(images.length, 10);
  assert.equal(images[0], rent2buyPrimary);
  assert.equal(images.includes(financePrimary), false);
  assert.deepEqual(images.slice(1), galleryPhotos);
});

test("Rent2Buy Reels keep the branded first image once when the Wix feed is already correct", () => {
  const rent2buyPrimary = "https://static.wixstatic.com/media/rent2buy-card.png";
  const galleryPhotos = Array.from({ length: 9 }, (_, index) => `https://example.com/photo-${index + 1}.jpg`);

  const images = buildRent2BuyDailyYouTubeImages(
    rent2buyPrimary,
    [rent2buyPrimary, ...galleryPhotos],
    galleryPhotos,
  );

  assert.equal(images.length, 10);
  assert.equal(images[0], rent2buyPrimary);
  assert.equal(images.filter((url) => url === rent2buyPrimary).length, 1);
  assert.deepEqual(images.slice(1), galleryPhotos);
});

test("Rent2Buy Reels reject every unproven secondary image, not only a contaminated lead", () => {
  const rent2buyPrimary = "https://static.wixstatic.com/media/rent2buy-card.png";
  const financeFreeDelivery = "https://static.wixstatic.com/media/finance-free-delivery.png";
  const financeWarranty = "https://static.wixstatic.com/media/finance-warranty.png";
  const genuine = Array.from({ length: 9 }, (_, index) => `https://example.com/genuine-${index + 1}.jpg`);
  const images = buildRent2BuyDailyYouTubeImages(
    rent2buyPrimary,
    [genuine[0], financeFreeDelivery, ...genuine.slice(1, 5), financeWarranty, ...genuine.slice(5)],
    genuine,
  );
  assert.equal(images[0], rent2buyPrimary);
  assert.equal(images.includes(financeFreeDelivery), false);
  assert.equal(images.includes(financeWarranty), false);
  assert.deepEqual(images.slice(1), genuine);
});

test("Rent2Buy Reel image assembly fails closed when no DealerKit provenance is available", () => {
  const rent2buyPrimary = "https://static.wixstatic.com/media/rent2buy-card.png";
  const images = buildRent2BuyDailyYouTubeImages(
    rent2buyPrimary,
    Array.from({ length: 10 }, (_, index) => `https://example.com/unknown-${index}.jpg`),
    [],
  );
  assert.deepEqual(images, [rent2buyPrimary]);
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
