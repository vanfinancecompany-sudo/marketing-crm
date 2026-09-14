import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const endpointPaths = [
  "../api/finance-reserved-wix-stock.js",
  "../api/car-reserved-wix-stock.js",
  "../api/rent2buy-reserved-wix-stock.js",
];

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} should exist in transformed Stock Watch`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadTransformedClassifier() {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const names = [
    "normalizeWatchRegistration",
    "workflowStatusOf",
    "isReservedLikeStatus",
    "isTemporaryHiddenStatus",
    "isAdvertisedStatus",
    "isNeverShowStatus",
    "classifyWatchRecord",
  ];
  const body = `${names.map((name) => extractFunction(source, name)).join("\n")}\nreturn classifyWatchRecord;`;
  return { source, classify: new Function(body)() };
}

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

test("Finance and Rent2Buy preserve the old reserved completion state machine after all transforms", () => {
  const { source, classify } = loadTransformedClassifier();
  assert.match(source, /DEALERKIT_RESERVED_BUCKET_ROUTING/);
  assert.doesNotMatch(source, /if \(reservedOnVansco\) return \{ \.\.\.baseRecord, displayStatus: "reserved", matchStatus: hasExactLocalMatch/);

  for (const pipeline of ["finance", "rent2buy"]) {
    const advertised = new Set(["LJ19JBT"]);
    const empty = new Set();
    const reserved = { registration: "LJ19JBT", sourceStatus: "reserved", isCurrentlyOnVansco: true };
    const available = { registration: "LJ19JBT", sourceStatus: "available", isCurrentlyOnVansco: true };

    assert.equal(classify(reserved, advertised, pipeline).displayStatus, "reserved", `${pipeline}: live + reserved stays actionable`);
    assert.equal(classify(reserved, empty, pipeline).displayStatus, "hidden_reserved_not_advertised", `${pipeline}: reserved + zero advertising is finished`);
    assert.equal(classify({ ...reserved, workflowStatus: "ignored" }, empty, pipeline).displayStatus, "hidden", `${pipeline}: ignored completion stays hidden while reserved`);
    assert.equal(classify({ ...available, workflowStatus: "ignored" }, empty, pipeline).displayStatus, "back_in_stock", `${pipeline}: completed vehicle returns when supplier becomes available`);
    assert.equal(classify({ ...reserved, workflowStatus: "not_listing_spec" }, empty, pipeline).displayStatus, "never", `${pipeline}: permanent suppression survives reserved status`);
    assert.equal(classify({ ...reserved, workflowStatus: "ignored" }, advertised, pipeline).displayStatus, "reserved", `${pipeline}: re-advertised reserved stock becomes actionable again`);
  }
});

test("Finance and Rent2Buy completion is persisted and advertising presence is immediately reloaded", () => {
  const source = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(source, /moveFinanceWixMatchesToDraft[\s\S]*workflowStatus: "ignored"[\s\S]*window\.location\.reload\(\)/);
  assert.match(source, /moveRent2BuyWixMatchesToDraft[\s\S]*workflowStatus: "ignored"[\s\S]*window\.location\.reload\(\)/);
});

test("Stock Watch source API no longer derives Finance completion from telemetry tables", () => {
  const source = fs.readFileSync(new URL("../api/dealerkit-stock-watch-list.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /stock_watch_action_logs|stock_watch_monitor_runs|reservedVehicleIsResolved|latestClearFinanceChecks/);
  assert.match(source, /Saved actions remain per tab/);
});

test("DealerKit due-in and awaiting-delivery statuses save safely in the legacy workflow table", async () => {
  const { safeActionPayload, safeImageReadySourceStatus } = await import("../api/vansco-watch-action.js");
  assert.equal(safeImageReadySourceStatus({ sourceStatus: "due_in" }), "available");
  assert.equal(safeImageReadySourceStatus({ sourceStatus: "awaiting_delivery" }), "reserved");
  assert.equal(safeActionPayload("finance", { registration: "AB12CDE", sourceStatus: "due_in" }, "ignored", "").source_status, "available");
  assert.equal(safeActionPayload("rent2buy", { registration: "AB12CDE", sourceStatus: "awaiting_delivery" }, "ignored", "").source_status, "reserved");
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
