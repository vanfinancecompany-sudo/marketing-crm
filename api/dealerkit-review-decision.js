import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  loadDealerKitReviewDecision,
  normalizeDealerKitReviewInput,
  saveDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import {
  loadDealerKitRent2BuySettings,
  saveDerivedDealerKitRent2BuySettings,
} from "./_dealerkit-rent2buy-settings.js";
import { deriveRent2BuyTermFromMileage } from "../lib/dealerKitRent2BuyPlan.js";

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

async function verifyRent2BuySource(input) {
  const normalized = normalizeDealerKitReviewInput(input);
  if (!normalized.rent2buyEnabled) return { normalized, vehicle: null };

  const vehicle = await fetchDealerKitStockDetail(normalized.supplierStockId, { specifications: false });
  const liveRegistration = normalizeRegistration(vehicle?.registration || "");
  if (!liveRegistration || liveRegistration !== normalized.registration) {
    throw new Error("DealerKit registration changed while saving the Rent2Buy review. Re-open the vehicle and review it again.");
  }
  const term = deriveRent2BuyTermFromMileage(vehicle?.mileage);
  if (term.blocker) throw new Error(term.blocker);
  return { normalized, vehicle };
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
      const [decision, rent2buySettings] = await Promise.all([
        loadDealerKitReviewDecision(supabase, supplierStockId),
        loadDealerKitRent2BuySettings(supabase, supplierStockId),
      ]);
      response.status(200).json({ ok: true, decision, rent2buySettings });
    } catch (error) {
      response.status(502).json({ ok: false, message: error?.message || "Could not load DealerKit review state." });
    }
    return;
  }

  if (request.method === "PUT") {
    try {
      const body = requestBody(request);
      const { normalized, vehicle } = await verifyRent2BuySource(body);
      const decision = await saveDealerKitReviewDecision(supabase, normalized);
      const rent2buySettings = await saveDerivedDealerKitRent2BuySettings(supabase, vehicle || {}, decision);
      response.status(200).json({
        ok: true,
        saved: true,
        decision,
        rent2buySettings,
        message: rent2buySettings
          ? `Review decisions saved. Rent2Buy term was derived automatically as ${rent2buySettings.termMonths} months from DealerKit mileage. No Wix or DealerKit stock data was changed.`
          : "Review decisions saved. No Wix or DealerKit stock data was changed.",
      });
    } catch (error) {
      const message = error?.message || "Could not save DealerKit review state.";
      const clientError = /required|not allowed|valid JSON|42,000|registration changed|mileage/i.test(message);
      response.status(clientError ? 400 : 502).json({ ok: false, message });
    }
    return;
  }

  response.setHeader("Allow", "GET, PUT");
  response.status(405).json({ ok: false, message: "Method not allowed." });
}
