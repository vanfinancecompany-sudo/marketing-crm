import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

async function requestPublishedPrice(action, { pipeline, registration, supplierStockId, retailPrice, mileage, vatStatus, confirmation = null }) {
  const response = await fetch("/api/marketing-centre-dealerkit-published-price", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      action,
      pipeline,
      registration,
      supplier_stock_id: supplierStockId || undefined,
      retail_price: retailPrice,
      mileage,
      vat_status: vatStatus,
      ...(confirmation ? { confirmation } : {}),
    }),
  });
  return parseMarketingJsonResponse(response, "Published price update failed.");
}

export function previewDealerKitPublishedPrice(details) {
  return requestPublishedPrice("preview", details);
}

export function updateDealerKitPublishedPrice(details) {
  return requestPublishedPrice("update", details);
}
