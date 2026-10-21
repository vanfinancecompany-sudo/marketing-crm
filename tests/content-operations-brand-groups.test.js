import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAILY_ACTIVITY_TYPES } from "../lib/marketingDailyOperations.js";
import { CONTENT_OPERATIONS_BRANDS, groupContentOperationsMetrics } from "../lib/contentOperationsBrandGroups.js";

test("Content Operations groups every live activity exactly once by business", () => {
  const types = [...DAILY_ACTIVITY_TYPES, "vansco_instagram_post"];
  const all = types.map(type => ({ type, target: 20, completed: 3 }));
  const groups = groupContentOperationsMetrics(all);
  assert.deepEqual(groups.map(g => g.key), ["van-finance","rent2buy","vansco","shared"]);
  assert.equal(groups.flatMap(g => g.metrics).length, all.length);
  assert.deepEqual(groups.flatMap(g => g.metrics).map(m => m.type).sort(), types.sort());
  for (const g of groups) assert.equal(new Set(g.metrics.map(m => m.type)).size,g.metrics.length);
  assert.ok(groups.find(g => g.key==="vansco").metrics.some(m => m.type==="vansco_instagram_post"));
  assert.ok(groups.find(g => g.key==="vansco").metrics.some(m => m.type==="vansco_emails_sent"));
  assert.ok(!groups.find(g => g.key==="shared").metrics.some(m => m.type==="vansco_emails_sent"));
  assert.deepEqual(groups.find(g => g.key==="shared").metrics.map(m=>m.type),["emails_sent","knowledge_hub_article"]);
});

test("Dashboard shows separate sections but preserves Google feed inventory card and navigation", () => {
  const page = readFileSync(new URL("../pages/DashboardPage.jsx", import.meta.url),"utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url),"utf8");
  assert.match(page,/groupContentOperationsMetrics\(displayMetrics\)/);
  assert.match(page,/className="operations-brand-sections"/);
  assert.match(page,/operations-brand-group--/);
  assert.match(page,/group\.metrics\.map\(\(metric\)/);
  assert.match(page,/group\.key === "vansco"/);
  assert.match(page,/<GoogleVehicleAdsCard/);
  assert.match(page,/onNavigate\?\.\("Vansco Google Vehicle Ads"\)/);
  assert.match(css,/\.operations-brand-group--van-finance/);
  assert.match(css,/\.operations-brand-group--rent2buy/);
  assert.match(css,/\.operations-brand-group--vansco/);
  assert.match(css,/@media\(max-width: 720px\)/);
});
