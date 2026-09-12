import test from "node:test";
import assert from "node:assert/strict";
import publishedPriceHandler from "../api/dealerkit-published-price.js";
import { buildDealerKitCarWixPlan } from "../lib/dealerKitCarWixPlan.js";

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("controlled Wix price preview fails closed without exact DealerKit stock identity", async () => {
  const previous = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "audit-test-key";
  try {
    const response = responseCapture();
    await publishedPriceHandler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "audit-test-key" },
      body: {
        action: "preview",
        pipeline: "cars",
        registration: "LC72YEG",
        retail_price: 19995,
      },
    }, response);
    assert.equal(response.statusCode, 409);
    assert.match(String(response.body?.message || ""), /DealerKit stock identity is missing/i);
  } finally {
    if (previous === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = previous;
  }
});

test("Cars controlled publish treats a missing reviewed DealerKit source version as stale", () => {
  const plan = buildDealerKitCarWixPlan({
    vehicle: {
      registration: "LC72YEG",
      retailPrice: 19995,
      status: "Available",
      sourceUpdatedAt: "2026-09-12T07:00:00.000Z",
    },
    decision: {
      persisted: true,
      reviewStatus: "reviewed",
      reviewedSourceUpdatedAt: null,
    },
    imageSet: {
      ready: true,
      mainUrl: "https://static.wixstatic.com/media/car-main.jpg",
      galleryUrls: ["https://static.wixstatic.com/media/car-main.jpg"],
    },
    carListingRows: [],
    carDetailRows: [],
  });

  assert.equal(plan.canPublish, false);
  assert.equal(plan.blockers.some((blocker) => blocker.code === "stale_review"), true);
});
