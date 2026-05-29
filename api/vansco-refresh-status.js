import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

const REFRESH_RUNS_TABLE = "vansco_refresh_runs";
const CACHE_TABLE = "vansco_vehicle_cache";

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

async function getLatestFailedDetailsForRun(supabase, run, limit = 10) {
  if (!run?.started_at) return [];

  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("id, stock_url, title, last_error, last_attempted_at, fail_count")
    .gte("last_attempted_at", run.started_at)
    .not("last_error", "is", null)
    .order("last_attempted_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    stockUrl: row.stock_url,
    title: row.title,
    error: row.last_error,
    lastAttemptedAt: row.last_attempted_at,
    failCount: Number(row.fail_count || 0),
  }));
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
    const latestFailedDetails = await getLatestFailedDetailsForRun(supabase, selectedRun, 10);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      active: selectedRun?.status === "running",
      run: selectedRun ? {
        ...selectedRun,
        last_result: {
          ...(selectedRun.last_result || {}),
          latestFailedDetails,
        },
      } : selectedRun,
      latestFailedDetails,
      latestScheduledRun,
      latestCompletedScheduledRun,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not load Vansco refresh status." });
  }
}
