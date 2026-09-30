import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

const TARGETS = ["YG73UWZ", "LP71KHD"];
const ORIGIN = "https://api.dealerkit.uk";

function clean(value, limit = 5000) {
  return String(value ?? "").trim().slice(0, limit);
}

function sanitize(value, depth = 0) {
  if (depth > 5) return "[depth-limit]";
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/secret|token|password|authorization|credential/i.test(key))
        .slice(0, 200)
        .map(([key, item]) => [key, sanitize(item, depth + 1)])
    );
  }
  return String(value ?? "");
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const secret = clean(process.env.DEALERKIT_API_SECRET, 5000);
  const dealerId = clean(process.env.DEALERKIT_DEALER_ID, 100);
  if (!secret || !dealerId) return response.status(503).json({ ok: false, message: "DealerKit access is not configured." });

  try {
    const supabase = getSupabaseServiceAdmin();
    const { data, error } = await supabase
      .from("dealerkit_stock_state")
      .select("registration,supplier_stock_id,last_seen_at")
      .in("registration", TARGETS);
    if (error) throw error;

    const byReg = new Map((data || []).map((row) => [normalizeRegistration(row.registration), row]));
    const results = [];

    for (const registration of TARGETS) {
      const row = byReg.get(registration);
      if (!row?.supplier_stock_id) {
        results.push({ registration, found: false, reason: "No DealerKit stock-state identity." });
        continue;
      }

      const url = new URL(`${ORIGIN}/integrators/stock/${encodeURIComponent(row.supplier_stock_id)}`);
      url.searchParams.set("dealer_id", dealerId);
      const upstream = await fetch(url, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${secret}`,
          "user-agent": "VFC-DealerKit-Google-Channel-Diagnostic/1.0",
        },
        cache: "no-store",
      });
      const text = await upstream.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      const listing = payload?.data || payload || {};
      results.push({
        registration,
        found: upstream.ok,
        httpStatus: upstream.status,
        supplierStockId: row.supplier_stock_id,
        lastSeenAt: row.last_seen_at,
        rawRegistration: listing?.vehicle?.registration || null,
        advertisingKeys: Object.keys(listing?.advertising || {}),
        advertising: sanitize(listing?.advertising || {}),
        topLevelKeys: Object.keys(listing || {}),
      });
    }

    return response.status(200).json({ ok: true, readOnly: true, targets: results });
  } catch (error) {
    return response.status(502).json({ ok: false, message: clean(error?.message || error, 1000) });
  }
}
