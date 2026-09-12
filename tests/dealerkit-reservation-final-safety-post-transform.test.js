import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const endpointPaths = [
  "../api/finance-reserved-wix-stock.js",
  "../api/car-reserved-wix-stock.js",
  "../api/rent2buy-reserved-wix-stock.js",
];

test("post-transform reservation endpoints use exact identity and final per-write verification", () => {
  for (const path of endpointPaths) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /FINAL_DEALERKIT_RESERVATION_SAFETY/);
    assert.match(source, /supplier_stock_id \|\| request\.body\?\.supplierStockId/);
    assert.match(source, /prepareDealerKitReservedWixMutation/);
    assert.match(source, /for \(const match of preview\.matches\)/);
    assert.doesNotMatch(source, /Promise\.allSettled\(preview\.matches\.map/);
    assert.match(source, /invalid data response/);
    assert.match(source, /exceeded the safe Stock Watch row limit/);
  }
});

test("post-transform Stock Watch UI passes the current record stock ID", () => {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(source, /FINAL_DEALERKIT_RESERVATION_UI_SAFETY/);
  for (const name of ["Finance", "Car", "Rent2Buy"]) {
    assert.match(source, new RegExp(`unpublishReserved${name}WixStock\\(record\\.registration, record\\.supplierStockId\\)`));
    assert.match(source, new RegExp(`previewReserved${name}WixStock\\(record\\.registration, record\\.supplierStockId\\)`));
  }
  assert.equal((source.match(/Boolean\(normalizeWatchRegistration\(record\.registration\) && record\.supplierStockId\)/g) || []).length, 3);
});

test("Finance, Cars and Rent2Buy all stop when a required Wix collection read failed", async () => {
  const modules = await Promise.all([
    import("../api/finance-reserved-wix-stock.js"),
    import("../api/car-reserved-wix-stock.js"),
    import("../api/rent2buy-reserved-wix-stock.js"),
  ]);
  const actions = [
    modules[0].unpublishReservedFinanceWixStock,
    modules[1].unpublishReservedCarWixStock,
    modules[2].unpublishReservedRent2BuyWixStock,
  ];

  for (const action of actions) {
    let mutationCalls = 0;
    await assert.rejects(
      action("LC72YEG", {
        supplierStockId: "dealerkit-stock-42",
        verifyDealerKit: async () => ({ sourceStatus: "reserved" }),
        loadPreview: async () => ({
          matches: [],
          collections: [{ id: "REQUIRED", label: "Required collection", error: "Wix read failed", matches: [] }],
        }),
        mutateMatch: async () => { mutationCalls += 1; },
      }),
      /Wix could not be fully verified.*Nothing was changed in Wix/i,
    );
    assert.equal(mutationCalls, 0);
  }
});
