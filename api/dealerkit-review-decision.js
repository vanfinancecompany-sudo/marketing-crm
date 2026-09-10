import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import {
  loadDealerKitReviewDecision,
  saveDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function requestBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    try { return JSON.parse(request.body); } catch { throw new Error("Review payload must be valid JSON."); }
  }
  return {};
}

export default async function handler(request, response) {
  if (!isAuthorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");
  const supabase = getSupabaseServiceAdmin();

  if (request.method === "GET") {
    const supplierStockId = clean(request.query?.stockId, 300);
    if (!supplierStockId) {
      response.status(400).json({ ok: false, message: "DealerKit stock ID is required." });
      return;
    }
    try {
      const decision = await loadDealerKitReviewDecision(supabase, supplierStockId);
      response.status(200).json({ ok: true, decision });
    } catch (error) {
      response.status(502).json({ ok: false, message: error?.message || "Could not load DealerKit review state." });
    }
    return;
  }

  if (request.method === "PUT") {
    try {
      const decision = await saveDealerKitReviewDecision(supabase, requestBody(request));
      response.status(200).json({
        ok: true,
        saved: true,
        decision,
        message: "Review decisions saved. No Wix or DealerKit stock data was changed.",
      });
    } catch (error) {
      const message = error?.message || "Could not save DealerKit review state.";
      const clientError = /required|not allowed|valid JSON/i.test(message);
      response.status(clientError ? 400 : 502).json({ ok: false, message });
    }
    return;
  }

  response.setHeader("Allow", "GET, PUT");
  response.status(405).json({ ok: false, message: "Method not allowed." });
}
