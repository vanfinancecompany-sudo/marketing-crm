import { createClient } from "@supabase/supabase-js";

const SEND_ID = "93bbe921-e706-4f46-86df-e3857b46a954";
const CONFIRM = "reconcile-93bbe921-v1";
const EXPECTED = { delivered: 465, opened: 18, clicked: 1, soft_bounced: 1 };

function sameDistribution(actual) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(EXPECTED)]);
  for (const key of keys) {
    if (Number(actual[key] || 0) !== Number(EXPECTED[key] || 0)) return false;
  }
  return true;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });
  if (String(request.query?.confirm || "") !== CONFIRM) return response.status(403).json({ ok: false, error: "Confirmation missing." });

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase server configuration.");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const [sendResult, recipientsResult] = await Promise.all([
      supabase
        .from("marketing_email_sends")
        .select("id,status,requested_count,metadata")
        .eq("id", SEND_ID)
        .maybeSingle(),
      supabase
        .from("marketing_email_send_recipients")
        .select("status")
        .eq("send_id", SEND_ID)
        .eq("send_type", "production")
        .limit(600),
    ]);
    if (sendResult.error) throw sendResult.error;
    if (recipientsResult.error) throw recipientsResult.error;
    const send = sendResult.data;
    if (!send) return response.status(404).json({ ok: false, error: "Send not found." });

    if (String(send.status) !== "sending") {
      return response.status(200).json({ ok: true, changed: false, status: send.status, message: "Send is already reconciled or no longer sending." });
    }
    if (String(send?.metadata?.queue_state || "") !== "attention" || Number(send.requested_count) !== 500) {
      return response.status(409).json({ ok: false, error: "Send preconditions changed; reconciliation stopped." });
    }

    const rows = recipientsResult.data || [];
    const distribution = {};
    for (const row of rows) {
      const status = String(row.status || "blank").toLowerCase();
      distribution[status] = (distribution[status] || 0) + 1;
    }
    if (rows.length !== 485 || !sameDistribution(distribution)) {
      return response.status(409).json({ ok: false, error: "Recipient state changed; reconciliation stopped.", total: rows.length, distribution });
    }

    const now = new Date().toISOString();
    const message = "Reconciled stranded send: 485/500 recipients were submitted (465 delivered, 18 opened, 1 clicked, 1 soft bounced); 15 recipients were never reserved. No retry performed to avoid duplicate email.";
    const update = await supabase
      .from("marketing_email_sends")
      .update({
        status: "partially_failed",
        sent_count: 484,
        failed_count: 0,
        completed_at: now,
        error_summary: message,
        metadata: {
          ...(send.metadata || {}),
          queue_state: "reconciled_partial",
          queued_recipient_count: 485,
          processed_count: 485,
          pending_count: 0,
          submission_unknown_count: 0,
          soft_bounced_count: 1,
          unreserved_count: 15,
          reconciled_at: now,
          reconciliation_reason: "legacy_stranded_partial_reservation_with_confirmed_provider_outcomes",
          retry_safe: false,
        },
      })
      .eq("id", SEND_ID)
      .eq("status", "sending")
      .select("id,status,sent_count,failed_count,completed_at,error_summary,metadata")
      .maybeSingle();
    if (update.error) throw update.error;
    if (!update.data) return response.status(409).json({ ok: false, error: "Send changed before reconciliation could be saved." });

    return response.status(200).json({ ok: true, changed: true, send: update.data, distribution });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
