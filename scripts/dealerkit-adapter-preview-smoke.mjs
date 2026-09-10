import { fetchDealerKitStockSnapshot } from "../api/_dealerkit-stock-adapter.js";

const API_ORIGIN = "https://api.dealerkit.uk";

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function inspectFirstTwoRawPages() {
  const secret = process.env.DEALERKIT_API_SECRET;
  const dealerId = String(process.env.DEALERKIT_DEALER_ID || "").trim();
  if (!secret || !dealerId) return { ok: false, reason: "credentials_missing" };

  const invalidRows = [];
  const pageCounts = [];
  for (let page = 1; page <= 2; page += 1) {
    const url = new URL(`${API_ORIGIN}/integrators/stock`);
    url.searchParams.set("dealer_id", dealerId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        "user-agent": "VFC-DealerKit-Preview-Diagnostics/1.0",
      },
    });
    if (!response.ok) {
      return { ok: false, failedPage: page, httpStatus: response.status, invalidRows, pageCounts };
    }
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    pageCounts.push({ page, count: rows.length, total: Number(payload?.meta?.total ?? 0) || null });
    rows.forEach((row, index) => {
      const registration = normalizeRegistration(row?.vehicle?.registration || row?.vehicle?.plate);
      const idPresent = Boolean(String(row?.id || "").trim());
      if (registration && idPresent) return;
      invalidRows.push({
        position: ((page - 1) * 100) + index + 1,
        idPresent,
        registrationPresent: Boolean(registration),
        sourceStatus: String(row?.status ?? row?.meta?.status ?? "unknown").slice(0, 100),
        vehicleType: String(row?.vehicle?.type ?? "unknown").slice(0, 100),
      });
    });
  }
  return { ok: true, invalidRows, pageCounts, secretLogged: false, dealerIdLogged: false };
}

export async function runDealerKitAdapterPreviewSmoke() {
  console.log("[DealerKit adapter] Preview smoke starting (GET only).");
  const snapshot = await fetchDealerKitStockSnapshot({ allowPartial: true });
  const rawPageDiagnostics = await inspectFirstTwoRawPages();
  const statusCounts = {};
  const typeCounts = {};
  for (const vehicle of snapshot.vehicles) {
    statusCounts[vehicle.sourceStatus] = (statusCounts[vehicle.sourceStatus] || 0) + 1;
    typeCounts[vehicle.vehicleType || "unknown"] = (typeCounts[vehicle.vehicleType || "unknown"] || 0) + 1;
  }
  const target = snapshot.vehicles.find((vehicle) => vehicle.registration === "HT22KJX");
  console.log(JSON.stringify({
    providerId: snapshot.providerId,
    complete: snapshot.complete,
    apiReportedTotal: snapshot.apiReportedTotal,
    reportedTotals: snapshot.diagnostics.reportedTotals,
    stableReportedTotal: snapshot.diagnostics.stableReportedTotal,
    rawMappedRecords: snapshot.diagnostics.rawMappedRecords,
    vehicleCount: snapshot.vehicleCount,
    duplicateSupplierStockIdCount: snapshot.diagnostics.duplicateSupplierStockIds.length,
    duplicateRegistrationCount: snapshot.diagnostics.duplicateRegistrations.length,
    duplicateRegistrations: snapshot.diagnostics.duplicateRegistrations,
    failedPages: snapshot.diagnostics.failedPages,
    failedPositions: snapshot.diagnostics.failedPositions,
    rawPageDiagnostics,
    statusCounts,
    typeCounts,
    target: target ? {
      registration: target.registration,
      supplierStockIdPresent: Boolean(target.supplierStockId),
      price: target.retailPrice,
      vat: target.sourceVatStatus,
      mileage: target.mileage,
      images: target.imageCount,
      status: target.sourceStatus,
    } : null,
    secretLogged: false,
    dealerIdLogged: false,
    writeEndpointsCalled: false,
  }, null, 2));
  console.log("[DealerKit adapter] Preview smoke complete.");
}
