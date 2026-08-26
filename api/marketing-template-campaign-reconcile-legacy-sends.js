import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const LEGACY_STALE_MS = 30 * 60 * 1000;
const MAX_CANDIDATES_PER_RUN = 50;
const MAX_RECONCILIATIONS_PER_RUN = 20;

const PROVIDER_SUBMITTED_STATUSES = new Set([
  "accepted",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "soft_bounced",
  "hard_bounced",
  "blocked",
  "complained",
  "unsubscribed",
]);

function json(response, status, payload) {
  response.status(status).json(payload);
}

function authorize(request) {
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET;
  const marketingKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  return Boolean(
    (cronSecret && bearer === cronSecret) ||
    (marketingKey && (request.headers[API_KEY_HEADER] === marketingKey || bearer === marketingKey))
  );
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

function dateMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isStaleLegacySend(send = {}, now = new Date()) {
  if (String(send.send_type || "") !== "production") return false;
  if (String(send.status || "") !== "sending") return false;
  if (send.metadata?.dispatch_mode === "queued_worker") return false;
  const activityAt = dateMs(send.started_at || send.updated_at || send.created_at);
  return Boolean(activityAt && activityAt <= now.getTime() - LEGACY_STALE_MS);
}

export function summarizeLegacyRecipients(rows = [], requestedCount = 0) {
  let submitted = 0;
  let failed = 0;
  let unknown = 0;
  let pendingWithProviderId = 0;
  let pendingWithoutProviderId = 0;
  let other = 0;

  for (const row of rows) {
    const status = String(row.status || "");
    const providerMessageId = String(row.provider_message_id || "").trim();
    if (PROVIDER_SUBMITTED_STATUSES.has(status)) {
      submitted += 1;
    } else if (status === "pending" && providerMessageId) {
      submitted += 1;
      pendingWithProviderId += 1;
    } else if (status === "pending") {
      unknown += 1;
      pendingWithoutProviderId += 1;
    } else if (status === "submission_unknown") {
      unknown += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      other += 1;
      failed += 1;
    }
  }

  const requested = Math.max(Number(requestedCount || 0), rows.length);
  const unclaimed = Math.max(0, requested - rows.length);
  const notSubmitted = Math.max(0, requested - submitted);
  return {
    requested,
    recorded: rows.length,
    submitted,
    failed,
    unknown,
    other,
    pending_with_provider_id: pendingWithProviderId,
    pending_without_provider_id: pendingWithoutProviderId,
    unclaimed,
    not_submitted: notSubmitted,
  };
}

async function normalizePendingRows(supabase, sendId, rows, nowIso) {
  for (const row of rows) {
    if (String(row.status || "") !== "pending") continue;
    const providerMessageId = String(row.provider_message_id || "").trim();
    if (providerMessageId) {
      assertSupabase(
        await supabase
          .from("marketing_email_send_recipients")
          .update({
            status: "accepted",
            first_sent_at: row.first_sent_at || nowIso,
            last_event_at: row.last_event_at || nowIso,
            failure_reason: null,
            metadata: {
              ...(row.metadata || {}),
              legacy_reconciled_at: nowIso,
              legacy_reconciliation: "provider_message_id_preserved",
            },
          })
          .eq("id", row.id)
          .eq("send_id", sendId)
          .eq("status", "pending"),
        "Could not preserve a legacy provider-accepted recipient."
      );
    } else {
      assertSupabase(
        await supabase
          .from("marketing_email_send_recipients")
          .update({
            status: "submission_unknown",
            failure_reason: "Legacy synchronous campaign stopped before the provider outcome was recorded. Quarantined from automatic retry.",
            last_event_at: row.last_event_at || nowIso,
            metadata: {
              ...(row.metadata || {}),
              legacy_reconciled_at: nowIso,
              legacy_reconciliation: "submission_outcome_unknown",
            },
          })
          .eq("id", row.id)
          .eq("send_id", sendId)
          .eq("status", "pending"),
        "Could not quarantine an ambiguous legacy recipient."
      );
    }
  }
}

async function reconcileOne(supabase, send, now = new Date()) {
  const nowIso = now.toISOString();
  const recipientResult = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select("id,status,provider_message_id,first_sent_at,last_event_at,metadata")
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .order("created_at", { ascending: true })
      .limit(1000),
    "Could not inspect legacy campaign recipients."
  );
  const rows = recipientResult.data || [];
  const before = summarizeLegacyRecipients(rows, send.requested_count);

  await normalizePendingRows(supabase, send.id, rows, nowIso);

  const refreshedResult = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select("id,status,provider_message_id,first_sent_at,last_event_at,metadata")
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .limit(1000),
    "Could not verify reconciled legacy campaign recipients."
  );
  const after = summarizeLegacyRecipients(refreshedResult.data || [], send.requested_count);

  const finalStatus = after.submitted > 0 && after.not_submitted === 0
    ? "completed"
    : (after.submitted > 0 ? "partially_failed" : "failed");
  const errorParts = ["Legacy synchronous campaign was interrupted before completion."];
  if (after.submitted) errorParts.push(`${after.submitted} provider-submitted recipient(s) preserved.`);
  if (after.unknown) errorParts.push(`${after.unknown} ambiguous recipient submission(s) quarantined from automatic retry.`);
  if (after.unclaimed) errorParts.push(`${after.unclaimed} recipient(s) were never claimed by the interrupted send and remain eligible for a future batch.`);
  if (after.failed) errorParts.push(`${after.failed} recorded recipient(s) failed before provider acceptance.`);

  const updateResult = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({
        status: finalStatus,
        sent_count: after.submitted,
        failed_count: after.not_submitted,
        completed_at: nowIso,
        error_summary: errorParts.join(" "),
        metadata: {
          ...(send.metadata || {}),
          queue_state: "legacy_reconciled",
          legacy_reconciled_at: nowIso,
          legacy_reconciliation_version: 1,
          legacy_reconciliation_before: before,
          legacy_reconciliation_after: after,
        },
      })
      .eq("id", send.id)
      .eq("status", "sending")
      .select("id,status,sent_count,failed_count,completed_at,error_summary,metadata")
      .maybeSingle(),
    "Could not close a stranded legacy campaign send."
  );

  if (!updateResult.data) {
    return { id: send.id, skipped: true, reason: "status_changed_during_reconciliation" };
  }

  return {
    id: send.id,
    status: updateResult.data.status,
    sent_count: updateResult.data.sent_count,
    failed_count: updateResult.data.failed_count,
    recorded_recipients: after.recorded,
    unknown_recipients: after.unknown,
    unclaimed_recipients: after.unclaimed,
  };
}

async function reconcileLegacySends(supabase, now = new Date()) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .select("id,send_type,status,requested_count,created_at,updated_at,started_at,metadata")
      .eq("send_type", "production")
      .eq("status", "sending")
      .order("created_at", { ascending: true })
      .limit(MAX_CANDIDATES_PER_RUN),
    "Could not inspect stranded legacy campaign sends."
  );

  const stale = (result.data || [])
    .filter((send) => isStaleLegacySend(send, now))
    .slice(0, MAX_RECONCILIATIONS_PER_RUN);
  const reconciled = [];
  for (const send of stale) {
    reconciled.push(await reconcileOne(supabase, send, now));
  }
  return {
    candidates: (result.data || []).length,
    stale_legacy: stale.length,
    reconciled,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Legacy campaign reconciliation access denied." });
    return;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabase();
    const result = await reconcileLegacySends(supabase);
    console.log("[marketing-template-campaign-reconcile-legacy-sends]", JSON.stringify(result));
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    console.error("[marketing-template-campaign-reconcile-legacy-sends] failed", {
      message: error?.message || String(error),
    });
    json(response, 500, { ok: false, message: error?.message || "Legacy campaign reconciliation failed." });
  }
}
