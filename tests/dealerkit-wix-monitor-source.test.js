import test from "node:test";
import assert from "node:assert/strict";
import { stockSourceProviderConfig } from "../api/_stock-source-provider.js";

test("Stock Watch Monitor defaults to DealerKit after the provider migration", () => {
  assert.deepEqual(stockSourceProviderConfig({}), {
    id: "dealerkit",
    label: "DealerKit",
    kind: "dealerkit",
    switchReady: true,
  });
});

test("legacy Vansco/Dragon remains an explicit rollback adapter only", () => {
  assert.deepEqual(stockSourceProviderConfig({ STOCK_SOURCE_PROVIDER_ID: "vansco_dragon" }), {
    id: "vansco_dragon",
    label: "Vansco / Dragon2000",
    kind: "supabase_cache",
    switchReady: true,
  });
});
