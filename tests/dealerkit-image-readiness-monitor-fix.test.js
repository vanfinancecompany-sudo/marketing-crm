import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDealerKitImageReadinessAlerts } from "../api/dealerkit-image-readiness.js";
import { buildStockWatchMonitorIssues } from "../api/_stock-watch-monitor.js";
import { normalizeRegistration } from "../api/_vansco-cache-utils.js";

const NOW = new Date("2026-09-11T14:30:00.000Z");

function healthySnapshot() {
  return {
    generatedAt: NOW.toISOString(),
    providerId: "dealerkit",
    providerError: null,
    providerDiagnostics: null,
    provider: {
      providerId: "dealerkit",
      providerLabel: "DealerKit",
      checkedAt: "2026-09-11T14:25:00.000Z",
      vehicleCount: 239,
      refresh: { status: "complete", stage: "complete", updatedAt: "2026-09-11T14:25:00.000Z", completedAt: "2026-09-11T14:25:00.000Z", failed: 0, remaining: 0 },
    },
    authorities: { rent2buy: "VAN FINANCE Wix / ALLRENT2BUYVANS", finance: "VAN FINANCE Wix / VANFINANCE-ALLVANS" },
    counts: { providerVehicles: 239, financeCrm: 155, rent2buyCrm: 55, financeLive: 155, rent2buyLive: 55, financeReserved: 2, rent2buyReserved: 0, recentActionLogs: 0 },
    registrations: { financeLive: ["AB24CDE"], rent2buyLive: ["RO21VVD"] },
    queries: { crm: { ok: true }, rent2buy: { ok: true }, finance: { ok: true }, actionLogs: { ok: true } },
    switchReady: true,
  };
}

test("DealerKit image readiness only alerts for an active exact registration with one CMS image and at least five DealerKit images", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    localVehicles: [
      { title: "AB24 CDE Ford Transit", picture: "local.jpg", weblink: "https://example.test/ab24cde" },
      { title: "XY24 ZZZ Ford Transit", picture: "local-2.jpg", weblink: "https://example.test/xy24zzz" },
    ],
    cmsItems: [
      { title: "AB24CDE", imageCount: 1, images: ["cms-main.jpg"] },
      { title: "XY24ZZZ", imageCount: 2, images: ["a.jpg", "b.jpg"] },
    ],
    dealerKitVehicles: [
      { registration: "AB24CDE", supplierStockId: "stock-1", title: "Ford Transit", imageCount: 7, images: [{ url: "dealerkit.jpg" }], status: "available", checkedAt: "2026-09-11T14:25:00.000Z" },
      { registration: "XY24ZZZ", supplierStockId: "stock-2", title: "Ford Transit", imageCount: 9, images: [{ url: "dealerkit-2.jpg" }], status: "available" },
    ],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].registration, "AB24CDE");
  assert.equal(alerts[0].sourceImageCount, 7);
  assert.equal(alerts[0].supplierStockId, "stock-1");
});

test("DealerKit registration normalizer accepts dateless UK registrations returned by the live feed", () => {
  for (const registration of ["VIG6973", "SV7840", "WGZ8806", "XGZ4865"]) {
    assert.equal(normalizeRegistration(registration), registration);
  }
  assert.equal(normalizeRegistration("SV 7840"), "SV7840");
});

test("image readiness production path no longer reads Vansco refresh/cache tables", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-image-readiness.js", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../services/vanscoImageReadiness.js", import.meta.url), "utf8");
  assert.match(endpoint, /fetchDealerKitStockSnapshot/);
  assert.match(endpoint, /allowPartial:\s*false/);
  assert.doesNotMatch(endpoint, /vansco_refresh_runs|vansco_vehicle_cache/i);
  assert.match(service, /\/api\/dealerkit-image-readiness/);
  assert.doesNotMatch(service, /\/api\/vansco-image-readiness/);
});

test("two intentional reserved-status safety stops do not create a critical draft-action failure", () => {
  const actionLogs = [
    { trace_id: "safe-1", created_at: "2026-09-11T14:20:00.000Z", pipeline: "finance", action: "unpublish", registration: "BT25LVC", status: "failed", failure_count: 1, error: "Safety stop: DealerKit did not classify this registration as Reserved, Sold, or Deposit Taken. Nothing was changed in Wix." },
    { trace_id: "safe-2", created_at: "2026-09-11T14:21:00.000Z", pipeline: "finance", action: "unpublish", registration: "BT25LVC", status: "failed", failure_count: 1, error: "Safety stop: DealerKit no longer shows this registration as Reserved/Sold/Deposit Taken. Nothing was changed in Wix." },
  ];
  const issues = buildStockWatchMonitorIssues({ snapshot: healthySnapshot(), previousSnapshot: healthySnapshot(), actionLogs, now: NOW });
  assert.equal(issues.some((item) => item.code === "DRAFT_ACTION_FAILURE"), false);
});

test("real Wix action failures remain visible to the monitor", () => {
  const actionLogs = [
    { trace_id: "real-1", created_at: "2026-09-11T14:20:00.000Z", pipeline: "finance", action: "unpublish", registration: "AB24CDE", status: "failed", failure_count: 1, error: "Wix draft task timed out" },
    { trace_id: "real-2", created_at: "2026-09-11T14:21:00.000Z", pipeline: "finance", action: "unpublish", registration: "XY24ZZZ", status: "failed", failure_count: 1, error: "Wix draft task failed" },
  ];
  const issues = buildStockWatchMonitorIssues({ snapshot: healthySnapshot(), previousSnapshot: healthySnapshot(), actionLogs, now: NOW });
  const failure = issues.find((item) => item.code === "DRAFT_ACTION_FAILURE");
  assert.ok(failure);
  assert.equal(failure.severity, "critical");
});

test("build fix makes the DealerKit photo card fail closed and exposes rejected source rows", () => {
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const monitor = fs.readFileSync(new URL("../api/_stock-watch-monitor.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../api/stock-watch-monitor-agent.js", import.meta.url), "utf8");
  const adapter = fs.readFileSync(new URL("../api/_dealerkit-stock-adapter.js", import.meta.url), "utf8");

  assert.match(page, /summary\.imagesReady[^\n]*Unavailable|Unavailable[^\n]*summary\.imagesReady/);
  assert.match(page, /Rejected DealerKit rows:/);
  assert.match(monitor, /isIntentionalSafetyStop/);
  assert.match(monitor, /providerDiagnostics/);
  assert.match(agent, /providerDiagnostics/);
  assert.match(adapter, /registrationCandidate/);
  assert.match(adapter, /Rejected records:/);
});
