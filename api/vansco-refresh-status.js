import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

const REFRESH_RUNS_TABLE = "vansco_refresh_runs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const runId = request.query?.runId;
    let query = supabase
      .from(REFRESH_RUNS_TABLE)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (runId) query = query.eq("id", runId);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      active: data?.status === "running",
      run: data || null,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not load Vansco refresh status." });
  }
}
