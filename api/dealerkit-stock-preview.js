import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

export function summariseDealerKitPreview(snapshot = {}) {
  const vehicles = Array.isArray(snapshot.vehicles) ? snapshot.vehicles : [];
  const diagnostics = snapshot.diagnostics || {};
  const statusCounts = {};
  const typeCounts = {};
  const images = {
    zero: 0,
    one: 0,
    twoToFour: 0,
    fivePlus: 0,
    withAny: 0,
  };

  for (const vehicle of vehicles) {
    const sourceStatus = clean(vehicle?.sourceStatus, 100) || "Unknown";
    const vehicleType = clean(vehicle?.vehicleType, 100) || "Unknown";
    statusCounts[sourceStatus] = (statusCounts[sourceStatus] || 0) + 1;
    typeCounts[vehicleType] = (typeCounts[vehicleType] || 0) + 1;

    const imageCount = Math.max(0, finiteNumber(vehicle?.imageCount));
    if (imageCount > 0) images.withAny += 1;
    if (imageCount === 0) images.zero += 1;
    else if (imageCount === 1) images.one += 1;
    else if (imageCount < 5) images.twoToFour += 1;
    else images.fivePlus += 1;
  }

  const apiReportedTotal = finiteNumber(snapshot.apiReportedTotal ?? diagnostics.apiReportedTotal);
  const vehicleCount = finiteNumber(snapshot.vehicleCount ?? vehicles.length);
  const failedPositions = Array.isArray(diagnostics.failedPositions) ? diagnostics.failedPositions.length : 0;
  const invalidRecords = Array.isArray(diagnostics.invalidRecords) ? diagnostics.invalidRecords.length : 0;
  const duplicateRegistrations = Array.isArray(diagnostics.duplicateRegistrations) ? diagnostics.duplicateRegistrations.length : 0;

  return {
    providerId: "dealerkit",
    providerLabel: "DealerKit",
    complete: Boolean(snapshot.complete),
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
    apiReportedTotal,
    vehicleCount,
    coveragePercent: apiReportedTotal > 0 ? Math.round((vehicleCount / apiReportedTotal) * 1000) / 10 : 0,
    statusCounts,
    typeCounts,
    images,
    issues: {
      failedPageCount: Array.isArray(diagnostics.failedPages) ? diagnostics.failedPages.length : 0,
      failedPositionCount: failedPositions,
      invalidRecordCount: invalidRecords,
      duplicateRegistrationCount: duplicateRegistrations,
      stableReportedTotal: diagnostics.stableReportedTotal !== false,
    },
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  if (!isAuthorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  try {
    const snapshot = await fetchDealerKitStockSnapshot({ allowPartial: true });
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      readOnly: true,
      authoritative: false,
      summary: summariseDealerKitPreview(snapshot),
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(502).json({
      ok: false,
      message: error?.message || "Could not read DealerKit stock.",
    });
  }
}
