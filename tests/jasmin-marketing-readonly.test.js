import assert from "node:assert/strict";
import test from "node:test";
import {
  createJasminMarketingReadonlyHandler,
  isJasminMarketingAuthorised,
  parseJasminMarketingRequest,
} from "../api/jasmin-readonly.js";

function responseHarness() {
  const state = { status: 200, body: undefined, ended: false, headers: {} };
  return {
    state,
    response: {
      setHeader(name, value) { state.headers[name] = value; },
      status(value) { state.status = value; return this; },
      json(value) { state.body = value; return this; },
      end() { state.ended = true; return this; },
    },
  };
}

const environment = { JASMIN_MARKETING_API_KEY: "jasmin-dedicated-key-123" };

function request(method = "GET", options = {}) {
  return {
    method,
    url: options.url || "/api/jasmin-readonly",
    query: options.query,
    headers: options.headers || {},
  };
}

test("Jasmin Marketing CRM auth accepts only the dedicated key or bearer", () => {
  assert.equal(isJasminMarketingAuthorised(request("GET", { headers: { "x-jasmin-marketing-key": environment.JASMIN_MARKETING_API_KEY } }), environment), true);
  assert.equal(isJasminMarketingAuthorised(request("GET", { headers: { authorization: `Bearer ${environment.JASMIN_MARKETING_API_KEY}` } }), environment), true);
  assert.equal(isJasminMarketingAuthorised(request("GET", { headers: { "x-marketing-customer-database-key": environment.JASMIN_MARKETING_API_KEY } }), environment), false);
  assert.equal(isJasminMarketingAuthorised(request("GET", { headers: { "x-jasmin-marketing-key": "wrong" } }), environment), false);
  assert.equal(isJasminMarketingAuthorised(request(), {}), false);
});

test("request parsing expands summary and bounds search/detail results", () => {
  const parsed = parseJasminMarketingRequest(request("GET", {
    query: { section: "summary", q: "Rent2Buy", limit: "999" },
  }));
  assert.deepEqual(parsed.sections, ["contacts", "stock", "campaigns", "email", "content", "knowledge", "visibility", "vansco"]);
  assert.equal(parsed.q, "Rent2Buy");
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.detail, true);
});

test("unsupported sections are rejected before any data access", () => {
  assert.throws(
    () => parseJasminMarketingRequest(request("GET", { query: { section: "delete-everything" } })),
    /Unsupported Marketing CRM section/,
  );
});

test("OPTIONS is allowed but all non-GET mutations are refused", async () => {
  let calls = 0;
  const handler = createJasminMarketingReadonlyHandler({
    environment,
    loadSnapshot: async () => { calls += 1; return {}; },
  });

  const optionsHarness = responseHarness();
  await handler(request("OPTIONS"), optionsHarness.response);
  assert.equal(optionsHarness.state.status, 204);
  assert.equal(optionsHarness.state.ended, true);

  const postHarness = responseHarness();
  await handler(request("POST", { headers: { "x-jasmin-marketing-key": environment.JASMIN_MARKETING_API_KEY } }), postHarness.response);
  assert.equal(postHarness.state.status, 405);
  assert.equal(postHarness.state.body.readOnly, true);
  assert.match(postHarness.state.body.message, /read-only/i);
  assert.equal(calls, 0);
});

test("GET requires Jasmin's dedicated key", async () => {
  let calls = 0;
  const handler = createJasminMarketingReadonlyHandler({
    environment,
    loadSnapshot: async () => { calls += 1; return {}; },
  });
  const harness = responseHarness();
  await handler(request("GET", { headers: { "x-marketing-customer-database-key": environment.JASMIN_MARKETING_API_KEY } }), harness.response);
  assert.equal(harness.state.status, 401);
  assert.equal(harness.state.body.readOnly, true);
  assert.equal(calls, 0);
});

test("authorised GET returns a read-only snapshot and passes bounded options", async () => {
  let received;
  const handler = createJasminMarketingReadonlyHandler({
    environment,
    loadSnapshot: async (options) => {
      received = options;
      return {
        success: true,
        readOnly: true,
        system: "Marketing CRM",
        snapshotAt: "2026-08-10T17:00:00.000Z",
        sections: { stock: { available: true, counts: { finance: 200 } } },
        safeguards: {
          dedicatedKey: true,
          mutationsExposed: false,
          productionSendExposed: false,
          publishingExposed: false,
          secretsReturned: false,
        },
      };
    },
  });
  const harness = responseHarness();
  await handler(request("GET", {
    query: { section: "stock", q: "transit", limit: "20" },
    headers: { "x-jasmin-marketing-key": environment.JASMIN_MARKETING_API_KEY },
  }), harness.response);

  assert.equal(harness.state.status, 200);
  assert.equal(harness.state.body.success, true);
  assert.equal(harness.state.body.readOnly, true);
  assert.equal(harness.state.body.safeguards.mutationsExposed, false);
  assert.equal(harness.state.body.safeguards.productionSendExposed, false);
  assert.deepEqual(received.sections, ["stock"]);
  assert.equal(received.q, "transit");
  assert.equal(received.limit, 20);
  assert.equal(received.detail, true);
});

test("invalid query returns 400 and does not invoke the data loader", async () => {
  let calls = 0;
  const handler = createJasminMarketingReadonlyHandler({
    environment,
    loadSnapshot: async () => { calls += 1; return {}; },
  });
  const harness = responseHarness();
  await handler(request("GET", {
    query: { sections: "stock,send-production-email" },
    headers: { "x-jasmin-marketing-key": environment.JASMIN_MARKETING_API_KEY },
  }), harness.response);
  assert.equal(harness.state.status, 400);
  assert.equal(harness.state.body.readOnly, true);
  assert.equal(calls, 0);
});
