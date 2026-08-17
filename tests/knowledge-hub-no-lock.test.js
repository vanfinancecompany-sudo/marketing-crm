import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_HUB_NO_LOCK_KEY,
  getStoredMarketingAccessKey,
  installKnowledgeHubNoLockFetch,
  rewriteKnowledgeHubApiUrl,
  validateMarketingAccessKey,
} from "../services/marketingAccess.js";
import { withKnowledgeHubNoLock } from "../lib/knowledgeHubNoLock.js";

function makeStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem(key) { return values.get(key) || ""; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("Knowledge Hub does not require the Customer Database access key", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.window = { location: { pathname: "/knowledge-hub" } };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("no-lock validation should not call the protected validation endpoint");
  };

  try {
    assert.equal(getStoredMarketingAccessKey(), KNOWLEDGE_HUB_NO_LOCK_KEY);
    assert.equal(await validateMarketingAccessKey(KNOWLEDGE_HUB_NO_LOCK_KEY), true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Knowledge Hub protected API paths are rewritten only on the Knowledge Hub route", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { location: { pathname: "/knowledge-hub" } };
    assert.equal(rewriteKnowledgeHubApiUrl("/api/marketing-knowledge-hub"), "/api/knowledge-hub-ui");
    assert.equal(rewriteKnowledgeHubApiUrl("/api/marketing-editorial-engine?mode=load"), "/api/knowledge-hub-ui-editorial-engine?mode=load");
    assert.equal(rewriteKnowledgeHubApiUrl("/api/marketing-wix-publishing"), "/api/knowledge-hub-ui-wix-publishing");

    globalThis.window.location.pathname = "/customer-database";
    assert.equal(rewriteKnowledgeHubApiUrl("/api/marketing-knowledge-hub"), "/api/marketing-knowledge-hub");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Customer Database route still reads its stored access key", () => {
  const originalWindow = globalThis.window;
  const storage = makeStorage([["marketingCustomerDatabaseApiKey", "customer-database-key"]]);
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

test("Knowledge Hub wrapper injects server key without exposing it to the browser", async () => {
  const originalKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "server-only-key";
  let seenHeader = "";
  let statusCode = 0;
  let payload = null;

  const wrapped = withKnowledgeHubNoLock(async (request, response) => {
    seenHeader = request.headers["x-marketing-customer-database-key"];
    response.status(200).json({ ok: true });
  });

  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };

  try {
    await wrapped({ headers: {} }, response);
    assert.equal(seenHeader, "server-only-key");
    assert.equal(statusCode, 200);
    assert.deepEqual(payload, { ok: true });
  } finally {
    if (originalKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalKey;
  }
});
