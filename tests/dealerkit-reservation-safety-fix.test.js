import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyDealerKitReservedRegistration } from "../api/_dealerkit-reservation-verification.js";

const environment = {
  DEALERKIT_API_SECRET: "test-secret",
  DEALERKIT_DEALER_ID: "dealer-1",
};

function dealerKitListing({ registration = "LC72YEG", status = "Reserved", id = "stock-1" } = {}) {
  return {
    id,
    status,
    vehicle: {
      registration,
      manufacturer: "Ford",
      model: "Transit Custom",
      derivative: "2.0 320 EcoBlue Limited Crew Van",
      type: "Van",
    },
    prices: { advertised: { amount: 19995, vat_status: "ex-vat" } },
    media: { images: [] },
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function fetchFor({ listStatus = "Reserved", detailStatus = "Reserved", detailRegistration = "LC72YEG" } = {}) {
  const calls = [];
  const fetchImplementation = async (url) => {
    const parsed = new URL(String(url));
    calls.push(parsed.toString());
    if (parsed.pathname.endsWith("/integrators/stock/stock-1")) {
      return response({ data: dealerKitListing({ registration: detailRegistration, status: detailStatus }) });
    }
    return response({
      data: [dealerKitListing({ status: listStatus })],
      meta: { total: 1, current_page: 1, last_page: 1, per_page: 100 },
    });
  };
  return { calls, fetchImplementation };
}

test("reserved Wix safety check re-verifies the exact vehicle from DealerKit detail", async () => {
  const fake = fetchFor();
  const result = await verifyDealerKitReservedRegistration("LC72 YEG", {
    environment,
    fetchImplementation: fake.fetchImplementation,
  });

  assert.equal(result.providerId, "dealerkit");
  assert.equal(result.registration, "LC72YEG");
  assert.equal(result.supplierStockId, "stock-1");
  assert.equal(result.sourceStatus, "reserved");
  assert.equal(fake.calls.some((url) => url.includes("/integrators/stock/stock-1")), true);
});

test("reservation action fails closed when DealerKit detail is no longer reserved", async () => {
  const fake = fetchFor({ detailStatus: "Available" });
  await assert.rejects(
    () => verifyDealerKitReservedRegistration("LC72YEG", {
      environment,
      fetchImplementation: fake.fetchImplementation,
    }),
    /Safety stop: DealerKit no longer shows LC72YEG as Reserved\/Sold\/Deposit Taken\. Nothing was changed in Wix\./,
  );
});

test("reservation action fails closed if DealerKit stock ID returns another registration", async () => {
  const fake = fetchFor({ detailRegistration: "AB12CDE" });
  await assert.rejects(
    () => verifyDealerKitReservedRegistration("LC72YEG", {
      environment,
      fetchImplementation: fake.fetchImplementation,
    }),
    /returned registration AB12CDE instead of LC72YEG.*Nothing was changed in Wix/,
  );
});

test("build transform replaces the old Vansco reservation guard for all three product lanes", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-dealerkit-reservation-safety-fix.mjs", import.meta.url), "utf8");
  assert.match(source, /finance-reserved-wix-stock\.js/);
  assert.match(source, /car-reserved-wix-stock\.js/);
  assert.match(source, /rent2buy-reserved-wix-stock\.js/);
  assert.match(source, /verifyDealerKitReservedRegistration/);
  assert.match(source, /legacy Vansco reservation guard/);
});
