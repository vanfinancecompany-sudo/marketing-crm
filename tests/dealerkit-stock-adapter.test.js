import test from "node:test";
import assert from "node:assert/strict";
import {
  DealerKitSnapshotIncompleteError,
  fetchDealerKitStockSnapshot,
  mapDealerKitListing,
} from "../api/_dealerkit-stock-adapter.js";

const ENV = {
  DEALERKIT_API_SECRET: "test-secret",
  DEALERKIT_DEALER_ID: "70376",
};

function listing({ id = "stock-1", registration = "HT22 KJX", status = "In Stock", price = 12495 } = {}) {
  return {
    id,
    status,
    vehicle: {
      registration,
      type: "LCV",
      manufacturer: "Ford",
      model: "Transit Custom",
      derivative: "2.0 300 EcoBlue Limited Panel Van L2 H1",
      trim: "Limited",
      body_type: "Panel Van",
      mileage: 93000,
      year: 2022,
      registration_date: "2022-07-06",
      fuel_type: "Diesel",
      transmission_type: "Manual",
      manufacturer_colour: "Magnetic",
      ulez_compliant: true,
      bhp: 128,
      torque_nm: 361,
      mot_expiry: "2027-07-10",
      insurance_group: "39E",
      specifications: {
        standard: { items: [{ name: "Air Conditioning" }] },
        options: { items: [{ name: "Metallic paint" }] },
        technical: { items: [{ name: "BHP", value: "128" }] },
      },
    },
    prices: {
      advertised: { amount: price, vat_status: "ex-VAT" },
      cash: { amount: 14994, vat_amount: "2499.00" },
      monthly: { amount: 292.38, examples: [{}] },
    },
    advertising: {
      comments: "Dealer description",
      attention_grabber: "Great van",
    },
    media: {
      cover_image: null,
      images: [
        { id: "image-1", url: "https://images.example/1.jpg" },
        { id: "image-2", url: "https://images.example/2.jpg" },
      ],
    },
    links: { website: "https://www.vansco.co.uk/example" },
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-10T10:00:00Z",
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

test("maps the known DealerKit vehicle shape into the neutral stock record", () => {
  const mapped = mapDealerKitListing(listing());
  assert.equal(mapped.providerId, "dealerkit");
  assert.equal(mapped.supplierStockId, "stock-1");
  assert.equal(mapped.registration, "HT22KJX");
  assert.equal(mapped.status, "available");
  assert.equal(mapped.retailPrice, 12495);
  assert.equal(mapped.sourceVatStatus, "ex-VAT");
  assert.equal(mapped.vatStatus, "plus_vat");
  assert.equal(mapped.mileage, 93000);
  assert.equal(mapped.year, 2022);
  assert.equal(mapped.fuel, "Diesel");
  assert.equal(mapped.transmission, "Manual");
  assert.equal(mapped.imageCount, 2);
  assert.deepEqual(mapped.primaryImage, { id: "image-1", url: "https://images.example/1.jpg", order: 0 });
  assert.equal(mapped.specifications.standard.length, 1);
  assert.equal(mapped.specifications.options.length, 1);
  assert.equal(mapped.specifications.technical.length, 1);
  assert.equal(mapped.dealerMonthlyPrice, 292.38);
});

test("normalizes DealerKit operational statuses without changing the source wording", () => {
  assert.equal(mapDealerKitListing(listing({ status: "Due In" })).status, "due_in");
  assert.equal(mapDealerKitListing(listing({ status: "Reserved" })).status, "reserved");
  assert.equal(mapDealerKitListing(listing({ status: "Awaiting Delivery" })).status, "awaiting_delivery");
  assert.equal(mapDealerKitListing(listing({ status: "Sold" })).status, "sold");
  assert.equal(mapDealerKitListing(listing({ status: "Non-Stock" })).status, "non_stock");
  assert.equal(mapDealerKitListing(listing({ status: "Reserved" })).sourceStatus, "Reserved");
});

test("returns a complete DealerKit stock snapshot when every reported record is readable", async () => {
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));
    assert.equal(perPage, 2);
    if (page === 1) {
      return response(200, {
        data: [listing({ id: "1", registration: "AA11AAA" }), listing({ id: "2", registration: "BB22BBB" })],
        meta: { total: 3, current_page: 1, last_page: 2, per_page: 2 },
      });
    }
    return response(200, {
      data: [listing({ id: "3", registration: "CC33CCC" })],
      meta: { total: 3, current_page: 2, last_page: 2, per_page: 2 },
    });
  };

  const snapshot = await fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 2 });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.apiReportedTotal, 3);
  assert.equal(snapshot.vehicleCount, 3);
  assert.equal(snapshot.refresh.failed, 0);
});

test("recovers an unexpectedly short successful page before accepting a snapshot", async () => {
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (perPage === 2 && page === 1) {
      return response(200, {
        data: [listing({ id: "1", registration: "AA11AAA" }), listing({ id: "2", registration: "BB22BBB" })],
        meta: { total: 4, current_page: 1, last_page: 2, per_page: 2 },
      });
    }
    if (perPage === 2 && page === 2) {
      return response(200, {
        data: [listing({ id: "3", registration: "CC33CCC" })],
        meta: { total: 4, current_page: 2, last_page: 2, per_page: 2 },
      });
    }
    if (perPage === 1 && page === 3) {
      return response(200, {
        data: [listing({ id: "3", registration: "CC33CCC" })],
        meta: { total: 4, current_page: 3, last_page: 4, per_page: 1 },
      });
    }
    if (perPage === 1 && page === 4) {
      return response(200, {
        data: [listing({ id: "4", registration: "DD44DDD" })],
        meta: { total: 4, current_page: 4, last_page: 4, per_page: 1 },
      });
    }
    throw new Error(`Unexpected request ${url.toString()}`);
  };

  const snapshot = await fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 2 });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 4);
  assert.equal(snapshot.refresh.failed, 0);
  assert.equal(snapshot.diagnostics.failedPages.length, 1);
  assert.equal(snapshot.diagnostics.failedPages[0].reason, "unexpected_page_count");
  assert.equal(snapshot.diagnostics.pageCounts[1].recovered, true);
});

test("recovers readable records from a failed page but refuses an incomplete authoritative snapshot", async () => {
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (perPage === 2 && page === 1) {
      return response(200, {
        data: [listing({ id: "1", registration: "AA11AAA" }), listing({ id: "2", registration: "BB22BBB" })],
        meta: { total: 4, current_page: 1, last_page: 2, per_page: 2 },
      });
    }
    if (perPage === 2 && page === 2) return response(500, { message: "Server error" });
    if (perPage === 1 && page === 3) {
      return response(200, {
        data: [listing({ id: "3", registration: "CC33CCC" })],
        meta: { total: 4, current_page: 3, last_page: 4, per_page: 1 },
      });
    }
    if (perPage === 1 && page === 4) return response(500, { message: "Broken stock row" });
    throw new Error(`Unexpected request ${url.toString()}`);
  };

  await assert.rejects(
    fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 2 }),
    (error) => {
      assert.ok(error instanceof DealerKitSnapshotIncompleteError);
      assert.equal(error.diagnostics.apiReportedTotal, 4);
      assert.equal(error.diagnostics.recordsFetched, 3);
      assert.equal(error.diagnostics.failedPositions.length, 1);
      return true;
    },
  );

  const partial = await fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 2, allowPartial: true });
  assert.equal(partial.complete, false);
  assert.equal(partial.vehicleCount, 3);
  assert.equal(partial.refresh.failed, 1);
  assert.equal(partial.refresh.remaining, 1);
});

test("recovers an incomplete list row from its stable DealerKit stock detail", async () => {
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/stock/row-1")) {
      return response(200, { data: listing({ id: "row-1", registration: "EE55EEE" }) });
    }
    return response(200, {
      data: [listing({ id: "row-1", registration: "" })],
      meta: { total: 1, current_page: 1, last_page: 1, per_page: 1 },
    });
  };

  const snapshot = await fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 1 });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 1);
  assert.equal(snapshot.vehicles[0].registration, "EE55EEE");
  assert.equal(snapshot.diagnostics.detailRecoveries.length, 1);
  assert.equal(snapshot.diagnostics.invalidRecords.length, 0);
});

test("invalid source rows are diagnostic-only and block authoritative cutover when detail cannot recover them", async () => {
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/stock/1")) return response(200, { data: listing({ id: "1", registration: "" }) });
    return response(200, {
      data: [listing({ id: "1", registration: "" })],
      meta: { total: 1, current_page: 1, last_page: 1, per_page: 1 },
    });
  };

  const partial = await fetchDealerKitStockSnapshot({ environment: ENV, fetchImplementation, perPage: 1, allowPartial: true });
  assert.equal(partial.complete, false);
  assert.equal(partial.vehicleCount, 0);
  assert.equal(partial.diagnostics.invalidRecords.length, 1);
  assert.equal(partial.diagnostics.invalidRecords[0].registrationPresent, false);
  assert.equal(partial.refresh.failed, 1);
});

test("requires server-side DealerKit credentials and never accepts a credential-free source", async () => {
  await assert.rejects(
    fetchDealerKitStockSnapshot({ environment: {}, fetchImplementation: async () => response(200, {}) }),
    /DEALERKIT_API_SECRET/,
  );
});
