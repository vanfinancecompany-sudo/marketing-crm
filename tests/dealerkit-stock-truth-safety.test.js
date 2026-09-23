import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canResolveDealerKitAbsence,
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

test("255 reported / 253 proven keeps positive DealerKit truth advancing without granting absence authority", async () => {
  const firstVehicles = Array.from({ length: 253 }, (_, index) => ({
    registration: `T${String(index).padStart(3, "0")}EST`,
    supplierStockId: `stock-${index}`,
    status: "available",
    sourceStatus: "In Stock",
  }));
  const secondVehicles = firstVehicles.map((vehicle, index) => index === 0
    ? { ...vehicle, status: "reserved", sourceStatus: "Reserved" }
    : vehicle).concat({
      registration: "NEW24VAN",
      supplierStockId: "stock-new",
      status: "available",
      sourceStatus: "In Stock",
  });

  let optionsSeen = null;
  const first = await loadStockWatchSnapshot({
    forceFresh: true,
    loadSnapshot: async (options) => {
      optionsSeen = options;
      return {
        complete: false,
        apiReportedTotal: 255,
        checkedAt: "2026-09-20T09:00:00Z",
        vehicles: firstVehicles,
        vehicleCount: 253,
        diagnostics: { failedPositions: [{ position: 219 }, { position: 223 }] },
      };
    },
  });

  assert.deepEqual(optionsSeen, { allowPartial: true, stabilityAttempts: 3 });
  assert.equal(first.complete, false);
  assert.equal(first.vehicleCount, 253);
  assert.equal(canResolveDealerKitAbsence(first), false);

  const second = await loadStockWatchSnapshot({
    forceFresh: true,
    loadSnapshot: async () => ({
      complete: false,
      apiReportedTotal: 256,
      checkedAt: "2026-09-20T10:00:00Z",
      vehicles: secondVehicles,
      vehicleCount: 254,
      diagnostics: { failedPositions: [{ position: 219 }, { position: 223 }] },
    }),
  });

  assert.equal(second.complete, false);
  assert.equal(second.vehicleCount, 254);
  assert.equal(second.vehicles[0].status, "reserved");
  assert.ok(second.vehicles.some((vehicle) => vehicle.registration === "NEW24VAN"));
  assert.equal(canResolveDealerKitAbsence(second), false);

  const latest = await loadStockWatchSnapshot({
    loadSnapshot: async () => { throw new Error("latest positive cache should be reused"); },
  });
  assert.equal(latest.checkedAt, "2026-09-20T10:00:00Z");
  assert.equal(latest.vehicleCount, 254);
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
  assert.match(source, /const positiveComparisonPaused = Boolean\(localLoadError\)/);
  assert.match(source, /const absenceComparisonPaused = positiveComparisonPaused \|\| !dealerKitSnapshotComplete/);
  assert.match(source, /const activeRecords = useMemo\(\(\) => positiveComparisonPaused \? \[\]/);
  assert.match(source, /if \(absenceComparisonPaused\) return \[\]/);
  assert.match(source, /const displayRecords = useMemo\(\(\) => positiveComparisonPaused \? \[\]/);
  assert.match(source, /Positively returned vehicles and statuses are still refreshed/);
  assert.match(source, /"My stock not on DealerKit" remains suspended/);
});


test("reserved lifecycle evidence wins before generic not-current handling and suppresses duplicate local-missing cards", () => {
  const classify = transformedClassifier();
  const local = new Set(["DN73VTM"]);
  const reservedTransition = {
    registration: "DN73VTM",
    sourceStatus: "reserved",
    sourceLifecycleStatus: "reserved",
    isCurrentlyOnVansco: false,
    isCurrentDealerKitBulkRecord: false,
  };

  assert.equal(classify(reservedTransition, local, "finance").displayStatus, "reserved");

  const source = pageSource();
  assert.match(source, /dealerKitAccountedRegistrationSet/);
  assert.match(source, /record\.isCurrentlyOnVansco !== false \|\| isReservedLikeStatus\(record\.sourceStatus\)/);
  assert.match(source, /!dealerKitAccountedRegistrationSet\.has\(registration\)/);
});

test("DealerKit lifecycle recovery keeps enough history to cover week-old disappearing stock", () => {
  const source = read("api/dealerkit-stock-watch-list.js");
  assert.match(source, /const RECENT_SOURCE_STATE_DAYS = 14;/);
});
