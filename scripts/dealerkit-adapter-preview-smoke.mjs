import { fetchDealerKitStockSnapshot } from "../api/_dealerkit-stock-adapter.js";

export async function runDealerKitAdapterPreviewSmoke() {
  console.log("[DealerKit adapter] Preview smoke starting (GET only).");
  const snapshot = await fetchDealerKitStockSnapshot({ allowPartial: true });
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
