import { loadStockWatchComparisonInputs, STOCK_WATCH_PIPELINES } from "./_dealerkit-stock-watch-comparison.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!process.env.MARKETING_CUSTOMER_DATABASE_API_KEY) {
    return response.status(503).json({ ok: false, message: "Marketing CRM DealerKit access is not configured." });
  }
  const pipeline = String(request.query?.pipeline || "").toLowerCase();
  if (!STOCK_WATCH_PIPELINES.includes(pipeline)) {
    return response.status(400).json({ ok: false, message: "Unknown Stock Watch pipeline." });
  }
  try {
    return response.status(200).json({ ok: true, ...(await loadStockWatchComparisonInputs(pipeline)) });
  } catch (error) {
    return response.status(502).json({ ok: false, message: error?.message || "Could not refresh Wix comparison." });
  }
}
