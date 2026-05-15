import { getSupabaseAdmin, optionalTableReason } from "./_vansco-cache-utils.js";

const REFRESH_RUNS_TABLE = "vansco_refresh_runs";

async function latestRunQuery(supabase, extraFilter = null) {
  let query = supabase
    .from(REFRESH_RUNS_TABLE)
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (extraFilter) query = extraFilter(query);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const runId = request.query?.runId;

    let selectedRun = null;
    if (runId) {
      selectedRun = await latestRunQuery(supabase, (query) => query.eq("id", runId));
    } else {
      selectedRun = await latestRunQuery(supabase);
    }

    const latestScheduledRun = await latestRunQuery(supabase, (query) => query.eq("run_type", "scheduled"));
    const latestCompletedScheduledRun = await latestRunQuery(supabase, (query) => query.eq("run_type", "scheduled").eq("status", "complete"));

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      active: selectedRun?.status === "running",
      run: selectedRun,
      latestScheduledRun,
      latestCompletedScheduledRun,
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      active: false,
      run: null,
      latestScheduledRun: null,
      latestCompletedScheduledRun: null,
      message: optionalTableReason(error) || "Could not load Vansco refresh status.",
    });
  }
}
