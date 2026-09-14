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

test("reserved DealerKit truth wins over live-feed absence for every Stock Watch lane", () => {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(source, /DEALERKIT_RESERVED_BUCKET_ROUTING/);
  const reservedIndex = source.indexOf('if (reservedOnVansco) return { ...baseRecord, displayStatus: "reserved"');
  const notCurrentIndex = source.indexOf('if (!currentlyOnVansco) return { ...baseRecord, displayStatus: "hidden_not_current"');
  assert.ok(reservedIndex >= 0, "reserved classification should exist");
  assert.ok(notCurrentIndex >= 0, "not-current classification should exist");
  assert.ok(reservedIndex < notCurrentIndex, "reserved classification must run before live-feed absence");
  assert.match(source, /const reservedDealerKitRegistrationSet = useMemo/);
  assert.match(source, /!reservedDealerKitRegistrationSet\.has\(registration\)/);
  assert.match(source, /\[activeLocalVehicles, currentVanscoRegistrationSet, reservedDealerKitRegistrationSet, selectedPipeline\]/);
  assert.match(source, /Reserved on DealerKit/);
});

test("DealerKit-missing Finance cards use Wix verification, safe removal, then Hide", () => {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(source, /DEALERKIT_MISSING_WIX_CONTROLS/);
  assert.match(source, /showFinanceMissingWix/);
  assert.match(source, /unpublishMissingFinanceWixStock\(record\.registration\)/);
  assert.match(source, /previewMissingFinanceWixStock\(record\.registration\)/);
  assert.match(source, /visibleLocalNotVanscoRecords/);
  assert.match(source, /showFinanceMissingWix \? <button[^>]+onClick=\{\(\) => saveWorkflow\("ignored", "Hidden"\)\}/);
});

test("Stock Watch visible naming is DealerKit while the legacy route key stays stable", () => {
  const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const navigationSource = fs.readFileSync(new URL("../public/shared/sidebar-navigation.js", import.meta.url), "utf8");
  const watchSource = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");

  assert.match(appSource, /DEALERKIT_STOCK_WATCH_DISPLAY_NAME/);
  assert.match(appSource, /DealerKit Stock Watch/);
  assert.match(navigationSource, /label: "DealerKit Stock Watch"/);
  assert.match(navigationSource, /view: "Vansco Stock Watch"/);
  assert.doesNotMatch(watchSource, /current Vansco cache for this tab/);
  assert.doesNotMatch(watchSource, /Saved Vansco cache records/);
  assert.doesNotMatch(watchSource, /Loading Vansco comparison/);
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

test("DealerKit-missing Finance removal requires a complete absent snapshot and rechecks before every Wix write", async () => {
  const { FINANCE_WIX_STOCK_COLLECTIONS } = await import("../api/finance-reserved-wix-stock.js");
  const { unpublishMissingFinanceWixStock } = await import("../api/finance-missing-dealerkit-wix-stock.js");
  const collections = FINANCE_WIX_STOCK_COLLECTIONS.map((collection) => ({ ...collection, live: false, error: "", matches: [] }));
  const matches = [
    { collectionId: FINANCE_WIX_STOCK_COLLECTIONS[0].id, collectionLabel: FINANCE_WIX_STOCK_COLLECTIONS[0].label, itemId: "one" },
    { collectionId: FINANCE_WIX_STOCK_COLLECTIONS[1].id, collectionLabel: FINANCE_WIX_STOCK_COLLECTIONS[1].label, itemId: "two" },
  ];
  let snapshotCalls = 0;
  let mutationCalls = 0;
  const result = await unpublishMissingFinanceWixStock("DN73VTM", {
    loadSnapshot: async () => {
      snapshotCalls += 1;
      return { complete: true, checkedAt: "2026-09-14T13:00:00.000Z", vehicles: [], vehicleCount: 192 };
    },
    loadPreview: async () => ({ collections, matches, protectedCollection: { id: "VANFINANCEPAGES", protected: true } }),
    mutateMatch: async (match) => {
      mutationCalls += 1;
      return { ...match, taskStatus: "COMPLETED", itemsSucceeded: 1 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, 2);
  assert.equal(mutationCalls, 2);
  assert.equal(snapshotCalls, 3, "one initial DealerKit absence check plus one immediately before each Wix write");
});

test("DealerKit-missing Finance removal fails closed for incomplete, reappeared, or partially unreadable source truth", async () => {
  const { FINANCE_WIX_STOCK_COLLECTIONS } = await import("../api/finance-reserved-wix-stock.js");
  const { unpublishMissingFinanceWixStock } = await import("../api/finance-missing-dealerkit-wix-stock.js");
  const cleanCollections = FINANCE_WIX_STOCK_COLLECTIONS.map((collection) => ({ ...collection, live: false, error: "", matches: [] }));
  let mutationCalls = 0;

  await assert.rejects(
    unpublishMissingFinanceWixStock("CK70VAF", {
      loadSnapshot: async () => ({ complete: false, vehicles: [] }),
      loadPreview: async () => ({ collections: cleanCollections, matches: [] }),
      mutateMatch: async () => { mutationCalls += 1; },
    }),
    /snapshot is incomplete or unstable/i,
  );

  await assert.rejects(
    unpublishMissingFinanceWixStock("CK70VAF", {
      loadSnapshot: async () => ({ complete: true, vehicles: [{ registration: "CK70VAF", status: "reserved" }] }),
      loadPreview: async () => ({ collections: cleanCollections, matches: [] }),
      mutateMatch: async () => { mutationCalls += 1; },
    }),
    /currently contains CK70VAF/i,
  );

  const failedCollections = cleanCollections.map((collection, index) => index === 0 ? { ...collection, error: "Wix read failed" } : collection);
  await assert.rejects(
    unpublishMissingFinanceWixStock("CK70VAF", {
      loadSnapshot: async () => ({ complete: true, vehicles: [] }),
      loadPreview: async () => ({ collections: failedCollections, matches: [] }),
      mutateMatch: async () => { mutationCalls += 1; },
    }),
    /Wix could not be fully verified before removal/i,
  );

  assert.equal(mutationCalls, 0);
});
