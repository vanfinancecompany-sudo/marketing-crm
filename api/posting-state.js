import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

const TABLE = "marketing_posting_state";
const VALID_PAGE_KEYS = new Set(["vanFinanceFacebook", "rent2BuyFacebook", "marketplace"]);

function normalizePostingVehicleId(value) {
  return String(value ?? "").trim();
}

async function readAllStates(supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("page_key, vehicle_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(2000);

  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message || "")) return [];
    throw error;
  }

  return data || [];
}

async function replacePageState(supabase, pageKey, hiddenVehicleIds) {
  if (!VALID_PAGE_KEYS.has(pageKey)) {
    throw new Error("Invalid posting page key.");
  }

  const normalizedIds = Array.from(
    new Set((hiddenVehicleIds || []).map(normalizePostingVehicleId).filter(Boolean))
  );

  const deleteResult = await supabase.from(TABLE).delete().eq("page_key", pageKey);
  if (deleteResult.error) throw deleteResult.error;

  if (!normalizedIds.length) return [];

  const now = new Date().toISOString();
  const rows = normalizedIds.map((vehicleId) => ({
    page_key: pageKey,
    vehicle_id: vehicleId,
    state: "hidden",
    updated_at: now
  }));

  const { data, error } = await supabase
    .from(TABLE)
    .insert(rows)
    .select("page_key, vehicle_id, updated_at");

  if (error) throw error;
  return data || [];
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const supabase = getSupabaseAdmin();

    if (request.method === "GET") {
      const rows = await readAllStates(supabase);
      response.status(200).json({ ok: true, states: rows });
      return;
    }

    if (request.method === "POST") {
      const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
      const pageKey = String(body.pageKey || "");
      const hiddenVehicleIds = Array.isArray(body.hiddenVehicleIds) ? body.hiddenVehicleIds : [];
      const rows = await replacePageState(supabase, pageKey, hiddenVehicleIds);
      response.status(200).json({ ok: true, states: rows });
      return;
    }

    response.status(405).json({ ok: false, message: "Method not allowed." });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error?.message || "Could not sync posting state."
    });
  }
}
