import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDealerKitImageReadinessAlerts } from "../api/dealerkit-image-readiness.js";
import { fetchDealerKitStockSnapshot } from "../api/_dealerkit-stock-adapter.js";
import { buildStockWatchMonitorIssues } from "../api/_stock-watch-monitor.js";
import { normalizeRegistration } from "../api/_vansco-cache-utils.js";

const NOW = new Date("2026-09-11T14:30:00.000Z");
const DEALERKIT_ENV = {
  DEALERKIT_API_SECRET: "test-secret",
  DEALERKIT_DEALER_ID: "test-dealer",
};

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

function dealerKitRow(id, registration) {
  return {
    id,
    status: "available",
    vehicle: {
      registration,
      manufacturer: "Ford",
      model: "Transit",
      derivative: "350 Leader",
      type: "LCV",
    },
    prices: { advertised: { amount: 12000, vat_status: "ex-vat" } },
    media: { images: [{ id: `${id}-image`, url: `https://cdn.example.test/${id}.jpg` }] },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pagePayload(data, { total, currentPage, lastPage, perPage }) {
  return {
    data,
    meta: {
      total,
      current_page: currentPage,
      last_page: lastPage,
      per_page: perPage,
    },
  };
}

test("DealerKit image readiness alerts when DealerKit has more images than the current live advert", () => {
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

  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].registration, "XY24ZZZ");
  assert.equal(alerts[0].currentAdvertImageCount, 2);
  assert.equal(alerts[0].sourceImageCount, 9);
  assert.equal(alerts[0].newImageCount, 7);
  assert.equal(alerts[1].registration, "AB24CDE");
  assert.equal(alerts[1].sourceImageCount, 7);
  assert.equal(alerts[1].supplierStockId, "stock-1");
});

test("BD21HCX is photo-ready in Finance from its own live one-image advert", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: {
        registrations: ["BD21HCX"],
        vehicles: [{ registration: "BD21HCX", title: "Ford Transit Leader TWIN WHEEL LUTON", webLink: "https://example.test/finance/bd21hcx" }],
      },
      rent2buy: {
        registrations: ["BD21HCX"],
        vehicles: [{ registration: "BD21HCX", title: "Ford Transit", webLink: "https://example.test/rent2buy/bd21hcx" }],
      },
    },
    cmsItemsByPipeline: {
      // Finance can report zero from the CMS gallery feed while the live page shows
      // its primary image. The live listing therefore gives Finance a safe floor of 1.
      finance: [{ title: "BD21HCX", imageCount: 0 }],
      rent2buy: [{ title: "BD21HCX", imageCount: 18 }],
    },
    dealerKitVehicles: [{
      registration: "BD21HCX",
      supplierStockId: "bd21hcx-stock",
      title: "Ford Transit 2.0 350 EcoBlue HD Leader Chassis Cab",
      bodyType: "Chassis Cab",
      vehicleType: "LCV",
      imageCount: 19,
      images: Array.from({ length: 19 }, (_, index) => ({ id: `bd-${index + 1}`, url: `https://dealerkit.test/bd-${index + 1}.jpg` })),
      status: "available",
    }],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].registration, "BD21HCX");
  assert.equal(alerts[0].currentAdvertImageCount, 1);
  assert.equal(alerts[0].sourceImageCount, 19);
  assert.equal(alerts[0].newImageCount, 18);
  assert.deepEqual(alerts[0].advertisedPipelines, ["finance"]);
  assert.equal(alerts[0].referencePipeline, "finance");
  assert.equal(alerts[0].crossProductEvidence, false);
});

test("Finance and Rent2Buy photo readiness are isolated advertising lanes", () => {
  const listingPresenceByPipeline = {
    finance: { registrations: ["AB24CDE"], vehicles: [{ registration: "AB24CDE" }] },
    rent2buy: { registrations: ["AB24CDE"], vehicles: [{ registration: "AB24CDE" }] },
  };
  const cmsItemsByPipeline = {
    finance: [{ title: "AB24CDE", imageCount: 2 }],
    rent2buy: [{ title: "AB24CDE", imageCount: 6 }],
  };
  const dealerKitVehicles = [{ registration: "AB24CDE", title: "Ford Transit", vehicleType: "LCV", imageCount: 6, status: "available" }];

  const financeAlerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline,
    cmsItemsByPipeline,
    dealerKitVehicles,
  });
  assert.equal(financeAlerts.length, 1, "Finance 2-image due-in advert must not be suppressed by Rent2Buy's six-image gallery");
  assert.equal(financeAlerts[0].currentAdvertImageCount, 2);
  assert.deepEqual(financeAlerts[0].advertisedPipelines, ["finance"]);

  const rent2buyAlerts = buildDealerKitImageReadinessAlerts({
    pipeline: "rent2buy",
    listingPresenceByPipeline,
    cmsItemsByPipeline,
    dealerKitVehicles,
  });
  assert.equal(rent2buyAlerts.length, 0, "Rent2Buy six-image gallery is already a normal gallery and should not alert");
});

test("Cars photo readiness compares a live Cars advert with DealerKit", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "cars",
    listingPresenceByPipeline: {
      cars: { registrations: ["AB24CAR"], vehicles: [{ registration: "AB24CAR", title: "Example car" }] },
    },
    cmsItemsByPipeline: {
      cars: [{ title: "AB24CAR", numberOfImages: 2, mainImages: ["car-1.jpg", "car-2.jpg"] }],
    },
    dealerKitVehicles: [{
      registration: "AB24CAR",
      supplierStockId: "car-stock",
      title: "Example Hatchback",
      vehicleType: "Car",
      bodyType: "Hatchback",
      imageCount: 8,
      images: [{ url: "https://dealerkit.test/car.jpg" }],
      status: "available",
    }],
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].registration, "AB24CAR");
  assert.equal(alerts[0].currentAdvertImageCount, 2);
  assert.equal(alerts[0].sourceImageCount, 8);
  assert.equal(alerts[0].newImageCount, 6);
  assert.deepEqual(alerts[0].advertisedPipelines, ["cars"]);
});

test("DealerKit registration normalizer accepts dateless UK registrations returned by the live feed", () => {
  for (const registration of ["VIG6973", "SV7840", "WGZ8806", "XGZ4865"]) {
    assert.equal(normalizeRegistration(registration), registration);
  }
  assert.equal(normalizeRegistration("SV 7840"), "SV7840");
});

test("DealerKit transient 5xx page failures are retried before the snapshot is degraded", async () => {
  let pageTwoAttempts = 0;
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (page === 1 && perPage === 2) {
      return jsonResponse(pagePayload([
        dealerKitRow("stock-a", "AB24CDE"),
        dealerKitRow("stock-b", "XY24ZZZ"),
      ], { total: 3, currentPage: 1, lastPage: 2, perPage: 2 }));
    }

    if (page === 2 && perPage === 2) {
      pageTwoAttempts += 1;
      if (pageTwoAttempts < 3) return jsonResponse({ message: "temporary upstream error" }, 500);
      return jsonResponse(pagePayload([
        dealerKitRow("stock-c", "RO21VVD"),
      ], { total: 3, currentPage: 2, lastPage: 2, perPage: 2 }));
    }

    throw new Error(`Unexpected DealerKit test request: ${url}`);
  };

  const snapshot = await fetchDealerKitStockSnapshot({
    environment: DEALERKIT_ENV,
    fetchImplementation,
    perPage: 2,
    allowPartial: false,
  });

  assert.equal(pageTwoAttempts, 3);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.vehicleCount, 3);
  assert.equal(snapshot.refresh.status, "complete");
});

test("persistent isolated DealerKit 5xx records produce a usable degraded snapshot rather than zero source", async () => {
  let failedPageAttempts = 0;
  let failedPositionAttempts = 0;
  const fetchImplementation = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page"));
    const perPage = Number(url.searchParams.get("per_page"));

    if (page === 1 && perPage === 2) {
      return jsonResponse(pagePayload([
        dealerKitRow("stock-a", "AB24CDE"),
        dealerKitRow("stock-b", "XY24ZZZ"),
      ], { total: 3, currentPage: 1, lastPage: 2, perPage: 2 }));
    }

    if (page === 2 && perPage === 2) {
      failedPageAttempts += 1;
      return jsonResponse({ message: "persistent page failure" }, 500);
    }

    if (page === 3 && perPage === 1) {
      failedPositionAttempts += 1;
      return jsonResponse({ message: "persistent item failure" }, 500);
    }

    throw new Error(`Unexpected DealerKit test request: ${url}`);
  };

  const snapshot = await fetchDealerKitStockSnapshot({
    environment: DEALERKIT_ENV,
    fetchImplementation,
    perPage: 2,
    allowPartial: true,
  });

  assert.equal(failedPageAttempts, 3);
  assert.equal(failedPositionAttempts, 3);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.vehicleCount, 2);
  assert.equal(snapshot.refresh.status, "partial");
  assert.equal(snapshot.refresh.failed, 1);
  assert.equal(snapshot.refresh.remaining, 1);
  assert.equal(snapshot.diagnostics.failedPositions.length, 1);
});

test("a degraded DealerKit snapshot is a monitor warning, not a source-unavailable critical", () => {
  const snapshot = healthySnapshot();
  const diagnostics = {
    apiReportedTotal: 244,
    recordsFetched: 242,
    stableReportedTotal: true,
    invalidRecords: [],
    duplicateSupplierStockIds: [],
    duplicateRegistrations: [],
    failedPages: [{ page: 3, status: 500 }],
    failedPositions: [{ position: 225, status: 500 }, { position: 229, status: 500 }],
  };
  snapshot.providerDiagnostics = diagnostics;
  snapshot.provider = {
    providerId: "dealerkit",
    providerLabel: "DealerKit",
    checkedAt: "2026-09-11T14:25:00.000Z",
    vehicleCount: 242,
    complete: false,
    diagnostics,
    refresh: {
      status: "partial",
      stage: "incomplete_source",
      updatedAt: "2026-09-11T14:25:00.000Z",
      completedAt: "2026-09-11T14:25:00.000Z",
      total: 244,
      succeeded: 242,
      failed: 2,
      remaining: 2,
      error: "DealerKit returned an incomplete or unstable stock snapshot; authoritative cutover is blocked.",
    },
  };
  snapshot.counts.providerVehicles = 242;

  const previous = structuredClone(snapshot);
  const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previous, actionLogs: [], now: NOW });
  assert.equal(issues.some((item) => item.code === "STOCK_SOURCE_UNAVAILABLE"), false);
  const degraded = issues.find((item) => item.code === "STOCK_SOURCE_REFRESH_FAILURES");
  assert.ok(degraded);
  assert.equal(degraded.severity, "warning");
  assert.equal(degraded.evidence.failed, 2);
  assert.deepEqual(degraded.evidence.diagnostics.failedPositions, diagnostics.failedPositions);
});

test("image readiness production path uses known-good rows from a degraded DealerKit snapshot across all three products", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-image-readiness.js", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../services/vanscoImageReadiness.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(endpoint, /fetchDealerKitStockSnapshot/);
  assert.match(endpoint, /allowPartial:\s*true/);
  assert.match(endpoint, /const sourceDegraded = dealerKitSnapshot\.complete === false/);
  assert.match(endpoint, /degraded:\s*sourceDegraded/);
  assert.match(endpoint, /complete:\s*!sourceDegraded/);
  assert.match(endpoint, /loadLiveWixListingPresence/);
  assert.match(endpoint, /SUPPORTED_PIPELINES/);
  assert.match(endpoint, /CARPAGES/);
  assert.match(endpoint, /comparisonScope:\s*"selected_pipeline_only"/);
  assert.doesNotMatch(endpoint, /if \(!dealerKitSnapshot\.complete\)[\s\S]{0,300}status\(503\)/);
  assert.match(page, /imageReadySummary\.sourceAvailable === false/);
  assert.doesNotMatch(endpoint, /vansco_refresh_runs|vansco_vehicle_cache/i);
  assert.match(service, /\["finance", "rent2buy", "cars"\]/);
  assert.match(service, /\/api\/dealerkit-image-readiness/);
  assert.doesNotMatch(service, /\/api\/vansco-image-readiness/);
});

test("absence-based reserved mutation remains fail-closed on an incomplete DealerKit snapshot", () => {
  const verifier = fs.readFileSync(new URL("../api/_dealerkit-reservation-verification.js", import.meta.url), "utf8");
  assert.match(verifier, /allowPartial:\s*true/);
  assert.match(verifier, /if \(snapshot\.complete === false\)/);
  assert.match(verifier, /could not safely verify/);
  assert.match(verifier, /Nothing was changed in Wix/);
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

test("build fix makes hard image-readiness failures unavailable and exposes rejected source rows", () => {
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const monitor = fs.readFileSync(new URL("../api/_stock-watch-monitor.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../api/stock-watch-monitor-agent.js", import.meta.url), "utf8");
  const adapter = fs.readFileSync(new URL("../api/_dealerkit-stock-adapter.js", import.meta.url), "utf8");
  const provider = fs.readFileSync(new URL("../api/_stock-source-provider.js", import.meta.url), "utf8");

  assert.match(page, /summary\.imagesReady[^\n]*Unavailable|Unavailable[^\n]*summary\.imagesReady/);
  assert.match(page, /Rejected DealerKit rows:/);
  assert.match(monitor, /isIntentionalSafetyStop/);
  assert.match(monitor, /providerDiagnostics/);
  assert.match(agent, /allowPartial:\s*true/);
  assert.match(agent, /providerDiagnostics/);
  assert.match(provider, /allowPartial = false/);
  assert.match(provider, /fetchDealerKitStockSnapshot\(\{ environment, fetchImplementation, allowPartial \}\)/);
  assert.match(adapter, /DEALERKIT_REQUEST_ATTEMPTS = 3/);
  assert.match(adapter, /TRANSIENT_DEALERKIT_STATUSES/);
  assert.match(adapter, /registrationCandidate/);
  assert.match(adapter, /Rejected records:/);
});
