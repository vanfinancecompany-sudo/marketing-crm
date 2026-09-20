import test from "node:test";
import assert from "node:assert/strict";
import { resolveRecentDealerKitTransitions } from "../api/dealerkit-stock-watch-list.js";

const AF71_STOCK_ID = "c500e0856a9b0c7db4be7";

function sourceStateSupabase(rows) {
  return {
    from() {
      return {
        select() {
          return {
            gte() {
              return {
                order() {
                  return {
                    async limit() {
                      return { data: rows, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function historicalAf71() {
  return {
    registration: "AF71TVY",
    supplier_stock_id: AF71_STOCK_ID,
    last_status: "available",
    source_status: "In Stock",
    title: "Ford Transit 2.0 350 EcoBlue MHEV Limited Panel Van",
    source_url: "",
    image_url: "",
    source_updated_at: "2026-09-15T13:15:00Z",
    first_seen_at: "2026-09-12T15:30:00Z",
    last_seen_at: "2026-09-15T13:15:00Z",
    updated_at: "2026-09-15T13:15:00Z",
    vehicle_snapshot: {
      registration: "AF71TVY",
      supplierStockId: AF71_STOCK_ID,
      status: "available",
      sourceStatus: "In Stock",
      vehicleType: "LCV",
      bodyType: "Panel Van",
      make: "Ford",
      model: "Transit",
      title: "Ford Transit 2.0 350 EcoBlue MHEV Limited Panel Van",
    },
  };
}

test("AF71TVY becomes a removed lifecycle record when its known DealerKit ID returns 404", async () => {
  const result = await resolveRecentDealerKitTransitions({
    supabase: sourceStateSupabase([historicalAf71()]),
    snapshot: { vehicles: [] },
    pipeline: "finance",
    loadDetail: async () => {
      throw new Error("DealerKit stock detail failed with HTTP 404.");
    },
  });

  assert.equal(result.candidates, 1);
  assert.equal(result.detailErrors, 0);
  assert.equal(result.unresolved, 0);
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].registration, "AF71TVY");
  assert.equal(result.vehicles[0].status, "removed_from_dealerkit");
  assert.equal(result.vehicles[0].sourceResolution, "historical_identity_detail_404");
});

test("a vanished known registration is retained as source_unresolved instead of silently disappearing on DealerKit 500", async () => {
  let attempts = 0;
  const result = await resolveRecentDealerKitTransitions({
    supabase: sourceStateSupabase([historicalAf71()]),
    snapshot: { vehicles: [] },
    pipeline: "finance",
    loadDetail: async () => {
      attempts += 1;
      throw new Error("DealerKit stock detail failed with HTTP 500.");
    },
  });

  assert.equal(attempts, 2, "the Stock Watch wrapper makes two bounded probes; the real DealerKit adapter already retries transient HTTP failures three times internally");
  assert.equal(result.candidates, 1);
  assert.equal(result.detailErrors, 1);
  assert.equal(result.unresolved, 1);
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].registration, "AF71TVY");
  assert.equal(result.vehicles[0].status, "source_unresolved");
  assert.equal(result.vehicles[0].sourceResolution, "historical_identity_detail_error");
  assert.match(result.vehicles[0].sourceResolutionError, /HTTP 500/i);
});
