import { randomUUID } from "node:crypto";
import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

function clean(value) {
  return String(value ?? "").trim();
}

function safeJson(value) {
  try { return JSON.parse(JSON.stringify(value ?? null)); }
  catch { return null; }
}

export function createStockWatchTraceId() {
  return randomUUID();
}

export async function writeStockWatchActionLog({
  traceId,
  pipeline,
  action,
  registration,
  authority = "",
  siteId = "",
  status = "started",
  httpStatus = null,
  startedAt = null,
  matchedRecords = null,
  changedRecords = null,
  failureCount = null,
  result = null,
  error = "",
}) {
  const now = new Date();
  const started = startedAt instanceof Date ? startedAt : startedAt ? new Date(startedAt) : now;
  const completed = status === "started" ? null : now;
  const durationMs = completed ? Math.max(0, completed.getTime() - started.getTime()) : null;
  const payload = {
    trace_id: clean(traceId) || createStockWatchTraceId(),
    created_at: started.toISOString(),
    completed_at: completed ? completed.toISOString() : null,
    pipeline: clean(pipeline) || "unknown",
    action: clean(action) || "unknown",
    registration: normalizeRegistration(registration) || null,
    authority: clean(authority) || null,
    site_id: clean(siteId) || null,
    status: clean(status) || "started",
    http_status: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null,
    duration_ms: durationMs,
    matched_records: Number.isFinite(Number(matchedRecords)) ? Number(matchedRecords) : null,
    changed_records: Number.isFinite(Number(changedRecords)) ? Number(changedRecords) : null,
    failure_count: Number.isFinite(Number(failureCount)) ? Number(failureCount) : null,
    result: safeJson(result),
    error: clean(error) || null,
  };

  try {
    const supabase = getSupabaseServiceAdmin();
    if (payload.status === "started") {
      const { error: insertError } = await supabase.from("stock_watch_action_logs").insert(payload);
      if (insertError) throw insertError;
    } else {
      const finalValues = { ...payload };
      delete finalValues.created_at;
      const { data: updated, error: updateError } = await supabase
        .from("stock_watch_action_logs")
        .update(finalValues)
        .eq("trace_id", payload.trace_id)
        .eq("status", "started")
        .select("id")
        .limit(1);
      if (updateError) throw updateError;
      if (!updated?.length) {
        const { error: insertError } = await supabase.from("stock_watch_action_logs").insert(payload);
        if (insertError) throw insertError;
      }
    }
  } catch (logError) {
    console.warn("STOCK WATCH ACTION LOG WRITE FAILED", {
      traceId: payload.trace_id,
      pipeline: payload.pipeline,
      action: payload.action,
      registration: payload.registration,
      message: clean(logError?.message || logError).slice(0, 1000),
    });
  }

  return payload.trace_id;
}
