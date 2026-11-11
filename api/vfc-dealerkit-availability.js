import { timingSafeEqual } from "node:crypto";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { projectPublicDealerKitAvailability } from "../lib/dealerKitPublicAvailability.mjs";

function authorized(request) {
  const expected = String(process.env.VFC_DEALERKIT_STATUS_KEY || "").trim();
  const provided = String(request.headers?.["x-vfc-dealerkit-status-key"] || "").trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorized(request)) return response.status(401).json({ ok: false, message: "Not authorised." });
  response.setHeader("Cache-Control", "private, no-store");
  try {
    const supabase = getSupabaseServiceAdmin();
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const [source, actions] = await Promise.all([
      supabase.from("dealerkit_stock_state")
        .select("registration,supplier_stock_id,source_status,last_status,last_seen_at")
        .gte("last_seen_at", since)
        .order("last_seen_at", { ascending: false })
        .limit(2000),
      supabase.from("vansco_stock_watch")
        .select("registration,pipeline,workflow_status")
        .in("pipeline", ["finance", "rent2buy", "cars"])
        .limit(2000),
    ]);
    if (source.error || actions.error) throw new Error("DealerKit or Stock Watch status unavailable.");
    return response.status(200).json({
      ok: true,
      source: "dealerkit_stock_state",
      checkedAt: new Date().toISOString(),
      records: projectPublicDealerKitAvailability(source.data || [], actions.data || []),
    });
  } catch (_error) {
    return response.status(503).json({ ok: false, message: "DealerKit status unavailable." });
  }
}
