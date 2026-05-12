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
const STARTUP_BATCH_SIZE = 5;
const DEFAULT_MAX_MS = 45000;
const HARD_MAX_MS = 54000;
const DETAIL_TIMEOUT_MS = 12000;
const DISCOVERY_RETRY_COUNT = 3;
const DISCOVERY_RETRY_DELAY_MS = 2500;
const AUTO_BATCH_SIZE = 15;
const AUTO_MAX_MS = 45000;
const AUTO_RUNNING_STALE_MS = 2 * 60 * 60 * 1000;
const AUTO_RECENT_SLOT_MS = 25 * 60 * 1000;
const AUTO_START_WINDOWS = new Set(["08:00", "12:30", "16:30", "02:00"]);
const REFRESH_RUN_RETENTION_DAYS = 60;
const CACHE_ABSENT_RETENTION_DAYS = 120;
const CLEANUP_LIMIT = 250;

function nowIso() {
  return new Date().toISOString();
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toTime(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function londonParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    dateKey: `${pick("year")}-${pick("month")}-${pick("day")}`,
    timeKey: `${pick("hour")}:${pick("minute")}`,
  };
}

function isAutoStartWindow(date = new Date()) {
  return AUTO_START_WINDOWS.has(londonParts(date).timeKey);
}

function prioritySort(a, b) {
  const aAttempted = a.last_attempted_at ? 1 : 0;
  const bAttempted = b.last_attempted_at ? 1 : 0;
  if (aAttempted !== bAttempted) return aAttempted - bAttempted;

  const aFail = Number(a.fail_count || 0);
  const bFail = Number(b.fail_count || 0);
  if (aFail !== bFail) return aFail - bFail;

  const aChecked = toTime(a.last_successfully_checked_at || a.last_attempted_at);
  const bChecked = toTime(b.last_successfully_checked_at || b.last_attempted_at);
  return aChecked - bChecked;
}

async function getLatestRunningRun(supabase) {
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .select("*")
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRecentScheduledRun(supabase) {
  const since = new Date(Date.now() - AUTO_RECENT_SLOT_MS).toISOString();
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .select("*")
    .eq("run_type", "scheduled")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
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

async function cleanupOldVanscoData(supabase) {
  const cleanup = {
    refreshRunsDeleted: 0,
    staleCacheRowsDeleted: 0,
    errors: [],
  };

  try {
    const oldRunsCutoff = daysAgoIso(REFRESH_RUN_RETENTION_DAYS);
    const { data, error } = await supabase
      .from(REFRESH_RUNS_TABLE)
      .delete()
      .lt("updated_at", oldRunsCutoff)
      .neq("status", "running")
      .select("id")
      .limit(CLEANUP_LIMIT);

    if (error) throw error;
    cleanup.refreshRunsDeleted = Array.isArray(data) ? data.length : 0;
  } catch (error) {
    cleanup.errors.push(`refresh_runs: ${error?.message || "cleanup failed"}`);
  }

  try {
    const oldCacheCutoff = daysAgoIso(CACHE_ABSENT_RETENTION_DAYS);
    const { data, error } = await supabase
      .from(CACHE_TABLE)
      .delete()
      .eq("is_currently_on_vansco", false)
      .lt("last_seen_in_url_list_at", oldCacheCutoff)
      .select("id")
      .limit(CLEANUP_LIMIT);

    if (error) throw error;
    cleanup.staleCacheRowsDeleted = Array.isArray(data) ? data.length : 0;
  } catch (error) {
    cleanup.errors.push(`vehicle_cache: ${error?.message || "cleanup failed"}`);
  }

  return cleanup;
}

async function prepareScheduledRun(supabase) {
  const running = await getLatestRunningRun(supabase);
  const now = Date.now();

  if (running) {
    const updatedAt = toTime(running.updated_at || running.started_at);
    if (updatedAt && now - updatedAt <= AUTO_RUNNING_STALE_MS) {
      return { mode: "continue_running", runId: running.id, refreshUrls: false, idle: false };
    }

    await updateRun(supabase, running.id, {
      status: "failed",
      stage: "failed",
      last_error: "Scheduled refresh marked this run stale before starting a new one.",
    });
  }

  if (!isAutoStartWindow(new Date())) {
    return { mode: "idle_waiting_for_window", idle: true, london: londonParts(new Date()) };
  }

  const recentScheduled = await getRecentScheduledRun(supabase);
  if (recentScheduled) {
    return {
      mode: "idle_already_started_this_window",
      idle: true,
      runId: recentScheduled.id,
      london: londonParts(new Date()),
    };
  }

  return { mode: "start_new_scheduled_run", refreshUrls: true, idle: false };
}

async function getOrCreateRun(supabase, { runId, runType, forceNew = false }) {
  if (runId) {
    const { data, error } = await supabase
      .from(REFRESH_RUNS_TABLE)
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (!forceNew) {
    const existing = await getLatestRunningRun(supabase);
    if (existing) return existing;
  } else {
    await supabase
      .from(REFRESH_RUNS_TABLE)
      .update({ status: "paused", stage: "superseded", updated_at: nowIso() })
      .eq("status", "running");
  }

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

async function discoverVanscoUrlsWithRetries() {
  const attempts = [];

  for (let attemptNumber = 1; attemptNumber <= DISCOVERY_RETRY_COUNT; attemptNumber += 1) {
    const discovery = await discoverVanscoUrls();
    attempts.push({ attemptNumber, ...discovery });

    if (discovery.urls?.length) {
      return {
        ...discovery,
        retryAttempts: attempts,
        usedFallbackCache: false,
      };
    }

    if (attemptNumber < DISCOVERY_RETRY_COUNT) {
      await delay(DISCOVERY_RETRY_DELAY_MS * attemptNumber);
    }
  }

  return {
    sitemapUrl: "",
    attempts: attempts.flatMap((item) => item.attempts || []),
    retryAttempts: attempts,
    urls: [],
    usedFallbackCache: false,
  };
}

async function fallbackToCachedUrlList(supabase, runId, discovery) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("id, stock_url")
    .eq("is_currently_on_vansco", true)
    .limit(2000);

  if (error) throw error;

  const cachedRows = (data || []).filter((row) => row.stock_url);
  if (!cachedRows.length) {
    throw new Error("Could not find current Vansco vehicle URLs from sitemap and no cached Vansco URL list is available.");
  }

  await updateRun(supabase, runId, {
    stage: "using_cached_url_list_after_discovery_failure",
    total_urls: cachedRows.length,
    processed_count: 0,
    success_count: 0,
    failure_count: 0,
    remaining_count: cachedRows.length,
    last_error: "Vansco URL discovery failed at startup, so the refresh is continuing with the last cached URL list.",
    last_result: {
      startupFallback: true,
      cachedUrlCount: cachedRows.length,
      discoveryAttempts: discovery.retryAttempts || discovery.attempts || [],
    },
  });

  return {
    sitemapUrl: "cached-url-list",
    discoveryAttempts: discovery.retryAttempts || discovery.attempts || [],
    urlsFound: cachedRows.length,
    rowsUpserted: 0,
    refreshedAt: nowIso(),
    staleMarkingSkipped: true,
    usedFallbackCache: true,
    message: "Vansco URL discovery failed, so the last cached URL list was used for this run.",
  };
}

async function refreshUrlList(supabase, runId) {
  await updateRun(supabase, runId, { stage: "refreshing_url_list" });

  const discovery = await discoverVanscoUrlsWithRetries();
  const refreshedAt = nowIso();
  const urls = Array.from(new Set((discovery.urls || []).map(normalizeUrl).filter(Boolean)));

  if (!urls.length) {
    return fallbackToCachedUrlList(supabase, runId, discovery);
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
    processed_count: 0,
    success_count: 0,
    failure_count: 0,
    remaining_count: rows.length,
    last_error: null,
  });

  return {
    sitemapUrl: discovery.sitemapUrl,
    discoveryAttempts: discovery.retryAttempts || discovery.attempts,
    urlsFound: urls.length,
    rowsUpserted: rows.length,
    refreshedAt,
    staleMarkingSkipped: true,
    usedFallbackCache: false,
  };
}

function wasAttemptedDuringRun(row, runStartedAt) {
  return toTime(row.last_attempted_at) >= toTime(runStartedAt);
}

async function getNextCandidates(supabase, limit, runStartedAt) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("*")
    .eq("is_currently_on_vansco", true)
    .limit(2000);

  if (error) throw error;

  return (data || [])
    .filter((row) => !wasAttemptedDuringRun(row, runStartedAt))
    .sort(prioritySort)
    .slice(0, limit);
}

async function countRemainingForRun(supabase, runStartedAt) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("id, last_attempted_at")
    .eq("is_currently_on_vansco", true)
    .limit(2000);

  if (error) throw error;
  return (data || []).filter((row) => !wasAttemptedDuringRun(row, runStartedAt)).length;
}

async function processOne(supabase, row) {
  const attemptedAt = nowIso();

  try {
    const page = await fetchVanscoDetailHtml(row.stock_url, DETAIL_TIMEOUT_MS);
    if (!page.ok) throw new Error(`Vansco detail returned ${page.status} ${page.statusText || ""}`.trim());

    const parsed = parseDetailHtml(row.stock_url, page.html, row.title || vehicleTitleFromUrl(row.stock_url));
    const { rejected_registration_candidates: rejectedRegistrationCandidates = [], ...cacheFields } = parsed;
    const checkedAt = nowIso();

    const { error: updateError } = await supabase
      .from(CACHE_TABLE)
      .update({
        ...cacheFields,
        attempt_count: Number(row.attempt_count || 0) + 1,
        fail_count: 0,
        last_error: null,
        last_attempted_at: attemptedAt,
        last_successfully_checked_at: checkedAt,
        is_currently_on_vansco: true,
        updated_at: checkedAt,
      })
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
  const autoScheduled = String(query.auto || query.autoScheduled || "false") === "true";
  let refreshUrls = String(query.refreshUrls || "true") !== "false";
  let batchSize = Math.min(Math.max(1, Number(query.batchSize || DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);
  let maxMs = Math.min(Math.max(Number(query.maxMs || DEFAULT_MAX_MS) || DEFAULT_MAX_MS, 5000), HARD_MAX_MS);
  let runType = String(query.runType || "manual");
  let runId = query.runId;
  let scheduleDecision = null;

  let supabase;
  let run;

  try {
    supabase = getSupabaseAdmin();

    if (autoScheduled) {
      runType = "scheduled";
      batchSize = Math.min(Math.max(Number(query.batchSize || AUTO_BATCH_SIZE) || AUTO_BATCH_SIZE, 1), MAX_BATCH_SIZE);
      maxMs = Math.min(Math.max(Number(query.maxMs || AUTO_MAX_MS) || AUTO_MAX_MS, 5000), HARD_MAX_MS);
      scheduleDecision = await prepareScheduledRun(supabase);

      if (scheduleDecision.idle) {
        response.setHeader("Cache-Control", "no-store, max-age=0");
        response.status(200).json({
          ok: true,
          mode: "scheduled-idle",
          fetchedAt: nowIso(),
          scheduleDecision,
          message: "No scheduled Vansco refresh action needed on this tick.",
        });
        return;
      }

      refreshUrls = Boolean(scheduleDecision.refreshUrls);
      runId = scheduleDecision.runId || "";
    }

    if (refreshUrls && !runId) {
      batchSize = Math.min(batchSize, STARTUP_BATCH_SIZE);
      maxMs = Math.max(maxMs, 45000);
    }

    run = await getOrCreateRun(supabase, { runId, runType, forceNew: refreshUrls && !runId });

    const refresh = refreshUrls ? await refreshUrlList(supabase, run.id) : null;
    run = await updateRun(supabase, run.id, { stage: "processing_dragon_details", last_batch_size: batchSize });

    const runStartedAt = run.started_at;
    const results = [];
    let stoppedReason = "batch_complete";

    while (results.length < batchSize) {
      if (Date.now() - startedAtMs > maxMs - 5000) {
        stoppedReason = "time_guard";
        break;
      }

      const nextRows = await getNextCandidates(supabase, Math.min(batchSize - results.length, 10), runStartedAt);
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

      const remainingMidBatch = await countRemainingForRun(supabase, runStartedAt);
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

    const remainingCount = await countRemainingForRun(supabase, runStartedAt);
    const complete = remainingCount === 0;
    const processedCount = Number(run.processed_count || 0) + results.length;
    const successCount = Number(run.success_count || 0) + results.filter((item) => item.ok).length;
    const failureCount = Number(run.failure_count || 0) + results.filter((item) => !item.ok).length;
    const cleanup = complete ? await cleanupOldVanscoData(supabase) : null;

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
      last_result: {
        stoppedReason,
        processedThisBatch: results.length,
        successThisBatch: results.filter((item) => item.ok).length,
        failureThisBatch: results.filter((item) => !item.ok).length,
        usedFallbackCache: Boolean(refresh?.usedFallbackCache),
        cleanup,
      },
    });

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      fetchedAt: nowIso(),
      detailHostPreference: "dragon-first",
      mode: autoScheduled ? "scheduled-safe-live-batch" : "safe-live-batch",
      scheduleDecision,
      run: finalRun,
      runId: run.id,
      batchSize,
      maxMs,
      elapsedMs: Date.now() - startedAtMs,
      refresh,
      cleanup,
      stoppedReason,
      processedCount: results.length,
      successCount: results.filter((item) => item.ok).length,
      failureCount: results.filter((item) => !item.ok).length,
      totalRunProcessedCount: processedCount,
      totalRunSuccessCount: successCount,
      totalRunFailureCount: failureCount,
      remainingUncheckedOrMissingRegCount: remainingCount,
      remainingThisRunCount: remainingCount,
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
        // keep original error response
      }
    }
    response.status(500).json({ ok: false, message: error?.message || "Could not run Vansco live refresh." });
  }
}
