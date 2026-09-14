import { buildMarketingAccessHeaders } from "./marketingAccess.js";

async function callFinanceReservedWixStock(payload) {
  const response = await fetch("/api/finance-reserved-wix-stock", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(result?.message || "Could not check Van Finance Wix stock.");
  }
  return result;
}

async function callFinanceMissingDealerKitWixStock(payload) {
  const response = await fetch("/api/finance-missing-dealerkit-wix-stock", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(result?.message || "Could not safely remove DealerKit-missing Van Finance Wix stock.");
  }
  return result;
}

export function previewReservedFinanceWixStock(registration, supplierStockId) {
  return callFinanceReservedWixStock({ action: "preview", registration, supplier_stock_id: supplierStockId || undefined });
}

export function previewMissingFinanceWixStock(registration) {
  return callFinanceReservedWixStock({ action: "preview", registration });
}

export function unpublishReservedFinanceWixStock(registration, supplierStockId) {
  return callFinanceReservedWixStock({ action: "unpublish", registration, supplier_stock_id: supplierStockId || undefined, confirmed: true });
}

export function unpublishMissingFinanceWixStock(registration) {
  return callFinanceMissingDealerKitWixStock({ registration, confirmed: true });
}
