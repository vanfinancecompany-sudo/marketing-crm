import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const MAX_BATCH_SIZE = 500;
const MIN_ORPHAN_AGE_MS = 10 * 60 * 1000;
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const RECIPIENT_COLUMNS = "id,status,provider_message_id,provider_event_id,first_sent_at,last_event_at,metadata";

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

function metadataObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function inspectOrphanReservation(send = {}, recipients = [], nowMs = Date.now()) {
  const metadata = metadataObject(send.metadata);
  const requested = Number(send.requested_count || 0);
  const createdAt = new Date(send.created_at || 0).getTime();

  if (!send.id || String(send.send_type || "") !== "production" || String(send.status || "") !== "sending") {
    return { action: "ignore", reason: "not_sending_production" };
  }
  if (metadata.dispatch_mode === "queued_worker") return { action: "ignore", reason: "already_queued" };
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_BATCH_SIZE) {
    return { action: "ignore", reason: "invalid_requested_count" };
  }
  if (!createdAt || nowMs - createdAt < MIN_ORPHAN_AGE_MS) {
    return { action: "wait", reason: "too_new" };
  }
  if (!Array.isArray(recipients)) return { action: "ignore", reason: "recipient_state_missing" };

  const ambiguous = recipients.some((recipient) => {
    const recipientMetadata = metadataObject(recipient?.metadata);
    return String(recipient?.status || "") !== "pending"
      || Boolean(recipient?.provider_message_id)
      || Boolean(recipient?.provider_event_id)
      || Boolean(recipient?.first_sent_at)
      || Boolean(recipient?.last_event_at)
      || Boolean(recipientMetadata.provider_attempt_started_at);
  });
  if (ambiguous) {
    return { action: "attention", reason: "provider_evidence_present", reserved: recipients.length, requested };
  }

  const hasUsableSnapshot = Boolean(metadata.campaign_snapshot && metadata.campaign_snapshot.id === send.campaign_id);
  if (recipients.length === requested && hasUsableSnapshot) {
    return { action: "queue", reason: "fully_reserved_pristine", reserved: recipients.length, requested };
  }
  if (recipients.length <= requested) {
    return {
      action: "release",
      reason: recipients.length === requested ? "missing_campaign_snapshot" : "incomplete_pristine_reservation",
      reserved: recipients.length,
      requested,
    };
  }
  return { action: "attention", reason: "reservation_count_exceeds_request", reserved: recipients.length, requested };
}

async function loadOrphans(supabase) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .select(SEND_COLUMNS)
      .eq("send_type", "production")
      .eq("status", "sending")
      .order("created_at", { ascending: true })
      .limit(20),
    "Could not inspect sending campaign rows."
  );
  return (result.data || []).filter((send) => metadataObject(send.metadata).dispatch_mode !== "queued_worker");
}

async function loadRecipients(supabase, sendId) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("send_id", sendId)
      .eq("send_type", "production")
      .limit(MAX_BATCH_SIZE + 1),
    "Could not inspect stranded campaign recipients."
  );
  return result.data || [];
}

async function queuePristineReservation(supabase, send, decision, now) {
  const metadata = {
    ...metadataObject(send.metadata),
    dispatch_mode: "queued_worker",
    queue_state: "queued",
    queued_recipient_count: decision.reserved,
    processed_count: 0,
    pending_count: decision.reserved,
    worker_last_run_at: null,
    orphan_recovered_at: now,
  };
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({ metadata, error_summary: "" })
      .eq("id", send.id)
      .eq("status", "sending")
      .select("id")
      .maybeSingle(),
    "Could not hand the pristine reservation to the background worker."
  );
  return Boolean(result.data);
}

async function releaseIncompleteReservation(supabase, send, decision, now) {
  if (decision.reserved > 0) {
    const removal = await supabase
      .from("marketing_email_send_recipients")
      .delete()
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .eq("status", "pending");
    assertSupabase(removal, "Could not release incomplete pending reservations.");
  }

  const message = `Queue reservation stopped before provider submission (${decision.reserved}/${decision.requested} recipients reserved; ${decision.reason}). No email was submitted by this batch; it is safe to retry.`;
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({
        status: "failed",
        failed_count: 0,
        completed_at: now,
        error_summary: message,
        metadata: {
          ...metadataObject(send.metadata),
          queue_state: "retry_safe",
          dispatch_mode: null,
          queued_recipient_count: 0,
          processed_count: 0,
          pending_count: 0,
          orphan_released_at: now,
          orphan_release_reason: decision.reason,
          retry_safe: true,
        },
      })
      .eq("id", send.id)
      .eq("status", "sending")
      .select("id")
      .maybeSingle(),
    "Could not close the incomplete stranded batch."
  );
  return Boolean(result.data);
}

async function markAttention(supabase, send, decision, now) {
  const message = `Stranded queue requires reconciliation before retrying (${decision.reserved}/${decision.requested} recipient records; ${decision.reason}).`;
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({
        error_summary: message,
        metadata: {
          ...metadataObject(send.metadata),
          queue_state: "attention",
          orphan_attention_at: now,
          orphan_attention_reason: decision.reason,
        },
      })
      .eq("id", send.id)
      .eq("status", "sending")
      .select("id")
      .maybeSingle(),
    "Could not mark ambiguous stranded batch for attention."
  );
  return Boolean(result.data);
}

async function repairOne(supabase, send) {
  const recipients = await loadRecipients(supabase, send.id);
  const decision = inspectOrphanReservation(send, recipients);
  const now = new Date().toISOString();
  if (decision.action === "wait" || decision.action === "ignore") return { send_id: send.id, ...decision };

  if (decision.action === "queue") {
    const changed = await queuePristineReservation(supabase, send, decision, now);
    return { send_id: send.id, ...decision, changed };
  }
  if (decision.action === "release") {
    const changed = await releaseIncompleteReservation(supabase, send, decision, now);
    return { send_id: send.id, ...decision, changed };
  }
  const changed = await markAttention(supabase, send, decision, now);
  return { send_id: send.id, ...decision, changed };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Campaign orphan worker access denied." });
    return;
  }
  if (!new Set(["GET", "POST"]).has(request.method)) {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabase();
    const sends = await loadOrphans(supabase);
    const results = [];
    for (const send of sends) results.push(await repairOne(supabase, send));
    console.warn("[campaign-orphan-worker] scan", { inspected: sends.length, results });
    json(response, 200, { ok: true, inspected: sends.length, results });
  } catch (error) {
    console.error("[campaign-orphan-worker] failed", { message: error?.message || String(error) });
    json(response, 500, { ok: false, message: error?.message || "Campaign orphan recovery failed." });
  }
}
