import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKETING_CENTRE_NO_LOCK_KEY,
  getStoredMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";
import { validateMarketingCampaignAccess } from "../services/marketingCampaigns.js";
import { previewVanscoWixPrice } from "../services/vanscoWixPrice.js";
import { withMarketingCentreNoLock } from "../lib/marketingCentreNoLock.js";

test("Marketing Centre does not require the Customer Database access key", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.window = {
    location: { pathname: "/marketing-centre" },
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("validateMarketingAccessKey should not fetch for Marketing Centre no-lock access");
  };

  try {
    assert.equal(getStoredMarketingAccessKey(), MARKETING_CENTRE_NO_LOCK_KEY);
    assert.equal(await validateMarketingAccessKey(MARKETING_CENTRE_NO_LOCK_KEY), true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Marketing Centre campaign service uses the dedicated no-lock server route", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.window = {
    location: { pathname: "/marketing-centre" },
  };
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true }; },
    };
  };

  try {
    await validateMarketingCampaignAccess();
    assert.equal(requestedUrl, "/api/marketing-centre-campaigns");
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Stock Watch Wix price service uses the Marketing Centre no-lock route", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody = null;

  globalThis.window = {
    location: { pathname: "/marketing-centre" },
  };
  globalThis.fetch = async (url, options = {}) => {
    requestedUrl = url;
    requestedBody = JSON.parse(options.body || "{}");
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, preview: {} }; },
    };
  };

  try {
    await previewVanscoWixPrice({ registration: "HJ68KXF", retailPrice: 7995 });
    assert.equal(requestedUrl, "/api/marketing-centre-vansco-wix-price");
    assert.equal(requestedBody.action, "preview");
    assert.equal(requestedBody.pipeline, "finance");
    assert.equal(requestedBody.registration, "HJ68KXF");
    assert.equal(requestedBody.retail_price, 7995);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Customer Database route still uses stored-key access behavior", () => {
  const originalWindow = globalThis.window;
  const values = new Map([["marketingCustomerDatabaseApiKey", "customer-database-key"]]);
  const storage = {
    getItem(key) { return values.get(key) || ""; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };

  globalThis.window = {
    location: { pathname: "/customer-database" },
    localStorage: storage,
    sessionStorage: storage,
  };

  try {
    assert.equal(getStoredMarketingAccessKey(), "customer-database-key");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Marketing Centre server wrapper injects the existing server key only for wrapped handlers", async () => {
  const originalKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "server-only-key";

  let seenHeader = "";
  const wrapped = withMarketingCentreNoLock(async (request, response) => {
    seenHeader = request.headers["x-marketing-customer-database-key"];
    response.status(200).json({ ok: true });
  });
  const request = { headers: {} };
  let statusCode = 0;
  let payload = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };

  try {
    await wrapped(request, response);
    assert.equal(seenHeader, "server-only-key");
    assert.equal(statusCode, 200);
    assert.deepEqual(payload, { ok: true });
  } finally {
    if (originalKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalKey;
  }
});
