import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

async function requestWixPrice(action, { registration, retailPrice, confirmation = null }) {
  const response = await fetch("/api/vansco-wix-price", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      action,
      pipeline: "finance",
      registration,
      retail_price: retailPrice,
      ...(confirmation ? { confirmation } : {}),
    }),
  });
  return parseMarketingJsonResponse(response, "Wix price update failed.");
}

export function previewVanscoWixPrice({ registration, retailPrice }) {
  return requestWixPrice("preview", { registration, retailPrice });
}

export function updateVanscoWixPrice({ registration, retailPrice, confirmation }) {
  return requestWixPrice("update", { registration, retailPrice, confirmation });
}
