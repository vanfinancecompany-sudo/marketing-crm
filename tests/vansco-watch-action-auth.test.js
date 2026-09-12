import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  handleVanscoWatchAction,
  isMarketingStockWatchActionAuthorized,
} from "../api/vansco-watch-action.js";

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

const environment = { MARKETING_CUSTOMER_DATABASE_API_KEY: "existing-marketing-key" };

test("unauthenticated Stock Watch decision writes and deletes return 401 before Supabase", async () => {
  for (const workflowStatus of ["ignored", "new"]) {
    let supabaseCalls = 0;
    const response = responseCapture();
    await handleVanscoWatchAction(
      { method: "POST", headers: {}, body: { pipeline: "finance", workflowStatus, record: { registration: "LC72YEG" } } },
      response,
      { environment, getSupabase: () => { supabaseCalls += 1; throw new Error("must not be called"); } },
    );
    assert.equal(response.statusCode, 401);
    assert.match(response.body.message, /Marketing CRM access is required/i);
    assert.equal(supabaseCalls, 0);
  }
});

test("existing Marketing header and Bearer conventions authenticate Stock Watch actions", () => {
  assert.equal(isMarketingStockWatchActionAuthorized({ headers: { "x-marketing-customer-database-key": "existing-marketing-key" } }, environment), true);
  assert.equal(isMarketingStockWatchActionAuthorized({ headers: { authorization: "Bearer existing-marketing-key" } }, environment), true);
  assert.equal(isMarketingStockWatchActionAuthorized({ headers: { authorization: "Bearer wrong-key" } }, environment), false);
});

test("Stock Watch browser decisions use the existing Marketing access header builder", () => {
  const source = fs.readFileSync(new URL("../services/vanscoStockCache.js", import.meta.url), "utf8");
  assert.match(source, /import \{ buildMarketingAccessHeaders \} from "\.\/marketingAccess\.js"/);
  assert.match(source, /fetch\("\/api\/vansco-watch-action", \{[\s\S]*?headers: buildMarketingAccessHeaders\(/);
});

test("authenticated existing Marketing CRM reset requests still reach the Supabase operation", async () => {
  let deleteCalls = 0;
  const query = {
    delete() { deleteCalls += 1; return this; },
    eq() { return this; },
    select() { return Promise.resolve({ data: [], error: null }); },
  };
  const response = responseCapture();
  await handleVanscoWatchAction(
    {
      method: "POST",
      headers: { "x-marketing-customer-database-key": "existing-marketing-key" },
      body: { pipeline: "finance", workflowStatus: "new", record: { registration: "LC72YEG" } },
    },
    response,
    { environment, getSupabase: () => ({ from: () => query }) },
  );

  assert.equal(deleteCalls, 1);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.record.workflowStatus, "new");
});
