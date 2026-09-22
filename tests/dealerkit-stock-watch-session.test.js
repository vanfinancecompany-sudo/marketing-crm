import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDealerKitStockWatchSession } from "../api/dealerkit-stock-watch-session.js";
import { buildDealerKitStockWatchPayload } from "../api/dealerkit-stock-watch-list.js";
import { buildStockWatchImageReadiness } from "../lib/dealerkitStockWatchReadiness.js";
import { createDealerKitStockWatchSessionCache } from "../services/dealerkitStockWatchSession.js";

const vehicle = (registration, vehicleType, imageCount = 6) => ({
  registration, supplierStockId: `stock-${registration}`, vehicleType,
  status: "available", sourceStatus: "available", imageCount,
  checkedAt: "2026-09-22T10:00:00.000Z",
});

const snapshot = (complete = true) => ({
  complete, checkedAt: "2026-09-22T10:00:00.000Z", apiReportedTotal: 2,
  vehicleCount: 2, vehicles: [vehicle("AB12CDE", "LCV"), vehicle("CD34EFG", "Car")],
  diagnostics: { stability: { attemptsUsed: 1 } },
});

function supabaseWithNoTransitions() {
  return {
    from() {
      return {
        select() {
          return {
            gte() { return this; }, order() { return this; },
            limit: async () => ({ data: [], error: null }),
          };
        },
      };
    },
  };
}

function completeComparison(pipeline) {
  const registration = pipeline === "cars" ? "CD34EFG" : "AB12CDE";
  return {
    pipeline,
    presence: { complete: true, registrations: [registration], vehicles: [{ registration, title: registration }] },
    cmsItems: [{ registration, imageCount: 1 }], cmsRefreshedAt: "",
    cmsError: "", timing: { wixListingPresenceMs: 1, wixCmsImageMs: 1, totalMs: 2 },
  };
}

test("one manual session derives all three lanes and image readiness from one acquired snapshot", async () => {
  let acquisitions = 0;
  let receivedSnapshot;
  const comparisonReads = { finance: 0, rent2buy: 0, cars: 0 };
  const source = snapshot();
  const session = await createDealerKitStockWatchSession({
    loadSnapshot: async () => { acquisitions += 1; return source; },
    getSupabase: supabaseWithNoTransitions,
    syncSourceState: async () => ({ available: true, written: 0 }),
    loadActions: async () => ({ data: [], error: null }),
    loadComparison: async (pipeline) => { comparisonReads[pipeline] += 1; return completeComparison(pipeline); },
    buildLane: async (input) => {
      assert.equal(input.snapshot, source);
      receivedSnapshot = input.snapshot;
      return buildDealerKitStockWatchPayload(input);
    },
  });
  assert.equal(acquisitions, 1);
  assert.deepEqual(comparisonReads, { finance: 1, rent2buy: 1, cars: 1 });
  assert.equal(receivedSnapshot, source);
  assert.equal(session.timing.dealerKitStableSnapshotCalls, 1);
  assert.equal(session.timing.dealerKitBulkReadAttempts, 1);
  assert.deepEqual(session.lanes.finance.records.map((record) => record.registration), ["AB12CDE"]);
  assert.deepEqual(session.lanes.rent2buy.records.map((record) => record.registration), ["AB12CDE"]);
  assert.deepEqual(session.lanes.cars.records.map((record) => record.registration), ["CD34EFG"]);
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    assert.equal(session.lanes[pipeline].imageReadiness.alerts.length, 1);
    assert.equal(session.lanes[pipeline].imageReadiness.alerts[0].pipeline, pipeline);
  }
});

test("tab switches use cached lanes, while an explicit refresh reacquires source truth", async () => {
  let time = 0;
  let acquisitions = 0;
  const cache = createDealerKitStockWatchSessionCache({ now: () => time, ttlMs: 300000 });
  const fetchSession = async () => ({ ok: true, lanes: { finance: {}, rent2buy: {}, cars: {} }, generation: ++acquisitions });
  await cache.load(fetchSession);
  for (const pipeline of ["finance", "rent2buy", "cars", "finance"]) {
    assert.ok(cache.lane(pipeline));
    const result = await cache.load(fetchSession);
    assert.equal(result.cached, true);
  }
  assert.equal(acquisitions, 1);
  const fresh = await cache.load(fetchSession, { forceFresh: true });
  assert.equal(fresh.session.generation, 2);
  assert.equal(acquisitions, 2);
  time = 300001;
  await cache.load(fetchSession);
  assert.equal(acquisitions, 3);
});

test("incomplete source never proves absence; Wix failures suppress photo readiness", async () => {
  const source = snapshot(false);
  const session = await createDealerKitStockWatchSession({
    loadSnapshot: async () => source,
    getSupabase: supabaseWithNoTransitions,
    syncSourceState: async () => ({ available: true, written: 0 }),
    loadActions: async () => ({ data: [], error: null }),
    loadComparison: async (pipeline) => pipeline === "cars"
      ? { ...completeComparison(pipeline), presence: { complete: false, registrations: [], vehicles: [], errors: [{ error: "Wix failed" }] } }
      : completeComparison(pipeline),
  });
  assert.equal(session.sourceComplete, false);
  assert.equal(session.lanes.finance.summary.sourceComplete, false);
  assert.equal(session.lanes.finance.source.sourceState.transitionCandidates, 0);
  assert.equal(session.lanes.cars.imageReadiness.summary.complete, false);
  assert.deepEqual(session.lanes.cars.imageReadiness.alerts, []);
  assert.match(session.lanes.cars.imageReadiness.error, /incomplete/);
});

test("session uses one Wix listing result per lane for comparison and photo readiness", () => {
  const listingPresence = { complete: true, registrations: ["AB12CDE"], vehicles: [{ registration: "AB12CDE" }] };
  const alerts = buildStockWatchImageReadiness({
    pipeline: "finance",
    records: [{ ...vehicle("AB12CDE", "LCV"), isCurrentDealerKitBulkRecord: true }],
    listingPresence,
    cmsItems: [{ registration: "AB12CDE", imageCount: 1 }],
  });
  assert.equal(alerts.length, 1);
  assert.deepEqual(buildStockWatchImageReadiness({ pipeline: "finance", records: [], listingPresence, cmsItems: [] }), []);
  const renderedTransform = fs.readFileSync(new URL("../scripts/apply-dealerkit-stock-watch-session.mjs", import.meta.url), "utf8");
  assert.match(renderedTransform, /comparison \? comparison\.presence : await fetchStockWatchWixListingPresence/);
  assert.match(renderedTransform, /fetchDealerKitStockWatchComparison/);
  assert.doesNotMatch(renderedTransform.slice(renderedTransform.indexOf("async function handleRefreshCache")), /refreshVanscoCacheUrls\(/);
});
