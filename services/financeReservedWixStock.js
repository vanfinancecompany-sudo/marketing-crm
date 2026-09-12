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

export function previewReservedFinanceWixStock(registration, supplierStockId) {
  return callFinanceReservedWixStock({ action: "preview", registration, supplier_stock_id: supplierStockId || undefined });
}

export function unpublishReservedFinanceWixStock(registration, supplierStockId) {
  return callFinanceReservedWixStock({ action: "unpublish", registration, supplier_stock_id: supplierStockId || undefined, confirmed: true });
}
