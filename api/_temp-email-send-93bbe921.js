import { createClient } from "@supabase/supabase-js";

const SEND_ID = "93bbe921-e706-4f46-86df-e3857b46a954";
const ACCEPTED = new Set(["accepted", "sent", "delivered", "opened", "clicked"]);

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase server configuration.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false });

  try {
    const supabase = getSupabase();
    const [sendResult, recipientsResult] = await Promise.all([
      supabase
        .from("marketing_email_sends")
        .select("id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,created_at,updated_at,started_at,completed_at,metadata,error_summary")
        .eq("id", SEND_ID)
        .maybeSingle(),
      supabase
        .from("marketing_email_send_recipients")
        .select("status,provider_message_id,provider_event_id,first_sent_at,last_event_at,metadata")
        .eq("send_id", SEND_ID)
        .eq("send_type", "production")
        .limit(600),
    ]);
    if (sendResult.error) throw sendResult.error;
    if (recipientsResult.error) throw recipientsResult.error;

    const rows = recipientsResult.data || [];
    const counts = {
      total_records: rows.length,
      pending: 0,
      accepted_or_later: 0,
      failed: 0,
      submission_unknown: 0,
      skipped_suppressed: 0,
      skipped_duplicate: 0,
      other: 0,
      with_provider_message_id: 0,
      with_provider_event_id: 0,
      with_first_sent_at: 0,
      with_provider_attempt_started_at: 0,
      pending_with_provider_attempt: 0,
      pending_without_provider_attempt: 0,
    };

    let earliestFirstSent = null;
    let latestFirstSent = null;
    let latestEventAt = null;
    for (const row of rows) {
      const status = String(row.status || "").toLowerCase();
      if (status === "pending") counts.pending += 1;
      else if (ACCEPTED.has(status)) counts.accepted_or_later += 1;
      else if (status === "failed") counts.failed += 1;
      else if (status === "submission_unknown") counts.submission_unknown += 1;
      else if (status === "skipped_suppressed") counts.skipped_suppressed += 1;
      else if (status === "skipped_duplicate") counts.skipped_duplicate += 1;
      else counts.other += 1;

      if (row.provider_message_id) counts.with_provider_message_id += 1;
      if (row.provider_event_id) counts.with_provider_event_id += 1;
      if (row.first_sent_at) {
        counts.with_first_sent_at += 1;
        if (!earliestFirstSent || row.first_sent_at < earliestFirstSent) earliestFirstSent = row.first_sent_at;
        if (!latestFirstSent || row.first_sent_at > latestFirstSent) latestFirstSent = row.first_sent_at;
      }
      const attempted = Boolean(row?.metadata?.provider_attempt_started_at);
      if (attempted) counts.with_provider_attempt_started_at += 1;
      if (status === "pending" && attempted) counts.pending_with_provider_attempt += 1;
      if (status === "pending" && !attempted) counts.pending_without_provider_attempt += 1;
      if (row.last_event_at && (!latestEventAt || row.last_event_at > latestEventAt)) latestEventAt = row.last_event_at;
    }

    const send = sendResult.data || null;
    return response.status(200).json({
      ok: true,
      send: send ? {
        id: send.id,
        campaign_id: send.campaign_id,
        status: send.status,
        provider: send.provider,
        requested_count: send.requested_count,
        eligible_count: send.eligible_count,
        suppressed_count: send.suppressed_count,
        sent_count: send.sent_count,
        failed_count: send.failed_count,
        created_at: send.created_at,
        updated_at: send.updated_at,
        started_at: send.started_at,
        completed_at: send.completed_at,
        queue_state: send?.metadata?.queue_state || null,
        dispatch_mode: send?.metadata?.dispatch_mode || null,
        email_provider: send?.metadata?.email_provider || null,
        processed_count: send?.metadata?.processed_count ?? null,
        pending_count: send?.metadata?.pending_count ?? null,
        worker_last_run_at: send?.metadata?.worker_last_run_at || null,
        orphan_attention_reason: send?.metadata?.orphan_attention_reason || null,
        error_summary: send.error_summary || null,
      } : null,
      counts,
      timing: { earliest_first_sent_at: earliestFirstSent, latest_first_sent_at: latestFirstSent, latest_event_at: latestEventAt },
    });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
