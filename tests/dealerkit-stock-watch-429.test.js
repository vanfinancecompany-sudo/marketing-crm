import test from "node:test";
import assert from "node:assert/strict";
import { fetchStableDealerKitStockSnapshot } from "../api/_dealerkit-stable-stock-snapshot.js";

const environment = { DEALERKIT_API_SECRET: "test-secret", DEALERKIT_DEALER_ID: "70376" };
const listing = (id, registration) => ({ id, status: "In Stock", vehicle: { registration, type: "LCV" } });

function response(status, payload, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter : null },
    async text() { return JSON.stringify(payload); },
  };
}

function completeStock() {
  return response(200, {
    data: [listing("stock-1", "AB12CDE")],
    meta: { total: 1, current_page: 1, last_page: 1, per_page: 100 },
  });
}

test("a first-page 429 receives one bounded backoff and then returns complete stock", async () => {
  let calls = 0;
  const delays = [];
  const snapshot = await fetchStableDealerKitStockSnapshot({
    environment,
    fetchImplementation: async () => ++calls === 1 ? response(429, { message: "Rate limited" }) : completeStock(),
    sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [750]);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 1);
  assert.equal(snapshot.diagnostics.stability.attemptsUsed, 2);
});

test("Retry-After seconds controls the 429 delay", async () => {
  let calls = 0;
  const delays = [];
  await fetchStableDealerKitStockSnapshot({
    environment,
    fetchImplementation: async () => ++calls === 1 ? response(429, {}, "2") : completeStock(),
    sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test("exhausted 429 retries fail cleanly without a false empty snapshot", async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(fetchStableDealerKitStockSnapshot({
    environment,
    allowPartial: true,
    fetchImplementation: async () => { calls += 1; return response(429, {}, null); },
    sleep: async (ms) => { delays.push(ms); },
  }), (error) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /after 3 bounded attempt/);
    assert.equal(error.diagnostics.stability.attemptsUsed, 3);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [750, 1500]);
});

test("a later-page 429 aborts bulk recovery instead of fanning out single-item reads", async () => {
  const requests = [];
  await assert.rejects(fetchStableDealerKitStockSnapshot({
    environment,
    stabilityAttempts: 1,
    perPage: 1,
    fetchImplementation: async (url) => {
      const query = new URL(String(url)).searchParams;
      requests.push(`${query.get("page")}/${query.get("per_page")}`);
      if (query.get("page") === "1") return response(200, {
        data: [listing("stock-1", "AB12CDE")],
        meta: { total: 2, current_page: 1, last_page: 2, per_page: 1 },
      });
      return response(429, {}, "1");
    },
    sleep: async () => { throw new Error("Single-attempt monitor read must not retry."); },
  }), (error) => error.status === 429);
  assert.deepEqual(requests, ["1/1", "2/1"]);
});

test("an unrelated HTTP 400 page-1 error is not retried", async () => {
  let calls = 0;
  await assert.rejects(fetchStableDealerKitStockSnapshot({
    environment,
    fetchImplementation: async () => { calls += 1; return response(400, {}); },
    sleep: async () => { throw new Error("Unexpected backoff"); },
  }), /HTTP 400/);
  assert.equal(calls, 1);
});
