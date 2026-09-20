import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fetchStableDealerKitStockSnapshot } from "../api/_dealerkit-stable-stock-snapshot.js";
import { verifyDealerKitMissingRegistration } from "../api/finance-missing-dealerkit-wix-stock.js";
import { verifyDealerKitReservedRegistration } from "../api/_dealerkit-reservation-verification.js";

const ENV = {
  DEALERKIT_API_SECRET: "test-secret",
  DEALERKIT_DEALER_ID: "70376",
};

const AF71_STOCK_ID = "c500e0856a9b0c7db4be7";

function listing({ id, registration, status = "In Stock" }) {
  return {
    id,
    status,
    vehicle: {
      registration,
      type: "LCV",
      manufacturer: "Ford",
      model: "Transit Custom",
      derivative: "2.0 EcoBlue Panel Van",
    },
    prices: { advertised: { amount: 12995, vat_status: "ex-VAT" } },
    media: { images: [] },
    updated_at: "2026-09-15T12:00:00Z",
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return payload === null || payload === undefined ? "" : JSON.stringify(payload);
    },
  };
}

function historicalAf71State(overrides = {}) {
  return {
    registration: "AF71TVY",
    supplier_stock_id: AF71_STOCK_ID,
    last_status: "available",
    source_status: "In Stock",
    last_seen_at: "2026-09-15T13:15:00Z",
    updated_at: "2026-09-15T13:15:00Z",
    vehicle_snapshot: {
      registration: "AF71TVY",
      supplierStockId: AF71_STOCK_ID,
      status: "available",
      sourceStatus: "In Stock",
      vehicleType: "LCV",
      title: "Ford Transit Custom",
    },
    ...overrides,
  };
}

test("AF71TVY Reserved presence wins before the incomplete-snapshot missing gate", async () => {
  const loadSnapshot = async () => ({
    complete: false,
    checkedAt: "2026-09-15T12:00:00Z",
    vehicleCount: 1,
    vehicles: [
      {
        registration: "AF71 TVY",
        status: "reserved",
        sourceStatus: "Reserved",
      },
    ],
  });

  await assert.rejects(
    verifyDealerKitMissingRegistration("AF71 TVY", { loadSnapshot }),
    (error) => {
      assert.match(error.message, /DealerKit currently contains AF71TVY \(Reserved\)/);
      assert.doesNotMatch(error.message, /could not prove AF71TVY is absent/i);
      assert.match(error.message, /Nothing was changed in Wix\./);
      return true;
    },
  );
});

test("AF71TVY total drift is retried from page one and a stable Reserved snapshot becomes complete", async () => {
  let listAttempt = 0;

  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (perPage === 2 && page === 1) {
      listAttempt += 1;
      if (listAttempt === 1) {
        return response(200, {
          data: [
            listing({ id: "stock-a", registration: "AA11 AAA" }),
            listing({ id: "stock-af71tvy", registration: "AF71 TVY", status: "Reserved" }),
          ],
          meta: { total: 3, current_page: 1, last_page: 2, per_page: 2 },
        });
      }

      return response(200, {
        data: [
          listing({ id: "stock-a", registration: "AA11 AAA" }),
          listing({ id: "stock-af71tvy", registration: "AF71 TVY", status: "Reserved" }),
        ],
        meta: { total: 2, current_page: 1, last_page: 1, per_page: 2 },
      });
    }

    if (listAttempt === 1 && perPage === 2 && page === 2) {
      return response(200, {
        data: [],
        meta: { total: 2, current_page: 2, last_page: 1, per_page: 2 },
      });
    }

    if (listAttempt === 1 && perPage === 1 && page === 3) {
      return response(200, {
        data: [],
        meta: { total: 2, current_page: 3, last_page: 2, per_page: 1 },
      });
    }

    throw new Error(`Unexpected DealerKit request: ${url.toString()}`);
  };

  const snapshot = await fetchStableDealerKitStockSnapshot({
    environment: ENV,
    fetchImplementation,
    perPage: 2,
  });

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 2);
  assert.equal(snapshot.diagnostics.stability.attemptsUsed, 2);
  assert.equal(snapshot.diagnostics.stability.attempts[0].totalDrift, true);
  assert.equal(snapshot.diagnostics.stability.attempts[1].complete, true);

  const af71tvy = snapshot.vehicles.find((vehicle) => vehicle.registration === "AF71TVY");
  assert.ok(af71tvy);
  assert.equal(af71tvy.status, "reserved");
  assert.equal(af71tvy.sourceStatus, "Reserved");
});

test("AF71TVY transient failed position is retried and resolves as Reserved", async () => {
  let listAttempt = 0;

  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (perPage === 2 && page === 1) {
      listAttempt += 1;
      return response(200, {
        data: [
          listing({ id: "stock-a", registration: "AA11 AAA" }),
          listing({ id: "stock-b", registration: "BB22 BBB" }),
        ],
        meta: { total: 4, current_page: 1, last_page: 2, per_page: 2 },
      });
    }

    if (perPage === 2 && page === 2 && listAttempt === 1) {
      return response(500, { message: "Transient DealerKit page failure" });
    }

    if (perPage === 1 && page === 3 && listAttempt === 1) {
      return response(200, {
        data: [listing({ id: "stock-c", registration: "CC33 CCC" })],
        meta: { total: 4, current_page: 3, last_page: 4, per_page: 1 },
      });
    }

    if (perPage === 1 && page === 4 && listAttempt === 1) {
      return response(500, { message: "AF71TVY row temporarily unreadable" });
    }

    if (perPage === 2 && page === 2 && listAttempt === 2) {
      return response(200, {
        data: [
          listing({ id: "stock-c", registration: "CC33 CCC" }),
          listing({ id: "stock-af71tvy", registration: "AF71 TVY", status: "Reserved" }),
        ],
        meta: { total: 4, current_page: 2, last_page: 2, per_page: 2 },
      });
    }

    throw new Error(`Unexpected DealerKit request: ${url.toString()}`);
  };

  const snapshot = await fetchStableDealerKitStockSnapshot({
    environment: ENV,
    fetchImplementation,
    perPage: 2,
  });

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 4);
  assert.equal(snapshot.diagnostics.stability.attemptsUsed, 2);
  assert.equal(snapshot.diagnostics.stability.attempts[0].failedPositions, 1);
  assert.equal(snapshot.diagnostics.stability.attempts[0].retryableIncomplete, true);
  assert.equal(snapshot.diagnostics.stability.attempts[1].complete, true);

  const af71tvy = snapshot.vehicles.find((vehicle) => vehicle.registration === "AF71TVY");
  assert.ok(af71tvy);
  assert.equal(af71tvy.status, "reserved");
  assert.equal(af71tvy.sourceStatus, "Reserved");
});

test("incomplete DealerKit snapshots cannot manufacture My stock not on DealerKit cards", () => {
  const pageSource = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");

  assert.match(pageSource, /const dealerKitSnapshotComplete = cacheSummary\?\.sourceComplete === true/);
  assert.match(pageSource, /if \(absenceComparisonPaused\) return \[\]/);
  assert.match(pageSource, /No CRM vehicle is classified as absent until a complete DealerKit snapshot proves it/);
});

test("AF71TVY still cannot be treated as missing when no presence is seen in an incomplete snapshot", async () => {
  const loadSnapshot = async () => ({
    complete: false,
    checkedAt: "2026-09-15T12:00:00Z",
    vehicleCount: 0,
    vehicles: [],
  });

  await assert.rejects(
    verifyDealerKitMissingRegistration("AF71TVY", { loadSnapshot }),
    (error) => {
      assert.match(error.message, /could not prove AF71TVY is absent because the current stock snapshot is incomplete or unstable/i);
      assert.match(error.message, /Nothing was changed in Wix\./);
      return true;
    },
  );
});

test("AF71TVY known registration and stock ID can resolve a DealerKit lifecycle removal after the bulk row vanishes", async () => {
  const result = await verifyDealerKitReservedRegistration("AF71 TVY", {
    supplierStockId: AF71_STOCK_ID,
    now: new Date("2026-09-15T17:00:00Z"),
    loadSnapshot: async () => ({
      complete: false,
      checkedAt: "2026-09-15T17:00:00Z",
      vehicles: [],
    }),
    loadSourceState: async () => ({ available: true, row: historicalAf71State() }),
    loadDetail: async () => {
      throw new Error("DealerKit stock detail failed with HTTP 404.");
    },
  });

  assert.equal(result.registration, "AF71TVY");
  assert.equal(result.supplierStockId, AF71_STOCK_ID);
  assert.equal(result.sourceStatus, "removed_from_dealerkit");
  assert.equal(result.evidence, "historical_identity_detail_404");
  assert.equal(result.previousSourceStatus, "available");
});

test("a vanished registration cannot use a different historical DealerKit stock ID", async () => {
  await assert.rejects(
    verifyDealerKitReservedRegistration("AF71TVY", {
      supplierStockId: AF71_STOCK_ID,
      now: new Date("2026-09-15T17:00:00Z"),
      loadSnapshot: async () => ({ complete: false, vehicles: [] }),
      loadSourceState: async () => ({
        available: true,
        row: historicalAf71State({ supplier_stock_id: "different-stock-id" }),
      }),
      loadDetail: async () => {
        throw new Error("DealerKit stock detail failed with HTTP 404.");
      },
    }),
    /stored DealerKit identity for AF71TVY does not match/i,
  );
});

test("a vanished registration with an unreadable DealerKit detail remains fail closed", async () => {
  await assert.rejects(
    verifyDealerKitReservedRegistration("AF71TVY", {
      supplierStockId: AF71_STOCK_ID,
      now: new Date("2026-09-15T17:00:00Z"),
      loadSnapshot: async () => ({ complete: false, vehicles: [] }),
      loadSourceState: async () => ({ available: true, row: historicalAf71State() }),
      loadDetail: async () => {
        throw new Error("DealerKit stock detail failed with HTTP 500.");
      },
    }),
    (error) => {
      assert.match(error.message, /HTTP 500/i);
      assert.match(error.message, /Nothing was changed in Wix\./);
      return true;
    },
  );
});

test("current available registration wins over an old vanished identity and blocks Wix removal", async () => {
  let detailReads = 0;
  await assert.rejects(
    verifyDealerKitReservedRegistration("AF71TVY", {
      supplierStockId: AF71_STOCK_ID,
      loadSnapshot: async () => ({
        complete: false,
        vehicles: [{
          registration: "AF71 TVY",
          supplierStockId: "replacement-current-id",
          status: "available",
          sourceStatus: "In Stock",
        }],
      }),
      loadSourceState: async () => ({ available: true, row: historicalAf71State() }),
      loadDetail: async () => {
        detailReads += 1;
        throw new Error("DealerKit stock detail failed with HTTP 404.");
      },
    }),
    /currently shows AF71TVY as In Stock, not Reserved\/Sold\/Deposit Taken\/Awaiting Delivery/i,
  );
  assert.equal(detailReads, 0);
});

test("Awaiting Delivery is treated as a positive reserved-like DealerKit lifecycle status", async () => {
  const result = await verifyDealerKitReservedRegistration("AB12 CDE", {
    supplierStockId: "awaiting-delivery-id",
    loadSnapshot: async () => ({
      complete: false,
      vehicles: [{
        registration: "AB12 CDE",
        supplierStockId: "awaiting-delivery-id",
        status: "awaiting_delivery",
        sourceStatus: "Awaiting Delivery",
      }],
    }),
    loadDetail: async () => ({
      registration: "AB12CDE",
      supplierStockId: "awaiting-delivery-id",
      status: "awaiting_delivery",
      sourceStatus: "Awaiting Delivery",
      checkedAt: "2026-09-15T17:00:00Z",
    }),
  });

  assert.equal(result.sourceStatus, "awaiting_delivery");
  assert.equal(result.evidence, "current_registration_and_detail");
});

test("Stock Watch source list keeps lifecycle truth while routing DealerKit removals through Reserved workflow", () => {
  const listSource = fs.readFileSync(new URL("../api/dealerkit-stock-watch-list.js", import.meta.url), "utf8");
  const providerSource = fs.readFileSync(new URL("../api/_stock-source-provider.js", import.meta.url), "utf8");

  assert.match(listSource, /historical_identity_detail_404/);
  assert.match(listSource, /sourceLifecycleStatus: lifecycleStatus/);
  assert.match(listSource, /\["awaiting_delivery", "removed_from_dealerkit"\]\.includes\(lifecycleStatus\)\) return "reserved"/);
  assert.match(listSource, /syncDealerKitSourceState\(supabase, snapshot\)/);
  assert.match(listSource, /loadDealerKitSourceState\(supabase/);
  assert.match(providerSource, /DEALERKIT_SOURCE_STATE_SYNC/);
  assert.match(providerSource, /allowPartial = false/);
});
