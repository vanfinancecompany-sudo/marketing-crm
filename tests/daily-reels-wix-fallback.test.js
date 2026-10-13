import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedDailyReelFallback, resolveDailyReelFeed } from "../lib/dailyReelFeedRecovery.js";

const urls = Array.from({ length: 10 }, (_, i) => "https://static.wixstatic.com/media/approved" + i + ".jpg");
const review = {
 registration: "BD73DXK",
 supplier_stock_id: "vehicle-123",
 review_status: "reviewed",
 finance_enabled: true,
 rent2buy_enabled: true,
 image_order_ids: urls.map((_, i) => "dk-" + i),
 excluded_image_ids: [],
 primary_image_id: "dk-0",
};
const media = urls.map((url, i) => ({
 supplier_stock_id: "vehicle-123", registration: "BD73DXK", dealerkit_image_id: "dk-" + i,
 wix_url: url, operation_status: i % 2 ? "READY" : "PENDING",
}));
const active = [{ registration: "BD73DXK", picture: "https://static.wixstatic.com/media/brand-primary.png" }];

test("a reviewed finance fallback preserves the branded opener and real imported images", () => {
 const result = buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [review], importedMedia: media });
 assert.equal(result.length, 1);
 assert.equal(result[0].images.length, 10);
 assert.equal(result[0].images[0], active[0].picture);
 assert.deepEqual(result[0].images.slice(1), urls.slice(0, 9));
});

test("rent2buy requires explicit product approval and retains branded stock primary", () => {
 assert.equal(buildApprovedDailyReelFallback({ productKey: "rent2buy", activeVehicles: active, reviews: [{ ...review, rent2buy_enabled: false }], importedMedia: media }).length, 0);
 const result = buildApprovedDailyReelFallback({ productKey: "rent2buy", activeVehicles: active, reviews: [review], importedMedia: media });
 assert.equal(result[0].images[0], active[0].picture);
 assert.equal(result[0].images.length, 10);
});

test("never includes imported images with a different registration or identity", () => {
 const bad = media.map(m => ({ ...m, registration: "ZZ99ZZZ" }));
 assert.equal(buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [review], importedMedia: bad }).length, 0);
});

test("unreviewed, excluded and ambiguous galleries fail closed", () => {
 assert.equal(buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [{ ...review, review_status: "needs_review" }], importedMedia: media }).length, 0);
 const excluded = { ...review, excluded_image_ids: ["dk-1", "dk-2"] };
 assert.equal(buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [excluded], importedMedia: media }).length, 0);
 assert.equal(buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [review, review], importedMedia: media }).length, 0);
});

test("never uses failed or unverified Wix imports as reel frames", () => {
 const badMedia = media.map((m, i) => i >= 2 ? { ...m, operation_status: "UNVERIFIED" } : m);
 assert.equal(buildApprovedDailyReelFallback({ productKey: "vanFinance", activeVehicles: active, reviews: [review], importedMedia: badMedia }).length, 0);
});

test("Wix error is recovered independently for each brand", async () => {
 const wixFeed = async key => {
   if (key === "rent2buy") throw new Error("HTTP 500");
   return [{ registration: "BD73DXK", images: urls }];
 };
 const fallbackFeed = async key => key === "rent2buy" ? [{ registration: "AA22BBB", images: urls }] : [];
 const [finance, rent] = await Promise.all([
   resolveDailyReelFeed({ key: "vanFinance", wixFeed, fallbackFeed, logger: { warn() {} } }),
   resolveDailyReelFeed({ key: "rent2buy", wixFeed, fallbackFeed, logger: { warn() {} } }),
 ]);
 assert.equal(finance.source, "wix");
 assert.equal(rent.source, "reviewed_imported_media");
 assert.equal(finance.items.length, 1);
 assert.equal(rent.items.length, 1);
});

test("a failed fallback returns an explicit error rather than invented candidates", async () => {
 const result = await resolveDailyReelFeed({
  key: "rent2buy", wixFeed: async () => { throw new Error("HTTP 500"); },
  fallbackFeed: async () => { throw new Error("Supabase unavailable"); },
 });
 assert.equal(result.source, "unavailable");
 assert.deepEqual(result.items, []);
 assert.match(result.error, /HTTP 500.*Supabase unavailable/);
});
