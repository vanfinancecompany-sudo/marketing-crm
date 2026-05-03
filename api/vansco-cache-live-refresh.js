import {
  CACHE_TABLE,
  discoverVanscoUrls,
  extractVanscoId,
  fetchVanscoDetailHtml,
  getSupabaseAdmin,
  normalizeUrl,
  parseDetailHtml,
  vehicleTitleFromUrl,
  detectVehicleCategory,
} from "./_vansco-cache-utils.js";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const DEFAULT_MAX_MS = 45000;
const HARD_MAX_MS = 54000;
const DETAIL_TIMEOUT_MS = 25000;

function nowIso() {
  return new Date().toISOString();
}

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

async function refreshUrlList(supabase) {
  const discovery = await discoverVanscoUrls();
  const refreshedAt = nowIso();
  const urls = Array.from(new Set(discovery.urls.map(normalizeUrl).filter(Boolean)));

  if (!urls.length) {
    throw new Error("Could not find current Vansco vehicle URLs from sitemap.");
  }

  const rows = urls.map((stockUrl) => {
    const title = vehicleTitleFromUrl(stockUrl);
    return {
      stock_url: stockUrl,
      vansco_id: extractVanscoId(stockUrl) || null,
      title,
      vehicle_type: detectVehicleCategory(title, stockUrl),
      first_seen_at: refreshedAt,
      last_seen_in_url_list_at: refreshedAt,
      is_currently_on_vansco: true,
      updated_at: refreshedAt,
    };
  });

  const { error: upsertError } = await supabase
    .from(CACHE_TABLE)
    .upsert(rows, { onConflict: "stock_url", ignoreDuplicates: false });

  if (upsertError) throw upsertError;

  const { error: staleError } = await supabase
    .from(CACHE_TABLE)
    .update({ is_currently_on_vansco: false, updated_at: refreshedAt })
    .not("stock_url", "in", `(${urls.map((url) => `"${url.replace(/"/g, "\\\"")}"`).join(",")})`);

  if (staleError) throw staleError;

  return {
    sitemapUrl: discovery.sitemapUrl,
    discoveryAttempts: discovery.attempts,
    urlsFound: urls.length,
    rowsUpserted: rows.length,
    refreshedAt,
  };
}

async function getNextCandidates(supabase, limit) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("*")
    .eq("is_currently_on_vansco", true)
    .limit(500);

  if (error) throw error;

  return (data || []).sort(prioritySort).slice(0, limit);
}

async function countRemainingUncheckedOrMissingReg(supabase) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("id, registration, last_successfully_checked_at")
    .eq("is_currently_on_vansco", true)
    .limit(2000);

  if (error) throw error;

  return (data || []).filter((row) => !row.registration || !row.last_successfully_checked_at).length;
}

async function processOne(supabase, row) {
  const attemptedAt = nowIso();

  try {
    const page = await fetchVanscoDetailHtml(row.stock_url, DETAIL_TIMEOUT_MS);
    if (!page.ok) {
      throw new Error(`Vansco detail returned ${page.status} ${page.statusText || ""}`.trim());
    }

    const parsed = parseDetailHtml(row.stock_url, page.html, row.title || vehicleTitleFromUrl(row.stock_url));
    const { rejected_registration_candidates: rejectedRegistrationCandidates = [], ...cacheFields } = parsed;
    const checkedAt = nowIso();
    const updatePayload = {
      ...cacheFields,
      attempt_count: Number(row.attempt_count || 0) + 1,
      fail_count: 0,
      last_error: null,
      last_attempted_at: attemptedAt,
      last_successfully_checked_at: checkedAt,
      is_currently_on_vansco: true,
      updated_at: checkedAt,
    };

    const { error: updateError } = await supabase
      .from(CACHE_TABLE)
      .update(updatePayload)
      .eq("id", row.id);

    if (updateError) throw updateError;

    return {
      id: row.id,
      stockUrl: row.stock_url,
      fetchedFrom: page.usedHost,
      ok: true,
      elapsedMs: page.elapsedMs,
      registration: parsed.registration,
      sourceStatus: parsed.source_status,
      imageFound: Boolean(parsed.image_url),
      rejectedRegistrationCandidates,
    };
  } catch (error) {
    const attempts = error?.attempts || [];
    const message = attempts.length
      ? attempts.map((attempt) => `${attempt.url}: ${attempt.timeout ? "timeout" : attempt.message || attempt.status || "failed"}`).join(" | ")
      : error?.name === "AbortError" ? "timeout" : error?.message || "Detail fetch failed";

    const { error: updateError } = await supabase
      .from(CACHE_TABLE)
      .update({
        attempt_count: Number(row.attempt_count || 0) + 1,
        fail_count: Number(row.fail_count || 0) + 1,
        last_error: message,
        last_attempted_at: attemptedAt,
        updated_at: nowIso(),
      })
      .eq("id", row.id);

    if (updateError) throw updateError;

    return {
      id: row.id,
      stockUrl: row.stock_url,
      ok: false,
      timeout: attempts.some((attempt) => attempt.timeout) || error?.name === "AbortError",
      attempts,
      error: message,
    };
  }
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const startedAtMs = Date.now();
  const query = request.query || {};
  const refreshUrls = String(query.refreshUrls || "true") !== "false";
  const requestedBatchSize = Math.max(1, Number(query.batchSize || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE);
  const batchSize = Math.min(requestedBatchSize, MAX_BATCH_SIZE);
  const maxMs = Math.min(Math.max(Number(query.maxMs || DEFAULT_MAX_MS) || DEFAULT_MAX_MS, 5000), HARD_MAX_MS);

  try {
    const supabase = getSupabaseAdmin();
    const refresh = refreshUrls ? await refreshUrlList(supabase) : null;
    const results = [];
    let stoppedReason = "batch_complete";

    while (results.length < batchSize) {
      if (Date.now() - startedAtMs > maxMs - 5000) {
        stoppedReason = "time_guard";
        break;
      }

      const nextRows = await getNextCandidates(supabase, Math.min(batchSize - results.length, 10));
      if (!nextRows.length) {
        stoppedReason = "complete";
        break;
      }

      for (const row of nextRows) {
        if (results.length >= batchSize) break;
        if (Date.now() - startedAtMs > maxMs - 5000) {
          stoppedReason = "time_guard";
          break;
        }
        results.push(await processOne(supabase, row));
      }

      if (stoppedReason === "time_guard") break;
    }

    const remainingCount = await countRemainingUncheckedOrMissingReg(supabase);

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      fetchedAt: nowIso(),
      detailHostPreference: "dragon-first",
      mode: "safe-live-batch",
      batchSize,
      maxMs,
      elapsedMs: Date.now() - startedAtMs,
      refresh,
      stoppedReason,
      processedCount: results.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      remainingUncheckedOrMissingRegCount: remainingCount,
      complete: remainingCount === 0,
      shouldContinue: remainingCount > 0,
      results,
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error?.message || "Could not run Vansco live refresh." });
  }
}
