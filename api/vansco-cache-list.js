import {
  CACHE_TABLE,
  WATCH_TABLE,
  getSupabaseAdmin,
  normalizeActionRecord,
  normalizeCacheRow,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const pipeline = String(request.query?.pipeline || "finance").toLowerCase();
    const supabase = getSupabaseAdmin();

    const { data: cacheRows, error: cacheError } = await supabase
      .from(CACHE_TABLE)
      .select("*")
      .order("last_seen_in_url_list_at", { ascending: false })
      .limit(2000);

    if (cacheError) throw cacheError;

    const { data: watchRows, error: watchError } = await supabase
      .from(WATCH_TABLE)
      .select("*")
      .eq("pipeline", pipeline)
      .limit(2000);

    if (watchError) throw watchError;

    const actionByRegistration = new Map();
    const actionByUrl = new Map();
    (watchRows || []).forEach((row) => {
      const normalized = normalizeActionRecord(row);
      const reg = normalizeRegistration(row.registration);
      if (reg) actionByRegistration.set(reg, normalized);
      if (row.stock_url) actionByUrl.set(row.stock_url, normalized);
    });

    const records = (cacheRows || []).map((row) => {
      const reg = normalizeRegistration(row.registration);
      const action = (reg && actionByRegistration.get(reg)) || actionByUrl.get(row.stock_url) || null;
      return normalizeCacheRow(row, action);
    });

    const ignoredOnly = (watchRows || [])
      .map(normalizeActionRecord)
      .filter((row) => {
        const reg = normalizeRegistration(row.registration);
        const inCache = records.some((record) => (reg && normalizeRegistration(record.registration) === reg) || (row.stockUrl && record.stockUrl === row.stockUrl));
        return !inCache && (row.workflowStatus === "ignored" || String(row.workflowStatus || "").startsWith("not_listing_"));
      });

    const allRecords = [...records, ...ignoredOnly];
    const currentRows = (cacheRows || []).filter((row) => row.is_currently_on_vansco !== false);
    const cachedRegs = currentRows.filter((row) => normalizeRegistration(row.registration)).length;
    const detailRefreshedToday = currentRows.filter((row) => {
      if (!row.last_successfully_checked_at) return false;
      const checked = new Date(row.last_successfully_checked_at);
      const now = new Date();
      return checked.toDateString() === now.toDateString();
    }).length;

    const latestUrlListCheckedAt = currentRows.reduce((latest, row) => {
      const value = row.last_seen_in_url_list_at ? new Date(row.last_seen_in_url_list_at).getTime() : 0;
      return Math.max(latest, value || 0);
    }, 0);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      pipeline,
      records: allRecords,
      summary: {
        currentUrlCount: currentRows.length,
        cachedRegs,
        detailRefreshedToday,
        failedDetailChecks: currentRows.filter((row) => Number(row.fail_count || 0) > 0).length,
        latestUrlListCheckedAt: latestUrlListCheckedAt ? new Date(latestUrlListCheckedAt).toISOString() : "",
      },
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not load Vansco cache records." });
  }
}
