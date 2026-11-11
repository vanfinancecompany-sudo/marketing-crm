import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmDealerKitNotAvailable, inspectSoldWixListing, removeSoldWixListing } from "../api/stock-watch-sold-wix-remove.js";
import { FINANCE_WIX_STOCK_COLLECTIONS } from "../api/finance-reserved-wix-stock.js";

const REG = "AB22CDE";
const match = { collectionId: "VANFINANCE-ALLVANS", itemId: "wix-id-123", publishStatus: "PUBLISHED" };
const preview = (matches=[]) => ({
  ok: true,
  collections: FINANCE_WIX_STOCK_COLLECTIONS.map(({ id }) => ({ id, error: "" })),
  matches,
});

test("complete DealerKit absence or positive Sold/Awaiting Delivery can authorise review", async () => {
  for (const status of ["sold", "awaiting_delivery", "removed_from_dealerkit"]) {
    const result = await confirmDealerKitNotAvailable(REG, { loadSnapshot: async () => ({
      complete: false, vehicles: [{ registration: REG, status }],
    }) });
    assert.equal(result.state, status);
  }
  const missing = await confirmDealerKitNotAvailable(REG, { loadSnapshot: async () => ({ complete: true, vehicles: [] }) });
  assert.equal(missing.state, "removed_from_dealerkit");
});

test("never remove currently available, reserved, ambiguous or unverified DealerKit stock", async () => {
  for (const status of ["available", "reserved", "deposit_taken", "unknown"]) {
    await assert.rejects(() => confirmDealerKitNotAvailable(REG, {
      loadSnapshot: async () => ({ complete: true, vehicles: [{ registration: REG, status }] }),
    }), /Safety stop/);
  }
  await assert.rejects(() => confirmDealerKitNotAvailable(REG, {
    loadSnapshot: async () => ({ complete: false, vehicles: [] }),
  }), /incomplete/);
  await assert.rejects(() => confirmDealerKitNotAvailable(REG, {
    loadSnapshot: async () => ({ complete: true, vehicles: [
      { registration: REG, status: "sold" }, { registration: REG, status: "sold" },
    ] }),
  }), /multiple identities/);
});

test("Sold removal drafts only validated Wix listing records and verifies they are gone", async () => {
  let published = true;
  let writes = 0;
  const result = await removeSoldWixListing({ pipeline: "finance", registration: REG }, {
    confirmStatus: async () => ({ state: "sold" }),
    loadPreview: async () => preview(published ? [match] : []),
    draft: async item => {
      assert.equal(item.collectionId, "VANFINANCE-ALLVANS");
      writes += 1;
      published = false;
      return { collectionId: item.collectionId, itemId: item.itemId };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, 1);
  assert.equal(result.remaining, 0);
  assert.equal(writes, 1);
});

test("Sold removal never drafts protected, incomplete or already removed stock", async () => {
  let writes = 0;
  const draft = async () => { writes += 1; };
  const params = { pipeline: "finance", registration: REG };
  const confirmStatus = async () => ({ state: "sold" });
  await assert.rejects(() => removeSoldWixListing(params, {
    confirmStatus, draft,
    loadPreview: async () => preview([{ ...match, collectionId: "VANFINANCEPAGES" }]),
  }), /unexpected or protected/);
  await assert.rejects(() => removeSoldWixListing(params, {
    confirmStatus, draft,
    loadPreview: async () => ({ ...preview([match]), collections: [] }),
  }), /every approved listing collection/);
  const absent = await removeSoldWixListing(params, {
    confirmStatus, draft,
    loadPreview: async () => preview(),
  });
  assert.equal(absent.ok, true);
  assert.equal(absent.changed, 0);
  assert.equal(writes, 0);
});

test("preview inspection reports live Wix records without any changes", async () => {
  const result = await inspectSoldWixListing({ pipeline: "finance", registration: REG }, {
    confirmStatus: async () => ({ state: "awaiting_delivery" }),
    loadPreview: async () => preview([match]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.previewOnly, true);
  assert.equal(result.wouldRemove, 1);
  assert.equal(result.changed, 0);
  assert.equal(result.remaining, 1);
});

test("the Sold endpoint requires distinct read-only check and production-only removal actions", () => {
  const fs = requireFileSource();
  assert.match(fs, /action === "check"/);
  assert.match(fs, /action !== "remove"/);
  assert.match(fs, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(fs, /request\.body\?\.confirmed !== true/);
});
function requireFileSource() {
  return readFileSync(new URL("../api/stock-watch-sold-wix-remove.js", import.meta.url), "utf8");
}
