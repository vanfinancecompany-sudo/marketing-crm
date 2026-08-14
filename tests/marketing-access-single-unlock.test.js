import test from "node:test";
import assert from "node:assert/strict";
import {
  clearMarketingAccessKey,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";

test("Marketing access validation coalesces concurrent checks and caches the valid key", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, "/api/marketing-campaigns");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-marketing-customer-database-key"], "single-unlock-key");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true }; },
    };
  };

  try {
    clearMarketingAccessKey();
    await Promise.all([
      validateMarketingAccessKey("single-unlock-key"),
      validateMarketingAccessKey("single-unlock-key"),
      validateMarketingAccessKey("single-unlock-key"),
    ]);
    assert.equal(calls, 1);

    await validateMarketingAccessKey("single-unlock-key");
    assert.equal(calls, 1);

    clearMarketingAccessKey();
    await validateMarketingAccessKey("single-unlock-key");
    assert.equal(calls, 2);
  } finally {
    clearMarketingAccessKey();
    globalThis.fetch = originalFetch;
  }
});

test("Marketing access validation does not cache a rejected key", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 401,
      async json() { return { error: "Unauthorized" }; },
    };
  };

  try {
    clearMarketingAccessKey();
    await assert.rejects(() => validateMarketingAccessKey("bad-key"), /Unauthorized|Access key/i);
    await assert.rejects(() => validateMarketingAccessKey("bad-key"), /Unauthorized|Access key/i);
    assert.equal(calls, 2);
  } finally {
    clearMarketingAccessKey();
    globalThis.fetch = originalFetch;
  }
});
