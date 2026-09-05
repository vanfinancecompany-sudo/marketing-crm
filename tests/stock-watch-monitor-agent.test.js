import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStockWatchMonitorIssues, summariseMonitorHealth } from "../api/_stock-watch-monitor.js";
import { stockSourceProviderConfig } from "../api/_stock-source-provider.js";

const NOW = new Date("2026-09-04T19:00:00.000Z");

function healthySnapshot(overrides = {}) {
  return {
    generatedAt: NOW.toISOString(),
    providerId: "vansco_dragon",
    providerError: null,
    provider: {
      providerId: "vansco_dragon",
      providerLabel: "Vansco / Dragon2000",
      checkedAt: "2026-09-04T18:30:00.000Z",
      vehicleCount: 290,
      refresh: { status: "complete", stage: "complete", updatedAt: "2026-09-04T18:30:00.000Z", completedAt: "2026-09-04T18:30:00.000Z", failed: 0, remaining: 0 },
    },
    authorities: { rent2buy: "VAN FINANCE Wix / ALLRENT2BUYVANS", finance: "VAN FINANCE Wix / VANFINANCE-ALLVANS" },
    counts: { providerVehicles: 290, financeCrm: 143, rent2buyCrm: 56, financeLive: 144, rent2buyLive: 55, financeReserved: 1, rent2buyReserved: 0, recentActionLogs: 0 },
    registrations: { financeLive: ["AB24CDE"], rent2buyLive: ["RO21VVD"] },
    queries: { crm: { ok: true }, rent2buy: { ok: true }, finance: { ok: true }, actionLogs: { ok: true } },
    switchReady: true,
    ...overrides,
  };
}

test("healthy Stock Watch snapshot produces no operational issues", () => {
  const snapshot = healthySnapshot();
  const previous = healthySnapshot({ counts: { ...snapshot.counts, providerVehicles: 288, rent2buyLive: 56 } });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previous, actionLogs: [], now: NOW });
  assert.deepEqual(issues, []);
  assert.deepEqual(summariseMonitorHealth(issues), { health: "healthy", issueCount: 0, criticalCount: 0, warningCount: 0 });
});

test("Rent2Buy reserved jump is a targeted critical diagnostic", () => {
  const snapshot = healthySnapshot({ counts: { ...healthySnapshot().counts, rent2buyReserved: 13 } });
  const previous = healthySnapshot({ counts: { ...healthySnapshot().counts, rent2buyReserved: 0 } });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previous, actionLogs: [], now: NOW });
  const found = issues.find((item) => item.code === "RENT2BUY_RESERVED_JUMP");
  assert.ok(found);
  assert.equal(found.severity, "critical");
  assert.match(found.lookHere, /ALLRENT2BUYVANS/);
  assert.match(found.directions.join(" "), /old draft registrations/i);
});

test("recent draft failures point to persistent trace IDs and Vercel logs", () => {
  const actionLogs = [{ trace_id: "trace-123", created_at: "2026-09-04T18:50:00.000Z", pipeline: "rent2buy", action: "unpublish", registration: "FD22VLK", status: "partial_failure", failure_count: 2, error: "Wix task timed out" }];
  const issues = buildStockWatchMonitorIssues({ snapshot: healthySnapshot(), previousSnapshot: healthySnapshot(), actionLogs, now: NOW });
  const found = issues.find((item) => item.code === "DRAFT_ACTION_FAILURE");
  assert.ok(found);
  assert.match(found.lookHere, /trace_id/i);
  assert.equal(found.evidence.failures[0].traceId, "trace-123");
});

test("vehicle that reappears after successful draft becomes critical", () => {
  const actionLogs = [{ trace_id: "trace-456", created_at: "2026-09-04T18:40:00.000Z", completed_at: "2026-09-04T18:41:00.000Z", pipeline: "rent2buy", action: "unpublish", registration: "RO21VVD", status: "completed", changed_records: 2, failure_count: 0 }];
  const issues = buildStockWatchMonitorIssues({ snapshot: healthySnapshot(), previousSnapshot: healthySnapshot(), actionLogs, now: NOW });
  const found = issues.find((item) => item.code === "DRAFTED_VEHICLE_REAPPEARED");
  assert.ok(found);
  assert.equal(found.severity, "critical");
  assert.equal(found.registration, "RO21VVD");
  assert.match(found.likelyCause, /stale mirror|republished|wrong live authority/i);
});

test("stalled and stale provider refreshes are caught without an AI call", () => {
  const snapshot = healthySnapshot({ provider: { ...healthySnapshot().provider, checkedAt: "2026-09-04T04:00:00.000Z", refresh: { status: "running", stage: "waiting_next_batch", startedAt: "2026-09-04T15:00:00.000Z", updatedAt: "2026-09-04T17:00:00.000Z", failed: 0, remaining: 120 } } });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: healthySnapshot(), actionLogs: [], now: NOW });
  assert.ok(issues.some((item) => item.code === "STOCK_SOURCE_REFRESH_STALLED"));
});

test("a long refresh that is still making progress is not reported as stalled", () => {
  const snapshot = healthySnapshot({
    provider: {
      ...healthySnapshot().provider,
      checkedAt: "2026-09-04T18:55:00.000Z",
      refresh: {
        status: "running",
        stage: "waiting_next_batch",
        startedAt: "2026-09-04T15:00:00.000Z",
        updatedAt: "2026-09-04T18:55:00.000Z",
        succeeded: 12,
        failed: 6,
        remaining: 120,
      },
    },
  });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: healthySnapshot(), actionLogs: [], now: NOW });
  assert.equal(issues.some((item) => item.code === "STOCK_SOURCE_REFRESH_STALLED"), false);
  const failures = issues.find((item) => item.code === "STOCK_SOURCE_REFRESH_FAILURES");
  assert.ok(failures);
  assert.equal(failures.severity, "warning");
});

test("failed Wix authority reads do not become fake live-stock collapse alarms", () => {
  const snapshot = healthySnapshot({
    counts: { ...healthySnapshot().counts, financeLive: 0, rent2buyLive: 0, financeReserved: 0, rent2buyReserved: 0 },
    registrations: { financeLive: [], rent2buyLive: [] },
    queries: {
      crm: { ok: true },
      rent2buy: { ok: false, pipeline: "rent2buy", error: "MetaSite not found", collectionId: "ALLRENT2BUYVANS" },
      finance: { ok: false, pipeline: "finance", error: "MetaSite not found", collectionId: "VANFINANCE-ALLVANS" },
      actionLogs: { ok: true },
    },
  });
  const previous = healthySnapshot({ counts: { ...healthySnapshot().counts, financeLive: 142, rent2buyLive: 55, rent2buyReserved: 8 } });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previous, actionLogs: [], now: NOW });
  assert.equal(issues.filter((item) => item.code === "AUTHORITY_QUERY_FAILED").length, 2);
  assert.equal(issues.some((item) => item.code === "COUNT_JUMP_FINANCE_LIVE"), false);
  assert.equal(issues.some((item) => item.code === "COUNT_JUMP_RENT2BUY_LIVE"), false);
  assert.equal(issues.some((item) => item.code === "RENT2BUY_LIVE_ZERO"), false);
  assert.equal(issues.some((item) => item.code === "RENT2BUY_RESERVED_JUMP"), false);
});

test("provider read failure does not become a fake provider vehicle-count collapse", () => {
  const snapshot = healthySnapshot({
    providerError: "Provider unavailable",
    provider: { providerId: "vansco_dragon", providerLabel: "Vansco / Dragon2000", vehicleCount: 0, vehicles: [], refresh: {} },
    counts: { ...healthySnapshot().counts, providerVehicles: 0 },
  });
  const previous = healthySnapshot({ counts: { ...healthySnapshot().counts, providerVehicles: 290 } });
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previous, actionLogs: [], now: NOW });
  assert.ok(issues.some((item) => item.code === "STOCK_SOURCE_UNAVAILABLE"));
  assert.equal(issues.some((item) => item.code === "COUNT_JUMP_PROVIDER"), false);
});

test("provider config is swappable without changing monitor business rules", () => {
  assert.deepEqual(stockSourceProviderConfig({ STOCK_SOURCE_PROVIDER_ID: "vansco" }), { id: "vansco_dragon", label: "Vansco / Dragon2000", kind: "supabase_cache", switchReady: true });
  assert.deepEqual(stockSourceProviderConfig({ STOCK_SOURCE_PROVIDER_ID: "normalized_http", STOCK_SOURCE_PROVIDER_LABEL: "Monday Provider" }), { id: "normalized_http", label: "Monday Provider", kind: "normalized_http", switchReady: true });
});

test("monitor agent is advisory-only and AI is anomaly-gated", () => {
  const source = fs.readFileSync(new URL("../api/stock-watch-monitor-agent.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.doesNotMatch(source, /SET_DRAFT_STATUS|UNPUBLISH_DATA_ITEM|\/items\/unpublish/i);
  assert.match(source, /if \(newSevere\.length\)/);
  assert.match(source, /OPENAI_STOCK_WATCH_MONITOR_MODEL/);
  assert.match(source, /gpt-5\.6-terra/);
  assert.match(source, /Never recommend automatic CMS mutations/i);
});

test("build transform adds persistent action tracing and a visible Monitor panel", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-stock-watch-monitor-agent.mjs", import.meta.url), "utf8");
  assert.match(source, /FINANCE_WIX_STOCK_TRACE/);
  assert.match(source, /RENT2BUY_WIX_STOCK_TRACE/);
  assert.match(source, /writeStockWatchActionLog/);
  assert.match(source, /StockWatchMonitorPanel/);
  assert.match(source, /Run health check now/);
});

test("action logger closes a started trace instead of leaving a false stalled row", () => {
  const source = fs.readFileSync(new URL("../api/_stock-watch-action-log.js", import.meta.url), "utf8");
  assert.match(source, /\.eq\("trace_id", payload\.trace_id\)/);
  assert.match(source, /\.eq\("status", "started"\)/);
  assert.match(source, /if \(!updated\?\.length\)/);
});