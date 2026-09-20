import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  dealerKitBulkRegistrations,
  loadStockWatchSnapshot,
  resolveRecentDealerKitTransitions,
  vehicleRecord,
} from "../api/dealerkit-stock-watch-list.js";
import { classifyDealerKitVehicle } from "../lib/dealerKitVehicleSegmentation.js";
import { fetchDealerKitStockSnapshot } from "../api/_dealerkit-stock-adapter.js";

const pageSource = () => fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");

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

function transformedClassifier() {
  const source = pageSource();
  const names = [
    "normalizeWatchRegistration",
    "workflowStatusOf",
    "isReservedLikeStatus",
    "isTemporaryHiddenStatus",
    "isAdvertisedStatus",
    "isNeverShowStatus",
    "classifyWatchRecord",
  ];
  return new Function(`${names.map((name) => extractFunction(source, name)).join("\n")}\nreturn classifyWatchRecord;`)();
}

function sourceStateSupabase(rows) {
  return {
    from() {
      return {
        select() {
          return {
            gte() {
              return {
                order() {
                  return { async limit() { return { data: rows, error: null }; } };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("available historical detail remains lifecycle-only and cannot prove current DealerKit presence", async () => {
  const stockId = "historical-stock-id";
  const row = {
    registration: "AB12CDE",
    supplier_stock_id: stockId,
    last_status: "available",
    source_status: "In Stock",
    last_seen_at: "2026-09-18T10:00:00Z",
    vehicle_snapshot: {
      registration: "AB12CDE",
      supplierStockId: stockId,
      status: "available",
      sourceStatus: "In Stock",
      vehicleType: "LCV",
      bodyType: "Panel Van",
    },
  };
  const transitions = await resolveRecentDealerKitTransitions({
    supabase: sourceStateSupabase([row]),
    snapshot: { complete: true, vehicles: [] },
    pipeline: "finance",
    loadDetail: async () => ({
      registration: "AB12CDE",
      supplierStockId: stockId,
      status: "available",
      sourceStatus: "In Stock",
      vehicleType: "LCV",
      bodyType: "Panel Van",
    }),
  });

  assert.equal(transitions.vehicles.length, 1);
  assert.equal(transitions.vehicles[0].sourceResolution, "historical_identity_detail");
  const record = vehicleRecord({ ...transitions.vehicles[0], isCurrentDealerKitBulkRecord: false });
  assert.equal(record.isCurrentlyOnVansco, false);
  assert.equal(record.isCurrentDealerKitBulkRecord, false);
});

test("an incomplete DealerKit refresh cannot replace the last verified complete snapshot", async () => {
  const verified = {
    complete: true,
    checkedAt: "2026-09-20T09:00:00Z",
    vehicles: [{ registration: "AF71TVY", supplierStockId: "af71", status: "available" }],
    vehicleCount: 1,
  };
  let completeOptions = null;
  await loadStockWatchSnapshot({
    forceFresh: true,
    loadSnapshot: async (options) => {
      completeOptions = options;
      return verified;
    },
  });

  assert.deepEqual(completeOptions, { allowPartial: false, stabilityAttempts: 3 });
  await assert.rejects(
    loadStockWatchSnapshot({
      forceFresh: true,
      loadSnapshot: async () => ({ complete: false, vehicles: [] }),
    }),
    /incomplete.*last verified/i,
  );

  const retained = await loadStockWatchSnapshot({
    loadSnapshot: async () => { throw new Error("verified cache should have been retained"); },
  });
  assert.equal(retained.complete, true);
  assert.deepEqual(retained.vehicles.map((vehicle) => vehicle.registration), ["AF71TVY"]);
});

test("repeated historical 404s never freeze later complete bulk snapshots", async () => {
  const historicalRow = {
    registration: "AF71TVY",
    supplier_stock_id: "obsolete-stock-id",
    last_status: "available",
    source_status: "In Stock",
    title: "Ford Transit Custom",
    source_updated_at: "2026-09-17T10:00:00Z",
    first_seen_at: "2026-09-15T10:00:00Z",
    last_seen_at: "2026-09-17T10:00:00Z",
    updated_at: "2026-09-17T10:00:00Z",
    vehicle_snapshot: {
      registration: "AF71TVY",
      supplierStockId: "obsolete-stock-id",
      status: "available",
      sourceStatus: "In Stock",
      vehicleType: "LCV",
      bodyType: "Panel Van",
    },
  };
  const snapshots = [
    { complete: true, checkedAt: "2026-09-20T10:00:00Z", vehicles: [{ registration: "NEW12ONE", supplierStockId: "new-1", status: "available" }], vehicleCount: 1 },
    { complete: true, checkedAt: "2026-09-20T11:00:00Z", vehicles: [{ registration: "NEW12ONE", supplierStockId: "new-1", status: "available" }, { registration: "NEW12TWO", supplierStockId: "new-2", status: "available" }], vehicleCount: 2 },
  ];

  for (const snapshot of snapshots) {
    const accepted = await loadStockWatchSnapshot({ forceFresh: true, loadSnapshot: async () => snapshot });
    assert.equal(accepted.complete, true);
    const transitions = await resolveRecentDealerKitTransitions({
      supabase: sourceStateSupabase([historicalRow]),
      snapshot: accepted,
      pipeline: "finance",
      loadDetail: async () => { throw new Error("DealerKit stock detail failed with HTTP 404."); },
    });
    assert.equal(transitions.detailErrors, 0);
    assert.equal(transitions.unresolved, 0);
    assert.equal(transitions.vehicles[0].status, "removed_from_dealerkit");
  }

  const latest = await loadStockWatchSnapshot({ loadSnapshot: async () => { throw new Error("latest verified cache should be used"); } });
  assert.equal(latest.checkedAt, "2026-09-20T11:00:00Z");
  assert.deepEqual(latest.vehicles.map((vehicle) => vehicle.registration), ["NEW12ONE", "NEW12TWO"]);
});

test("a valid current bulk identity remains present without optional detail enrichment", async () => {
  const requestedPaths = [];
  const snapshot = await fetchDealerKitStockSnapshot({
    environment: { DEALERKIT_API_SECRET: "test-secret", DEALERKIT_DEALER_ID: "70376" },
    perPage: 100,
    fetchImplementation: async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);
      assert.equal(url.pathname, "/integrators/stock", "a valid bulk identity must not require a detail/enrichment read");
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            data: [{ id: "current-stock-id", status: "In Stock", vehicle: { registration: "AB24CDE" } }],
            meta: { total: 1, current_page: 1, last_page: 1, per_page: 100 },
          });
        },
      };
    },
  });

  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.vehicles.map((vehicle) => vehicle.registration), ["AB24CDE"]);
  assert.deepEqual(requestedPaths, ["/integrators/stock"]);
});

test("unknown product classification never erases exact DealerKit bulk presence", () => {
  const unknownVehicle = {
    registration: "ZZ24XYZ",
    supplierStockId: "unknown-type",
    status: "available",
    sourceStatus: "In Stock",
    make: "Example",
    model: "Unclassified",
  };
  assert.equal(classifyDealerKitVehicle(unknownVehicle).segment, "unknown");
  assert.deepEqual(dealerKitBulkRegistrations({ complete: true, vehicles: [unknownVehicle] }), ["ZZ24XYZ"]);

  const source = pageSource();
  assert.match(source, /cacheSummary\?\.currentDealerKitRegistrations/);
  assert.match(source, /record\.isCurrentDealerKitBulkRecord === true/);
});

test("Non-Stock and unknown statuses stay non-actionable while AF71TVY still returns Back in stock when explicitly available", () => {
  const classify = transformedClassifier();
  const empty = new Set();
  const base = {
    registration: "AF71TVY",
    isCurrentlyOnVansco: true,
    isCurrentDealerKitBulkRecord: true,
  };

  assert.equal(classify({ ...base, sourceStatus: "non_stock", sourceLifecycleStatus: "non_stock" }, empty, "finance").displayStatus, "hidden_not_available");
  assert.equal(classify({ ...base, sourceStatus: "non_stock", sourceLifecycleStatus: "non_stock", workflowStatus: "ignored" }, empty, "finance").displayStatus, "hidden");
  assert.equal(classify({ ...base, sourceStatus: "unknown", sourceLifecycleStatus: "unknown" }, empty, "finance").displayStatus, "hidden_not_available");
  assert.equal(classify({ ...base, sourceStatus: "available", sourceLifecycleStatus: "available" }, empty, "finance").displayStatus, "missing");
  assert.equal(classify({ ...base, sourceStatus: "available", sourceLifecycleStatus: "available", workflowStatus: "ignored" }, empty, "finance").displayStatus, "back_in_stock");
});

test("failed or partial Wix presence retains prior truth and pauses cards, summaries and filter counts", () => {
  const source = pageSource();
  const loadLocalStock = extractFunction(source, "loadLocalStock");

  assert.match(loadLocalStock, /Stock data incomplete \/ last verified snapshot shown/);
  assert.doesNotMatch(loadLocalStock, /setLocalVehiclesByPipeline\(\(prev\) => \(\{ \.\.\.prev, \[pipeline\]: \[\] \}\)\)/);
  assert.doesNotMatch(loadLocalStock, /setLocalRegistrationsByPipeline\(\(prev\) => \(\{ \.\.\.prev, \[pipeline\]: new Set\(\) \}\)\)/);
  assert.match(source, /const comparisonPaused = Boolean\(localLoadError\) \|\| !dealerKitSnapshotComplete/);
  assert.match(source, /const activeRecords = useMemo\(\(\) => comparisonPaused \? \[\]/);
  assert.match(source, /const displayRecords = useMemo\(\(\) => comparisonPaused \? \[\]/);
  assert.match(source, /const comparisonCount = \(value\) => comparisonPaused \? "—" : value/);
  assert.match(source, /Action cards, summary totals and filter counts are paused/);
});
