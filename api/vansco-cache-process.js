import {
  CACHE_TABLE,
  fetchHtml,
  getSupabaseAdmin,
  parseDetailHtml,
  vehicleTitleFromUrl,
} from "./_vansco-cache-utils.js";

const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 5;
const DETAIL_TIMEOUT_MS = 25000;

function prioritySort(a, b) {
  const aNoReg = a.registration ? 1 : 0;
  const bNoReg = b.registration ? 1 : 0;
  if (aNoReg !== bNoReg) return aNoReg - bNoReg;

  const aFail = Number(a.fail_count || 0);
  const bFail = Number(b.fail_count || 0);
  if (aFail !== bFail) return aFail - bFail;

  const aChecked = new Date(a.last_successfully_checked_at || a.last_attempted_at || 0).getTime() || 0;
  const bChecked = new Date(b.last_successfully_checked_at || b.last_attempted_at || 0).getTime() || 0;
  return aChecked - bChecked;
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const requestedBatchSize = Math.max(1, Number(request.query?.batchSize || request.body?.batchSize || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
    const batchSize = Math.min(requestedBatchSize, MAX_BATCH_SIZE);
    const now = new Date().toISOString();

    const { data: candidates, error: selectError } = await supabase
      .from(CACHE_TABLE)
      .select("*")
      .eq("is_currently_on_vansco", true)
      .limit(80);

    if (selectError) throw selectError;

    const queued = (candidates || []).sort(prioritySort).slice(0, batchSize);
    const results = [];

    for (const row of queued) {
      const attemptedAt = new Date().toISOString();
      try {
        const page = await fetchHtml(row.stock_url, DETAIL_TIMEOUT_MS);
        if (!page.ok) {
          throw new Error(`Vansco detail returned ${page.status} ${page.statusText || ""}`.trim());
        }

        const parsed = parseDetailHtml(row.stock_url, page.html, row.title || vehicleTitleFromUrl(row.stock_url));
        const updatePayload = {
          ...parsed,
          attempt_count: Number(row.attempt_count || 0) + 1,
          fail_count: 0,
          last_error: null,
          last_attempted_at: attemptedAt,
          last_successfully_checked_at: new Date().toISOString(),
          is_currently_on_vansco: true,
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
          .from(CACHE_TABLE)
          .update(updatePayload)
          .eq("id", row.id);

        if (updateError) throw updateError;

        results.push({
          id: row.id,
          stockUrl: row.stock_url,
          ok: true,
          status: page.status,
          elapsedMs: page.elapsedMs,
          registration: parsed.registration,
          sourceStatus: parsed.source_status,
          imageFound: Boolean(parsed.image_url),
          rejectedRegistrationCandidates: parsed.rejected_registration_candidates || [],
        });
      } catch (error) {
        const message = error?.name === "AbortError" ? "timeout" : error?.message || "Detail fetch failed";
        const { error: updateError } = await supabase
          .from(CACHE_TABLE)
          .update({
            attempt_count: Number(row.attempt_count || 0) + 1,
            fail_count: Number(row.fail_count || 0) + 1,
            last_error: message,
            last_attempted_at: attemptedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (updateError) throw updateError;

        results.push({
          id: row.id,
          stockUrl: row.stock_url,
          ok: false,
          timeout: error?.name === "AbortError",
          error: message,
        });
      }
    }

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      fetchedAt: now,
      batchSize,
      queuedCount: queued.length,
      processedCount: results.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      results,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not process Vansco cache batch." });
  }
}
