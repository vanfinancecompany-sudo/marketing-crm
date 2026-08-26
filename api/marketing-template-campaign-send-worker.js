import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  callEmailProvider,
  renderFrozenCampaign,
} from "./marketing-template-campaign-sends.js";
import {
  activeEmailProvider,
  emailProviderConfig,
} from "../lib/emailProviders/marketingProvider.js";
import {
  assertProductionPersonalization,
  cleanText,
} from "../lib/marketingEmailTemplateRenderer.js";
import {
  normalizeCurrentSendEmail,
} from "../lib/marketingCurrentSendEligibility.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const WORKER_BATCH_SIZE = 40;
const WORKER_CONCURRENCY = 8;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const RECIPIENT_COLUMNS = "id,send_id,campaign_id,send_type,customer_id,email,status,provider_message_id,provider_event_id,failure_reason,first_sent_at,last_event_at,created_at,updated_at,metadata";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const ACCEPTED_STATUSES = new Set(["accepted", "sent", "delivered", "opened", "clicked"]);
const FINAL_STATUSES = new Set(["accepted", "sent", "delivered", "opened", "clicked", "soft_bounced", "hard_bounced", "blocked", "complained", "unsubscribed", "failed", "submission_unknown", "skipped_suppressed", "skipped_duplicate"]);
const EMAIL_SUPPRESSION_TYPES = ["email_unsubscribed", "email_bounced", "manual_suppression", "global_do_not_contact"];

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

function activeSuppressionEntry(value) {
  return value && typeof value === "object" && value.active !== false;
}

function contactIsSuppressed(row = {}) {
  if (String(row.lifecycle_status || "") !== "active") return true;
  if (String(row.marketing_status || "active") !== "active") return true;
  if (!row.email_ready) return true;
  const suppression = row.suppression && typeof row.suppression === "object" ? row.suppression : {};
  return EMAIL_SUPPRESSION_TYPES.some((type) => activeSuppressionEntry(suppression[type]));
}

function unsubscribePayload({ customerId, email, campaignId, sendId, recipientId }) {
  return {
    customer_id: customerId,
    email: normalizeCurrentSendEmail(email),
    campaign_id: campaignId,
    send_id: sendId,
    recipient_id: recipientId,
    exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
  };
}

function publicUnsubscribeUrl(payload) {
  const secret = process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET;
  const base = String(process.env.MARKETING_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!secret || !base) throw new Error("Marketing unsubscribe configuration is incomplete.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${base}/api/marketing-unsubscribe?token=${encodeURIComponent(`${body}.${sig}`)}`;
}

function claimMetadata(row, now, claimId) {
  return {
    ...(row.metadata || {}),
    worker_claim_id: claimId,
    worker_claimed_at: now,
  };
}

function attemptMetadata(row, now) {
  return {
    ...(row.metadata || {}),
    provider_attempt_started_at: now,
  };
}

export function summarizeRecipientRows(rows = []) {
  const counts = {
    total: rows.length,
    pending: 0,
    accepted: 0,
    failed: 0,
    unknown: 0,
    suppressed: 0,
    finished: 0,
  };
  for (const row of rows) {
    const status = String(row.status || "");
    if (status === "pending") counts.pending += 1;
    if (ACCEPTED_STATUSES.has(status)) counts.accepted += 1;
    if (status === "failed") counts.failed += 1;
    if (status === "submission_unknown") counts.unknown += 1;
    if (status === "skipped_suppressed") counts.suppressed += 1;
    if (FINAL_STATUSES.has(status)) counts.finished += 1;
  }
  return counts;
}

async function expireOldPreparations(supabase, now = new Date()) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .select("id,metadata")
      .eq("send_type", "production")
      .eq("status", "preparing")
      .order("created_at", { ascending: true })
      .limit(50),
    "Could not inspect prepared sends."
  );
  let expired = 0;
  for (const send of result.data || []) {
    const expiresAt = new Date(send.metadata?.token_expires_at || 0).getTime();
    if (expiresAt && expiresAt < now.getTime()) {
      const update = await supabase
        .from("marketing_email_sends")
        .update({
          status: "cancelled",
          completed_at: now.toISOString(),
          error_summary: "Preparation expired before confirmation.",
          metadata: { ...(send.metadata || {}), queue_state: "expired" },
        })
        .eq("id", send.id)
        .eq("status", "preparing");
      assertSupabase(update, "Could not expire prepared send.");
      expired += 1;
    }
  }
  return expired;
}

async function loadQueuedSend(supabase) {
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .select(SEND_COLUMNS)
      .eq("send_type", "production")
      .eq("status", "sending")
      .contains("metadata", { dispatch_mode: "queued_worker" })
      .order("created_at", { ascending: true })
      .limit(1),
    "Could not load queued campaign send."
  );
  return (result.data || [])[0] || null;
}

async function recoverStaleClaims(supabase, send, now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const result = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .eq("status", "pending")
      .lt("last_event_at", staleBefore)
      .limit(WORKER_BATCH_SIZE),
    "Could not inspect stale campaign recipient claims."
  );
  let requeued = 0;
  let unknown = 0;
  for (const row of result.data || []) {
    const providerAttemptStartedAt = row.metadata?.provider_attempt_started_at;
    if (providerAttemptStartedAt) {
      const update = await supabase
        .from("marketing_email_send_recipients")
        .update({
          status: "submission_unknown",
          failure_reason: "Worker stopped after provider submission began. Reconcile with the email provider before any retry.",
          last_event_at: now.toISOString(),
          metadata: { ...(row.metadata || {}), recovered_as_unknown_at: now.toISOString() },
        })
        .eq("id", row.id)
        .eq("status", "pending");
      assertSupabase(update, "Could not quarantine stale submitted recipient.");
      unknown += 1;
    } else {
      const update = await supabase
        .from("marketing_email_send_recipients")
        .update({
          last_event_at: null,
          metadata: {
            ...(row.metadata || {}),
            worker_claim_id: null,
            worker_claimed_at: null,
            requeued_at: now.toISOString(),
          },
        })
        .eq("id", row.id)
        .eq("status", "pending");
      assertSupabase(update, "Could not return stale recipient to queue.");
      requeued += 1;
    }
  }
  return { requeued, unknown };
}

async function claimRecipients(supabase, send, now = new Date()) {
  const candidates = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("send_id", send.id)
      .eq("send_type", "production")
      .eq("status", "pending")
      .is("last_event_at", null)
      .order("created_at", { ascending: true })
      .limit(WORKER_BATCH_SIZE),
    "Could not load queued recipients."
  );
  const claimed = [];
  for (const row of candidates.data || []) {
    const claimId = crypto.randomUUID();
    const claimedAt = now.toISOString();
    const result = assertSupabase(
      await supabase
        .from("marketing_email_send_recipients")
        .update({
          last_event_at: claimedAt,
          metadata: claimMetadata(row, claimedAt, claimId),
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .is("last_event_at", null)
        .select(RECIPIENT_COLUMNS)
        .maybeSingle(),
      "Could not claim queued recipient."
    );
    if (result.data) claimed.push(result.data);
  }
  return claimed;
}

async function recipientStillEligible(supabase, recipient) {
  const [latest, permanent] = await Promise.all([
    supabase
      .from("marketing_contacts")
      .select("marketing_status,lifecycle_status,suppression,email_ready,email,email_normalized")
      .eq("customer_id", recipient.customer_id)
      .maybeSingle(),
    supabase
      .from("marketing_suppression_identities")
      .select("id")
      .eq("email_normalized", normalizeCurrentSendEmail(recipient.email))
      .maybeSingle(),
  ]);
  assertSupabase(latest, "Could not recheck recipient suppression.");
  assertSupabase(permanent, "Could not recheck permanent email suppression.");
  const contact = latest.data || {};
  const sameEmail = normalizeCurrentSendEmail(contact.email_normalized || contact.email) === normalizeCurrentSendEmail(recipient.email);
  return Boolean(latest.data && !permanent.data?.id && !contactIsSuppressed(contact) && sameEmail);
}

async function processRecipient(supabase, send, recipient) {
  const now = new Date().toISOString();
  const campaign = send.metadata?.campaign_snapshot;
  const provider = String(send.metadata?.email_provider || activeEmailProvider()).toLowerCase();
  if (!campaign || campaign.id !== send.campaign_id) {
    throw new Error("Queued campaign snapshot is missing or invalid.");
  }

  if (!await recipientStillEligible(supabase, recipient)) {
    assertSupabase(
      await supabase
        .from("marketing_email_send_recipients")
        .update({
          status: "skipped_suppressed",
          failure_reason: "Suppressed or email changed before provider submission.",
          last_event_at: now,
          metadata: { ...(recipient.metadata || {}), skipped_at: now },
        })
        .eq("id", recipient.id)
        .eq("status", "pending"),
      "Could not mark suppressed queued recipient."
    );
    return { status: "skipped_suppressed" };
  }

  const unsubscribeUrl = publicUnsubscribeUrl(unsubscribePayload({
    customerId: recipient.customer_id,
    email: recipient.email,
    campaignId: send.campaign_id,
    sendId: send.id,
    recipientId: recipient.id,
  }));
  const rendered = renderFrozenCampaign(campaign, {
    test: false,
    mode: "recipient",
    unsubscribeUrl,
    values: {
      last_name: recipient.metadata?.last_name || "",
      company: recipient.metadata?.company || "",
      customer_id: recipient.customer_id,
      campaign_name: campaign.name,
    },
  });
  assertProductionPersonalization(rendered);

  const attemptStartedAt = new Date().toISOString();
  const attempt = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .update({
        last_event_at: attemptStartedAt,
        metadata: attemptMetadata(recipient, attemptStartedAt),
      })
      .eq("id", recipient.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle(),
    "Could not mark provider attempt."
  );
  if (!attempt.data) return { status: "lost_claim" };

  try {
    const providerResult = await callEmailProvider({
      to: recipient.email,
      name: recipient.metadata?.name || "Customer",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: ["marketing-crm", "production", send.campaign_id],
      sendType: "production",
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "X-Marketing-Campaign-Id": send.campaign_id,
        "X-Marketing-Send-Id": send.id,
        "X-Marketing-Recipient-Id": recipient.id,
      },
    }, { provider });
    const acceptedAt = new Date().toISOString();
    assertSupabase(
      await supabase
        .from("marketing_email_send_recipients")
        .update({
          status: "accepted",
          provider_message_id: providerResult.messageId || null,
          first_sent_at: acceptedAt,
          last_event_at: acceptedAt,
          failure_reason: null,
          metadata: {
            ...(recipient.metadata || {}),
            provider_attempt_started_at: attemptStartedAt,
            accepted_at: acceptedAt,
            email_provider: provider,
            provider_response: providerResult.response || {},
          },
        })
        .eq("id", recipient.id)
        .eq("status", "pending"),
      "Could not save provider acceptance."
    );
    return { status: "accepted" };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const status = error?.ambiguous ? "submission_unknown" : "failed";
    assertSupabase(
      await supabase
        .from("marketing_email_send_recipients")
        .update({
          status,
          failure_reason: cleanText(error?.message || "Provider submission failed.", 1000),
          last_event_at: finishedAt,
          metadata: {
            ...(recipient.metadata || {}),
            provider_attempt_started_at: attemptStartedAt,
            worker_finished_at: finishedAt,
            email_provider: provider,
          },
        })
        .eq("id", recipient.id)
        .eq("status", "pending"),
      "Could not save provider failure."
    );
    return { status, error: error?.message || "Provider submission failed." };
  }
}

async function mapWithConcurrency(values, concurrency, callback) {
  const queue = [...values];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const value = queue.shift();
      results.push(await callback(value));
    }
  });
  await Promise.all(workers);
  return results;
}

async function updateSendProgress(supabase, send) {
  const recipientResult = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select("status")
      .eq("send_id", send.id)
      .eq("send_type", "production"),
    "Could not calculate campaign send progress."
  );
  const summary = summarizeRecipientRows(recipientResult.data || []);
  const complete = summary.pending === 0 && summary.total >= Number(send.requested_count || 0);
  const finalStatus = complete
    ? (summary.failed || summary.unknown ? (summary.accepted > 0 ? "partially_failed" : "failed") : "completed")
    : "sending";
  const queueState = complete
    ? (summary.failed || summary.unknown ? "attention" : "completed")
    : "sending";
  const errorParts = [];
  if (summary.failed) errorParts.push(`${summary.failed} recipient(s) failed provider submission`);
  if (summary.unknown) errorParts.push(`${summary.unknown} recipient outcome(s) unknown; reconcile before retrying`);
  const now = new Date().toISOString();
  const update = {
    status: finalStatus,
    sent_count: summary.accepted,
    failed_count: summary.failed,
    completed_at: complete ? now : null,
    started_at: send.started_at || now,
    error_summary: errorParts.join("; "),
    metadata: {
      ...(send.metadata || {}),
      queue_state: queueState,
      queued_recipient_count: summary.total,
      processed_count: summary.finished,
      pending_count: summary.pending,
      submission_unknown_count: summary.unknown,
      skipped_suppressed_count: summary.suppressed,
      worker_last_run_at: now,
    },
  };
  const result = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update(update)
      .eq("id", send.id)
      .eq("status", "sending")
      .select(SEND_COLUMNS)
      .maybeSingle(),
    "Could not update queued send progress."
  );
  return { send: result.data || send, summary };
}

async function processOneQueuedSend(supabase) {
  const send = await loadQueuedSend(supabase);
  if (!send) return { processed: false, message: "No queued campaign sends are waiting." };

  const configuredProvider = activeEmailProvider();
  const queuedProvider = String(send.metadata?.email_provider || send.provider || "").toLowerCase();
  if (queuedProvider !== configuredProvider) {
    await supabase
      .from("marketing_email_sends")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_summary: "Email provider changed after this batch was queued. The batch was stopped without retrying recipients.",
        metadata: { ...(send.metadata || {}), queue_state: "attention" },
      })
      .eq("id", send.id)
      .eq("status", "sending");
    return { processed: true, send_id: send.id, stopped: true, reason: "provider_changed" };
  }
  const providerConfig = emailProviderConfig(queuedProvider);
  if (!providerConfig.apiKey || !providerConfig.senderEmail || !providerConfig.senderName) {
    return { processed: true, send_id: send.id, stopped: true, reason: "provider_not_configured" };
  }

  const recovery = await recoverStaleClaims(supabase, send);
  const claimed = await claimRecipients(supabase, send);
  if (claimed.length) {
    await mapWithConcurrency(claimed, WORKER_CONCURRENCY, (recipient) => processRecipient(supabase, send, recipient));
  }
  const progress = await updateSendProgress(supabase, send);
  return {
    processed: true,
    send_id: send.id,
    claimed: claimed.length,
    recovery,
    summary: progress.summary,
    status: progress.send.status,
    queue_state: progress.send.metadata?.queue_state || "",
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Campaign send worker access denied." });
    return;
  }
  if (!new Set(["GET", "POST"]).has(request.method)) {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  try {
    const supabase = getSupabase();
    const expired_preparations = await expireOldPreparations(supabase);
    const result = await processOneQueuedSend(supabase);
    json(response, 200, { ok: true, expired_preparations, ...result });
  } catch (error) {
    console.error("[marketing-template-campaign-send-worker] failed", { message: error?.message || String(error) });
    json(response, 500, { ok: false, message: error?.message || "Campaign send worker failed." });
  }
}
