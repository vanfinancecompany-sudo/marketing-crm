import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_at,updated_at,started_at,completed_at,metadata,error_summary";
const ACCEPTED_STATUSES = new Set(["accepted", "sent", "delivered", "opened", "clicked"]);

function json(response, status, payload) {
  response.status(status).json(payload);
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function authorize(request) {
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;
  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function safeCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function summarizeRecipientStatuses(rows = []) {
  const summary = {
    total: rows.length,
    processed: 0,
    pending: 0,
    accepted: 0,
    failed: 0,
    suppressed: 0,
    unknown: 0,
  };
  for (const row of rows) {
    const status = String(row?.status || "").toLowerCase();
    if (status === "pending") {
      summary.pending += 1;
      continue;
    }
    summary.processed += 1;
    if (ACCEPTED_STATUSES.has(status)) summary.accepted += 1;
    if (status === "failed") summary.failed += 1;
    if (status === "skipped_suppressed") summary.suppressed += 1;
    if (status === "submission_unknown") summary.unknown += 1;
  }
  return summary;
}

export function summarizeSendProgress(send = {}, liveRecipients = null) {
  const metadata = send.metadata && typeof send.metadata === "object" ? send.metadata : {};
  const requested = safeCount(send.requested_count);
  const live = liveRecipients && typeof liveRecipients === "object" ? liveRecipients : null;
  const accepted = live ? safeCount(live.accepted) : safeCount(send.sent_count);
  const failed = live ? safeCount(live.failed) : safeCount(send.failed_count);
  const suppressed = live ? safeCount(live.suppressed) : safeCount(metadata.skipped_suppressed_count);
  const unknown = live ? safeCount(live.unknown) : safeCount(metadata.submission_unknown_count);
  const durableProcessed = safeCount(metadata.processed_count);
  const liveProcessed = live ? safeCount(live.processed) : 0;
  const processed = Math.min(
    requested || Number.MAX_SAFE_INTEGER,
    Math.max(liveProcessed, durableProcessed, accepted + failed + suppressed + unknown)
  );
  const pendingFromMetadata = Number(metadata.pending_count);
  const pending = live
    ? Math.max(0, requested - processed)
    : Number.isFinite(pendingFromMetadata) && pendingFromMetadata >= 0
      ? Math.floor(pendingFromMetadata)
      : Math.max(0, requested - processed);
  const progressPercent = requested > 0
    ? Math.max(0, Math.min(100, Math.round((processed / requested) * 100)))
    : 0;
  const status = String(send.status || "unknown");
  const queueState = String(metadata.queue_state || "");
  let phase = status;
  if (status === "sending") phase = processed > 0 ? "sending" : (queueState || "queued");
  if (status === "completed") phase = "completed";
  if (status === "partially_failed") phase = "completed_with_issues";

  return {
    send_id: send.id || "",
    campaign_id: send.campaign_id || "",
    status,
    phase,
    queue_state: queueState,
    requested,
    processed,
    pending,
    accepted,
    failed,
    suppressed,
    unknown,
    progress_percent: progressPercent,
    created_at: send.created_at || "",
    started_at: send.started_at || "",
    completed_at: send.completed_at || "",
    worker_last_run_at: metadata.worker_last_run_at || "",
    error_summary: send.error_summary || "",
  };
}

async function loadSend(supabase, body) {
  const sendId = String(body.send_id || body.sendId || "").trim();
  const campaignId = String(body.campaign_id || body.campaignId || body.id || "").trim();
  if (!sendId && !campaignId) {
    const error = new Error("Send ID or campaign ID is required.");
    error.statusCode = 400;
    throw error;
  }

  let query = supabase
    .from("marketing_email_sends")
    .select(SEND_COLUMNS)
    .eq("send_type", "production");

  if (sendId) {
    query = query.eq("id", sendId).maybeSingle();
  } else {
    query = query.eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  }

  const result = assertSupabase(await query, "Could not load campaign send progress.");
  return result.data || null;
}

async function loadLiveRecipientProgress(supabase, send) {
  if (!send?.id || String(send.status || "") !== "sending") return null;
  const result = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select("status")
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .limit(500),
    "Could not load live recipient progress."
  );
  return summarizeRecipientStatuses(result.data || []);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Campaign send progress access denied." });
    return;
  }
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabase();
    const send = await loadSend(supabase, parseBody(request));
    const liveRecipients = send ? await loadLiveRecipientProgress(supabase, send) : null;
    json(response, 200, {
      ok: true,
      found: Boolean(send),
      send: send || null,
      progress: send ? summarizeSendProgress(send, liveRecipients) : null,
    });
  } catch (error) {
    json(response, error?.statusCode || 500, {
      ok: false,
      message: error?.message || "Campaign send progress could not be loaded.",
    });
  }
}
