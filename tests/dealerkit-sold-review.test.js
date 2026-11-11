import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSoldRemovalReview, projectPublicDealerKitAvailability } from "../lib/dealerKitPublicAvailability.mjs";

test("only confirmed final lifecycle transitions enter Sold / Removal Review", () => {
  for (const sourceLifecycleStatus of ["sold", "awaiting_delivery", "removed_from_dealerkit"]) {
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, sourceStatus: "reserved" }), true);
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, workflowStatus: "hidden" }), true);
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, workflowStatus: "never_show_again" }), true);
  }
  for (const sourceLifecycleStatus of ["reserved", "deposit_taken", "available", "source_unresolved"]) {
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus }), false);
  }
});

test("server-safe availability projection retains only real observed registrations and respects manual Hide per lane", () => {
  const now = Date.parse("2026-11-11T13:00:00Z");
  const source = [
    { registration: "AB22 CDE", supplier_stock_id: "1", source_status: "Reserved", last_seen_at: "2026-11-11T12:45:00Z" },
    { registration: "CC72 DEF", supplier_stock_id: "2", source_status: "Deposit Taken", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "SO22 LDD", supplier_stock_id: "3", source_status: "Sold", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "OL22 DER", supplier_stock_id: "4", source_status: "Reserved", last_seen_at: "2026-10-01T12:43:00Z" },
    { registration: "YY22 AAA", supplier_stock_id: "5", source_status: "In Stock", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "XX22 AAA", supplier_stock_id: "", source_status: "Reserved", last_seen_at: "2026-11-11T12:43:00Z" },
  ];
  const actions = [
    { registration: "AB22 CDE", pipeline: "finance", workflow_status: "hidden" },
    { registration: "AB22 CDE", pipeline: "rent2buy", workflow_status: "new" },
    { registration: "SO22 LDD", pipeline: "cars", workflow_status: "never_show_again" },
  ];
  assert.deepEqual(projectPublicDealerKitAvailability(source, actions, { now }), [
    { registration: "AB22CDE", status: "reserved", hidden: ["finance"] },
    { registration: "CC72DEF", status: "reserved", hidden: [] },
    { registration: "SO22LDD", status: "unavailable", hidden: ["cars"] },
  ]);
});

test("post-build Stock Watch offers a separate Sold filter while keeping existing Reserved controls", () => {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(source, /DEALERKIT_SOLD_REVIEW_UI/);
  assert.match(source, /value: "sold", label: "Sold \/ Removal Review"/);
  assert.match(source, /displayStatus: "sold"/);
  assert.match(source, /summary\.sold/);
  assert.match(source, /record\.displayStatus === "sold"/);
  assert.match(source, /soldReviewRecords/);
  assert.match(source, /Remove from website/);
  assert.match(source, /onSoldRemoved/);
  assert.match(source, /saveWorkflow\("ignored", "Hidden"\)/);
  assert.match(source, /label="Reserved on DealerKit"/);
  const begin = source.indexOf("function WatchCard(");
  const finish = source.indexOf("async function fetchLocalVehiclesForPipeline", begin);
  assert.ok(begin >= 0 && finish > begin, "WatchCard component must be located");
  const card = source.slice(begin, finish);
  assert.match(card, /const \[soldRemoving, setSoldRemoving\] = useState\(false\)/);
  assert.match(card, /const isSoldPreview = (true|false)/);
  assert.match(card, /async function removeSoldFromWix\(\)/);
  assert.match(card, /onClick=\{removeSoldFromWix\}/);
  assert.match(card, /onClick=\{checkSoldWix\}/);
  assert.match(card, /disabled=\{soldRemoving \|\| isSoldPreview\}/);
  assert.match(card, /Remove from website is disabled to protect live Wix adverts/);
  assert.match(card, /Check Wix listing \(read-only\)/);

  assert.match(card, /function WatchCard\(\{[^}]*onSoldRemoved/);
});
