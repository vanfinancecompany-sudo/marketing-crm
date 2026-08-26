import { createClient } from "@supabase/supabase-js";
import campaignSendRouter from "./marketing-template-campaign-sends-router.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const RECOVERY_RECIPIENT_COLUMNS = "id,status,provider_message_id,last_event_at,metadata";
const MAX_PRODUCTION_BATCH_SIZE = 500;

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

export function reservationIsSafeToRecover(send = {}, recipients = []) {
  const metadata = send.metadata && typeof send.metadata === "object" ? send.metadata : {};
  const requested = Number(send.requested_count || 0);
  if (!send.id || String(send.send_type || "") !== "production" || String(send.status || "") !== "sending") return false;
  if (metadata.dispatch_mode === "queued_worker") return false;
  if (metadata.queue_state !== "reserving") return false;
  if (!metadata.campaign_snapshot || metadata.campaign_snapshot.id !== send.campaign_id) return false;
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_PRODUCTION_BATCH_SIZE) return false;
  if (Number(metadata.queued_recipient_count || 0) !== requested) return false;
  if (!Array.isArray(recipients) || recipients.length !== requested) return false;

  return recipients.every((recipient) => {
    const metadata = recipient?.metadata && typeof recipient.metadata === "object" ? recipient.metadata : {};
    return String(recipient?.status || "") === "pending"
      && !recipient?.provider_message_id
      && !recipient?.last_event_at
      && !metadata.provider_attempt_started_at;
  });
}

async function loadRecoveryCandidates(supabase, { sendId = "", campaignId = "" } = {}) {
  if (sendId) {
    const result = assertSupabase(
      await supabase
        .from("marketing_email_sends")
        .select(SEND_COLUMNS)
        .eq("id", sendId)
        .eq("send_type", "production")
        .eq("status", "sending")
        .maybeSingle(),
      "Could not inspect the stranded campaign send."
    );
    return result.data ? [result.data] : [];
  }
  if (!campaignId) return [];
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .select(SEND_COLUMNS)
      .eq("campaign_id", campaignId)
      .eq("send_type", "production")
      .eq("status", "sending")
      .order("created_at", { ascending: false })
      .limit(5),
    "Could not inspect campaign sends for queue recovery."
  );
  return result.data || [];
}

async function loadRecoveryRecipients(supabase, sendId) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select(RECOVERY_RECIPIENT_COLUMNS)
      .eq("send_id", sendId)
      .eq("send_type", "production")
      .limit(MAX_PRODUCTION_BATCH_SIZE),
    "Could not inspect reserved campaign recipients."
  );
  return result.data || [];
}

export async function recoverSafelyReservedQueue(supabase, options = {}) {
  const candidates = await loadRecoveryCandidates(supabase, options);
  for (const send of candidates) {
    const recipients = await loadRecoveryRecipients(supabase, send.id);
    if (!reservationIsSafeToRecover(send, recipients)) continue;

    const now = new Date().toISOString();
    const metadata = {
      ...(send.metadata || {}),
      dispatch_mode: "queued_worker",
      queue_state: "queued",
      processed_count: 0,
      pending_count: Number(send.requested_count || 0),
      worker_last_run_at: null,
      recovered_from_reserving_at: now,
    };
    const recovered = assertSupabase(
      await supabase
        .from("marketing_email_sends")
        .update({ metadata })
        .eq("id", send.id)
        .eq("status", "sending")
        .contains("metadata", { queue_state: "reserving" })
        .select(SEND_COLUMNS)
        .maybeSingle(),
      "Could not recover the safely reserved campaign queue."
    );
    if (recovered.data) {
      console.warn("[campaign-send-hardened] recovered safely reserved queue", {
        send_id: send.id,
        campaign_id: send.campaign_id,
        requested_count: send.requested_count,
      });
      return recovered.data;
    }
  }
  return null;
}

function createCapturedResponse() {
  const capture = {
    statusCode: 200,
    payload: null,
    headers: new Map(),
  };
  const response = {
    setHeader(name, value) {
      capture.headers.set(name, value);
      return response;
    },
    status(code) {
      capture.statusCode = Number(code || 200);
      return response;
    },
    json(payload) {
      capture.payload = payload;
      return response;
    },
  };
  return { response, capture };
}

function forwardCaptured(response, capture) {
  for (const [name, value] of capture.headers.entries()) response.setHeader(name, value);
  json(response, capture.statusCode || 200, capture.payload ?? {});
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const body = parseBody(request);
  const action = body.action || "sendHistory";
  const isAuthorized = authorize(request);

  try {
    if (isAuthorized && action === "sendHistory") {
      await recoverSafelyReservedQueue(getSupabase(), {
        campaignId: String(body.id || body.campaign?.id || "").trim(),
      });
    }

    const { response: capturedResponse, capture } = createCapturedResponse();
    await campaignSendRouter(request, capturedResponse);

    const confirmAction = action === "confirmProductionSend" || action === "sendProductionBatch";
    if (isAuthorized && confirmAction && capture.statusCode >= 500) {
      const recovered = await recoverSafelyReservedQueue(getSupabase(), {
        sendId: String(body.send_id || body.sendId || "").trim(),
      });
      if (recovered) {
        json(response, 200, {
          ok: true,
          send: recovered,
          queued: true,
          queued_count: Number(recovered.requested_count || 0),
          recovered_queue: true,
          message: `Batch queued safely: ${Number(recovered.requested_count || 0)} emails. The background sender will continue automatically.`,
        });
        return;
      }
    }

    forwardCaptured(response, capture);
  } catch (error) {
    console.error("[campaign-send-hardened] failed", { message: error?.message || String(error), action });
    json(response, error?.statusCode || 500, {
      ok: false,
      message: error?.message || "Campaign sending request failed.",
    });
  }
}
