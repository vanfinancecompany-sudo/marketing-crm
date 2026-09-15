import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("legacy Stock Watch routes are redirected to DealerKit compatibility handlers", () => {
  const config = JSON.parse(read("vercel.json"));
  const rewrites = new Map((config.rewrites || []).map((rewrite) => [rewrite.source, rewrite.destination]));

  assert.equal(rewrites.get("/api/vansco-cache-list"), "/api/dealerkit-stock-watch-legacy-list-compat");
  assert.equal(rewrites.get("/api/vansco-cache-live-refresh"), "/api/dealerkit-stock-watch-legacy-refresh-compat");

  const cronPaths = (config.crons || []).map((cron) => cron.path);
  assert.equal(cronPaths.some((path) => String(path).startsWith("/api/vansco-cache-live-refresh")), false);
  assert.equal(cronPaths.includes("/api/stock-watch-monitor-agent"), true);
});

test("legacy Stock Watch list compatibility delegates to the protected DealerKit source", () => {
  const source = read("api/dealerkit-stock-watch-legacy-list-compat.js");

  assert.match(source, /dealerkit-stock-watch-list\.js/);
  assert.match(source, /MARKETING_CUSTOMER_DATABASE_API_KEY/);
  assert.match(source, /x-marketing-customer-database-key/);
  assert.doesNotMatch(source, /vansco_vehicle_cache|CACHE_TABLE|discoverVanscoUrls|fetchVanscoDetailHtml/);
});

test("legacy refresh compatibility reads DealerKit directly and cannot continue Dragon batches", () => {
  const source = read("api/dealerkit-stock-watch-legacy-refresh-compat.js");

  assert.match(source, /fetchDealerKitStockSnapshot\(\{ allowPartial: true \}\)/);
  assert.match(source, /shouldContinue: false/);
  assert.match(source, /sourceComplete: complete/);
  assert.match(source, /destructive missing-stock actions must remain blocked until a complete snapshot is available/);
  assert.doesNotMatch(source, /discoverVanscoUrls|fetchVanscoDetailHtml|dragon2000|vansco\.co\.uk/);
});

test("DealerKit Stock Watch payload carries snapshot completeness to the UI", () => {
  const source = read("api/dealerkit-stock-watch-list.js");

  assert.match(source, /complete: Boolean\(snapshot\.complete\)/);
  assert.match(source, /failedDetailChecks: Math\.max\(0, Number\(snapshot\.apiReportedTotal/);
});

test("Stock Watch completion authority is saved workflow state, not telemetry snapshots", () => {
  const source = read("api/dealerkit-stock-watch-list.js");

  assert.match(source, /supabase\.from\(WATCH_TABLE\)\.select\("\*"\)\.eq\("pipeline", pipeline\)/);
  assert.match(source, /actionByRegistration/);
  assert.match(source, /workflowStatus/);
  assert.doesNotMatch(source, /stock_watch_action_logs|stock_watch_monitor_runs|ACTION_LOG_TABLE|MONITOR_RUN_TABLE/);
  assert.doesNotMatch(source, /reservedVehicleIsResolved|latestClearFinanceChecks|resolvedReservedRegistrations/);
});

test("DealerKit source remains advisory when incomplete while display reads stay bounded", () => {
  const source = read("api/dealerkit-stock-watch-list.js");

  assert.match(source, /fetchStableDealerKitStockSnapshot\(\{[\s\S]*allowPartial: true,[\s\S]*stabilityAttempts: 1,[\s\S]*\}\)/);
  assert.match(source, /SNAPSHOT_CACHE_TTL_MS = 20_000/);
  assert.match(source, /loadStockWatchSnapshot\(\{ forceFresh \}\)/);
  assert.match(source, /sourceComplete: Boolean\(snapshot\.complete\)/);
  assert.match(source, /failedDetailChecks:/);
});
