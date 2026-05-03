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

const REFRESH_RUNS_TABLE = "vansco_refresh_runs";
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

async function getOrCreateRun(supabase, { runId, runType }) {
  if (runId) {
    const { data, error } = await supabase
      .from(REFRESH_RUNS_TABLE)
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const { data: existing, error: existingError } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .select("*")
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const startedAt = nowIso();
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .insert({
      run_type: runType || "manual",
      status: "running",
      stage: "starting",
      started_at: startedAt,
      updated_at: startedAt,
      detail_host_preference: "dragon-first",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function updateRun(supabase, runId, patch) {
  if (!runId) return null;
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", runId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function refreshUrlList(supabase, runId) {
  await updateRun(supabase, runId, { stage: "refreshing_url_list" });

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

  await updateRun(supabase, runId, {
    stage: "url_list_refreshed",
    total_urls: rows.length,
    remaining_count: rows.length,
  });

  return {
    sitemapUrl: discovery.sitemapUrl,
    discoveryAttempts: discovery.attempts,
    urlsFound: urls.length,
    rowsUpserted: rows.length,
    refreshedAt,
    staleMarkingSkipped: true,
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
  const runType = String(query.runType || "manual");

  let supabase;
  let run;

  try {
    supabase = getSupabaseAdmin();
    run = await getOrCreateRun(supabase, { runId: query.runId, runType });

    const refresh = refreshUrls ? await refreshUrlList(supabase, run.id) : null;
    const results = [];
    let stoppedReason = "batch_complete";

    await updateRun(supabase, run.id, {
      stage: "processing_dragon_details",
      last_batch_size: batchSize,
    });

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

      const remainingMidBatch = await countRemainingUncheckedOrMissingReg(supabase);
      await updateRun(supabase, run.id, {
        stage: "processing_dragon_details",
        processed_count: Number(run.processed_count || 0) + results.length,
        success_count: Number(run.success_count || 0) + results.filter((item) => item.ok).length,
        failure_count: Number(run.failure_count || 0) + results.filter((item) => !item.ok).length,
        remaining_count: remainingMidBatch,
        last_result: { stoppedReason, latestBatchResults: results.slice(-3) },
      });

      if (stoppedReason === "time_guard") break;
    }

    const remainingCount = await countRemainingUncheckedOrMissingReg(supabase);
    const complete = remainingCount === 0;
    const processedCount = Number(run.processed_count || 0) + results.length;
    const successCount = Number(run.success_count || 0) + results.filter((item) => item.ok).length;
    const failureCount = Number(run.failure_count || 0) + results.filter((item) => !item.ok).length;

    const finalRun = await updateRun(supabase, run.id, {
      status: complete ? "complete" : "running",
      stage: complete ? "complete" : stoppedReason === "time_guard" ? "waiting_next_batch" : "processing_dragon_details",
      completed_at: complete ? nowIso() : null,
      processed_count: processedCount,
      success_count: successCount,
      failure_count: failureCount,
      remaining_count: remainingCount,
      last_batch_size: batchSize,
      last_error: null,
      last_result: { stoppedReason, processedThisBatch: results.length, successThisBatch: results.filter((item) => item.ok).length, failureThisBatch: results.filter((item) => !item.ok).length },
    });

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      fetchedAt: nowIso(),
      detailHostPreference: "dragon-first",
      mode: "safe-live-batch",
      run: finalRun,
      runId: run.id,
      batchSize,
      maxMs,
      elapsedMs: Date.now() - startedAtMs,
      refresh,
      stoppedReason,
      processedCount: results.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      totalRunProcessedCount: processedCount,
      totalRunSuccessCount: successCount,
      totalRunFailureCount: failureCount,
      remainingUncheckedOrMissingRegCount: remainingCount,
      complete,
      shouldContinue: remainingCount > 0,
      results,
    });
  } catch (error) {
    if (supabase && run?.id) {
      try {
        await updateRun(supabase, run.id, {
          status: "failed",
          stage: "failed",
          last_error: error?.message || "Could not run Vansco live refresh.",
        });
      } catch {
        // keep the original error response
      }
    }
    response.status(500).json({ ok: false, message: error?.message || "Could not run Vansco live refresh." });
  }
}
