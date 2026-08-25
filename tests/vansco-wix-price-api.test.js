import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/vansco-wix-price.js";

function appRequest(body) {
  return {
    method: "POST",
    headers: { "x-marketing-customer-database-key": "test-key" },
    body,
  };
}

function appResponse() {
  let statusCode = 200;
  let payload = null;
  return {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; },
    snapshot() { return { statusCode, payload }; },
  };
}

function wixResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function wixItemFor(collectionId) {
  if (collectionId === "VANFINANCE-ALLVANS") {
    return { id: "all-item", data: { title: "LA23FHK", price: "£10,995", salePrice: "FROM £230 P/M" } };
  }
  if (collectionId === "VANFINANCEPAGES") {
    return { id: "page-item", data: { title: "LA23FHK", priceVat: "£10,995 +VAT", mthPrice: "£230" } };
  }
  return null;
}

async function withWixMock(run) {
  const oldFetch = global.fetch;
  const oldApiKey = process.env.WIX_API_KEY;
  const oldSiteId = process.env.WIX_SITE_ID;
  const oldAccessKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const calls = [];
  process.env.WIX_API_KEY = "wix-test-key";
  process.env.WIX_SITE_ID = "wix-test-site";
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "test-key";
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method || "GET", body });
    if (String(url).endsWith("/wix-data/v2/items/query")) {
      const item = wixItemFor(body?.dataCollectionId);
      return wixResponse({ dataItems: item ? [item] : [] });
    }
    if (options.method === "PATCH") return wixResponse({ dataItem: { id: body?.patch?.dataItemId } });
    return wixResponse({ message: "Unexpected test request" }, 500);
  };
  try {
    return await run(calls);
  } finally {
    global.fetch = oldFetch;
    if (oldApiKey === undefined) delete process.env.WIX_API_KEY; else process.env.WIX_API_KEY = oldApiKey;
    if (oldSiteId === undefined) delete process.env.WIX_SITE_ID; else process.env.WIX_SITE_ID = oldSiteId;
    if (oldAccessKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY; else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = oldAccessKey;
  }
}

test("preview queries the finance allowlist but never patches Wix", async () => {
  await withWixMock(async (calls) => {
    const response = appResponse();
    await handler(appRequest({ action: "preview", pipeline: "finance", registration: "LA23 FHK", retail_price: 9995 }), response);
    const result = response.snapshot();
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.preview.registration, "LA23FHK");
    assert.equal(result.payload.preview.monthly_price, 209);
    assert.equal(result.payload.preview.match_count, 2);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
    assert.equal(calls.filter((call) => call.url.endsWith("/wix-data/v2/items/query")).length, 10);
  });
});

test("update rechecks the preview then patches only matched price fields", async () => {
  await withWixMock(async (calls) => {
    const previewResponse = appResponse();
    await handler(appRequest({ action: "preview", pipeline: "finance", registration: "LA23FHK", retail_price: 9995 }), previewResponse);
    const confirmation = previewResponse.snapshot().payload.preview;
    calls.length = 0;

    const updateResponse = appResponse();
    await handler(appRequest({ action: "update", pipeline: "finance", registration: "LA23FHK", retail_price: 9995, confirmation }), updateResponse);
    const result = updateResponse.snapshot();
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.updated.updated_count, 2);

    const patches = calls.filter((call) => call.method === "PATCH");
    assert.equal(patches.length, 2);
    assert.deepEqual(patches[0].body.patch.fieldModifications.map((field) => [field.fieldPath, field.setFieldOptions.value]), [
      ["price", "£9,995 [Was £10,995]"],
      ["salePrice", "FROM £209 P/M"],
    ]);
    assert.deepEqual(patches[1].body.patch.fieldModifications.map((field) => [field.fieldPath, field.setFieldOptions.value]), [
      ["priceVat", "£9,995 +VAT [Was £10,995]"],
      ["mthPrice", "£209"],
    ]);
  });
});

test("Rent2Buy is rejected before Wix is contacted", async () => {
  await withWixMock(async (calls) => {
    const response = appResponse();
    await handler(appRequest({ action: "preview", pipeline: "rent2buy", registration: "LA23FHK", retail_price: 9995 }), response);
    const result = response.snapshot();
    assert.equal(result.statusCode, 400);
    assert.match(result.payload.message, /restricted to Van Finance/i);
    assert.equal(calls.length, 0);
  });
});
