import dealerKitStockWatchHandler from "./dealerkit-stock-watch-list.js";

function clean(value) {
  return String(value ?? "").trim();
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const internalKey = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  if (!internalKey) {
    response.status(503).json({ ok: false, message: "Marketing CRM DealerKit access is not configured." });
    return;
  }

  request.headers = {
    ...(request.headers || {}),
    "x-marketing-customer-database-key": internalKey,
  };

  return dealerKitStockWatchHandler(request, response);
}
