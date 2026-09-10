import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  defaultDealerKitReviewDecision,
  normalizeDealerKitReviewInput,
} from "../api/_dealerkit-review-decisions.js";

test("DealerKit review decisions keep All Vans mandatory and store only allowed neutral category keys", () => {
  const decision = normalizeDealerKitReviewInput({
    supplierStockId: "stock-123",
    registration: "HT22 KJX",
    reviewStatus: "reviewed",
    financeEnabled: true,
    financeCategories: ["automatic", "electric", "made_up_category"],
    rent2buyEnabled: true,
    excludedImageIds: ["image-2", "image-2"],
    primaryImageId: "image-2",
    imageOrderIds: ["image-2", "image-1", "image-3"],
    reviewedSourceUpdatedAt: "2026-09-10T12:00:00Z",
    notes: "Use the clean source photos only.",
  });

  assert.deepEqual(decision.financeCategories, ["all_vans", "automatic", "electric"]);
  assert.equal(decision.rent2buyEnabled, true);
  assert.deepEqual(decision.rent2buyCategories, []);
  assert.deepEqual(decision.excludedImageIds, ["image-2"]);
  assert.equal(decision.primaryImageId, null);
  assert.deepEqual(decision.imageOrderIds, ["image-1", "image-3"]);
  assert.equal(decision.registration, "HT22KJX");
});

test("disabling Van Finance does not leave publish categories active", () => {
  const decision = normalizeDealerKitReviewInput({
    supplierStockId: "stock-456",
    registration: "OY72 YSJ",
    financeEnabled: false,
    financeCategories: ["all_vans", "medium_mwb", "automatic"],
  });
  assert.equal(decision.financeEnabled, false);
  assert.deepEqual(decision.financeCategories, []);
});

test("review API rejects invalid registrations and future publish statuses", () => {
  assert.throws(
    () => normalizeDealerKitReviewInput({ supplierStockId: "stock-1", registration: "not-a-reg" }),
    /valid vehicle registration/i,
  );
  assert.throws(
    () => normalizeDealerKitReviewInput({ supplierStockId: "stock-1", registration: "HT22KJX", reviewStatus: "published" }),
    /not allowed at this stage/i,
  );
});

test("new review state references source image IDs rather than storing image files", () => {
  const decision = defaultDealerKitReviewDecision({
    supplierStockId: "stock-1",
    registration: "HT22KJX",
    images: [
      { id: "image-1", url: "https://images.example/one.jpg" },
      { id: "image-2", url: "https://images.example/two.jpg" },
    ],
  });
  assert.equal(decision.primaryImageId, "image-1");
  assert.deepEqual(decision.imageOrderIds, ["image-1", "image-2"]);
  assert.doesNotMatch(JSON.stringify(decision), /images\.example/i);
});

test("review decision endpoint is access-gated and cannot write DealerKit or Wix", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-review-decision.js", import.meta.url), "utf8");
  assert.match(endpoint, /Marketing CRM access is required/);
  assert.match(endpoint, /saveDealerKitReviewDecision/);
  assert.doesNotMatch(endpoint, /api\.dealerkit\.uk|wixapis|VANFINANCEPAGES|PATCH\s+https/i);
});

test("review workspace exposes decisions but still has no Wix publish action", () => {
  const ui = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(ui, /Save review/);
  assert.match(ui, /Use image/);
  assert.match(ui, /Set primary/);
  assert.match(ui, /Send to Rent2Buy later/);
  assert.match(ui, /all_vans/);
  assert.match(ui, /\/api\/dealerkit-review-decision/);
  assert.doesNotMatch(ui, /Publish to Wix|Update Wix vehicle|Send live/i);
});

test("DealerKit review migration is server-only orchestration state with RLS enabled", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/202609101315_dealerkit_review_decisions.sql", import.meta.url), "utf8");
  assert.match(migration, /dealerkit_review_decisions/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /excluded_image_ids text\[\]/i);
  assert.doesNotMatch(migration, /bytea|blob|image_url/i);
  assert.doesNotMatch(migration, /create policy/i);
});
