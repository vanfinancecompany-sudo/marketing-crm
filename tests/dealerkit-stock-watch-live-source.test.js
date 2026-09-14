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

test("resolved DealerKit reserved vehicles stay out after Wix is confirmed clear", () => {
  const source = read("api/dealerkit-stock-watch-list.js");

  assert.match(source, /ACTION_LOG_TABLE = "stock_watch_action_logs"/);
  assert.match(source, /MONITOR_RUN_TABLE = "stock_watch_monitor_runs"/);
  assert.match(source, /Number\(row\?\.result\?\.liveCollectionCount\) !== 0/);
  assert.match(source, /financeLiveRegistrations\.has\(registration\)/);
  assert.match(source, /clearCheckedAt >= stateStartedAt/);
  assert.match(source, /resolvedReservedRegistrations\.add\(registration\)/);
  assert.match(source, /resolvedReservedCount: resolvedReservedRegistrations\.size/);
});

test("resolved reserved suppression fails open when current Wix or DealerKit state cannot be proven", () => {
  const source = read("api/dealerkit-stock-watch-list.js");

  assert.match(source, /if \(!\(financeLiveRegistrations instanceof Set\) \|\| financeLiveRegistrations\.has\(registration\)\) return false/);
  assert.match(source, /if \(!stateStartedAt \|\| !Number\.isFinite\(clearCheckedAt\)\) return false/);
  assert.match(source, /sourceUpdatedAt \|\| vehicle\?\.checkedAt \|\| vehicle\?\.sourceCreatedAt/);
});
