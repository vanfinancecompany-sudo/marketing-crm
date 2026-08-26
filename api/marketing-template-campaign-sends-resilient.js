import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import hardenedCampaignSendHandler from "./marketing-template-campaign-sends-hardened.js";
import {
  createCurrentSendEligibilityState,
  evaluateCurrentSendEligibility,
  loadCurrentSendProcessedIdentities,
  loadPermanentCurrentSendSuppressions,
  normalizeCurrentSendCustomerId,
} from "../lib/marketingCurrentSendEligibility.js";
import {
  loadCampaignContactExclusions,
  matchesMinimumFrequencyLock,
  matchesPreviousCampaignContactExclusion,
  matchesRecentContactExclusion,
} from "../lib/marketingCampaignContactControls.js";
import { cleanText } from "../lib/marketingEmailTemplateRenderer.js";
import { activeEmailProvider, emailProviderConfig } from "../lib/emailProviders/marketingProvider.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const PAGE_SIZE = 1000;
const MAX_BATCH = 500;
const INSERT_CHUNK = 50;

class ApiError extends Error {
  constructor(statusCode, message) { super(message); this.statusCode = statusCode; }
}
function json(res, status, payload) { res.status(status).json(payload); }
function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body !== "string") return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
function authorized(req) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const bearer = String(req.headers.authorization || "").startsWith("Bearer ") ? String(req.headers.authorization).slice(7) : "";
  return Boolean(expected && (req.headers[API_KEY_HEADER] === expected || bearer === expected));
}
function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing server Supabase environment variables.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function ok(result, message) { if (result.error) throw new Error(result.error.message || message); return result; }
function hash(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
function customerId(value) { return normalizeCurrentSendCustomerId(value); }
function metadata(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function batchSize(value) {
  const n = Number(value || 25);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) throw new ApiError(400, `Batch size must be between 1 and ${MAX_BATCH}.`);
  return n;
}
function requireConfig(provider) {
  const config = emailProviderConfig(provider);
  const missing = [];
  if (provider === "sendgrid") {
    if (!config.apiKey) missing.push("SENDGRID_API_KEY");
    if (!config.senderEmail) missing.push("SendGrid verified sender email");
    if (!config.senderName) missing.push("SendGrid sender name");
    if (!config.webhookVerificationConfigured) missing.push("SENDGRID_WEBHOOK_VERIFICATION_KEY");
  } else if (provider === "brevo") {
    if (!process.env.BREVO_API_KEY) missing.push("BREVO_API_KEY");
    if (!process.env.BREVO_SENDER_EMAIL) missing.push("BREVO_SENDER_EMAIL");
    if (!process.env.BREVO_SENDER_NAME) missing.push("BREVO_SENDER_NAME");
  } else if (provider === "smtp2go") {
    if (!process.env.SMTP2GO_API_KEY) missing.push("SMTP2GO_API_KEY");
    if (!process.env.SMTP2GO_SENDER_EMAIL) missing.push("SMTP2GO_SENDER_EMAIL");
    if (!process.env.SMTP2GO_SENDER_NAME) missing.push("SMTP2GO_SENDER_NAME");
  }
  if (!process.env.MARKETING_PUBLIC_BASE_URL) missing.push("MARKETING_PUBLIC_BASE_URL");
  if (!process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET) missing.push("MARKETING_UNSUBSCRIBE_TOKEN_SECRET");
  if (missing.length) throw new ApiError(400, `Production sending is not configured. Missing: ${missing.join(", ")}.`);
}
function applyRules(query, rules) {
  if (rules.pipeline && rules.pipeline !== "all") query = query.eq("pipeline", rules.pipeline);
  if (rules.mode === "recently_imported") query = query.gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
  if (rules.mode === "manual_customer_ids") query = query.in("customer_id", rules.manual_customer_ids || []);
  if (rules.mode === "custom_search" && rules.search) {
    const term = String(rules.search).replace(/[%,]/g, "");
    query = query.or(`customer_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,postcode.ilike.%${term}%`);
  }
  return query;
}
async function exportedIds(supabase) {
  const ids = new Set();
  try {
    const campaigns = ok(await supabase.from("marketing_campaigns").select("id").eq("channel", "email"), "Could not inspect exported email campaigns.");
    const campaignIds = (campaigns.data || []).map((r) => r.id).filter(Boolean);
    for (let i = 0; i < campaignIds.length; i += 100) {
      const batches = ok(await supabase.from("marketing_campaign_batches").select("id").in("campaign_id", campaignIds.slice(i, i + 100)).eq("status", "exported"), "Could not inspect exported batches.");
      const batchIds = (batches.data || []).map((r) => r.id).filter(Boolean);
      for (let j = 0; j < batchIds.length; j += 100) {
        const customers = ok(await supabase.from("marketing_campaign_batch_customers").select("id,marketing_contacts!inner(customer_id)").in("batch_id", batchIds.slice(j, j + 100)), "Could not inspect exported customers.");
        for (const row of customers.data || []) {
          const contact = Array.isArray(row.marketing_contacts) ? row.marketing_contacts[0] : row.marketing_contacts;
          const id = customerId(contact?.customer_id);
          if (id) ids.add(id);
        }
      }
    }
  } catch (error) {
    const text = String(error?.message || "").toLowerCase();
    if (!text.includes("marketing_campaign_batches") && !text.includes("marketing_campaign_batch_customers")) throw error;
  }
  return ids;
}

async function firstEligibleRecipients(supabase, send, campaign, wanted) {
  const rules = metadata(send.metadata).audience_rules || campaign.audience_snapshot?.rules || {};
  const processed = await loadCurrentSendProcessedIdentities(supabase, campaign.id, ok);
  const state = createCurrentSendEligibilityState(processed);
  const excluded = await loadCampaignContactExclusions(supabase, rules, campaign.id, ok);
  const exported = rules.mode === "never_emailed" ? await exportedIds(supabase) : new Set();
  const recipients = [];
  let from = 0;
  while (recipients.length < wanted) {
    const result = ok(await applyRules(
      supabase.from("marketing_contacts")
        .select("id,customer_id,first_name,last_name,company,email,email_normalized,marketing_status,lifecycle_status,email_ready,suppression,pipeline,source,created_at")
        .order("customer_id", { ascending: true }).order("id", { ascending: true }), rules
    ).range(from, from + PAGE_SIZE - 1), "Could not resolve campaign recipients.");
    const rows = result.data || [];
    const permanent = await loadPermanentCurrentSendSuppressions(supabase, rows.map((r) => r.email_normalized || r.email), ok);
    for (const row of rows) {
      const id = customerId(row.customer_id);
      if (rules.mode === "never_emailed" && exported.has(id)) continue;
      const decision = evaluateCurrentSendEligibility(row, { state, permanentlySuppressedEmails: permanent });
      if (!decision.eligible) continue;
      if (matchesPreviousCampaignContactExclusion(row, excluded)) continue;
      if (matchesRecentContactExclusion(row, excluded)) {
        if (matchesMinimumFrequencyLock(row, excluded)) continue;
        continue;
      }
      recipients.push({
        customer_id: id,
        email: decision.email,
        name: [row.first_name, row.last_name].map((x) => String(x || "").trim()).filter(Boolean).join(" ") || row.company || row.customer_id || "Customer",
        first_name: String(row.first_name || "").trim(),
        last_name: String(row.last_name || "").trim(),
        company: String(row.company || "").trim(),
      });
      if (recipients.length >= wanted) break;
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return recipients;
}

async function failSafe(supabase, send, meta, reserved, reason) {
  const deletion = await supabase.from("marketing_email_send_recipients").delete().eq("send_id", send.id).eq("send_type", "production").eq("status", "pending");
  if (deletion.error) console.error("[campaign-send-resilient] cleanup failed", { send_id: send.id, message: deletion.error.message });
  const now = new Date().toISOString();
  await supabase.from("marketing_email_sends").update({
    status: "failed",
    completed_at: now,
    failed_count: 0,
    confirmation_token_hash: null,
    error_summary: `Queue failed before provider submission (${reserved}/${send.requested_count} recipients reserved). No campaign email was submitted; safe to retry.`,
    metadata: { ...meta, queue_state: "retry_safe", dispatch_mode: null, retry_safe: true, queued_recipient_count: 0, reservation_error: cleanText(reason, 700), reservation_failed_at: now },
  }).eq("id", send.id).eq("status", "preparing");
}

export async function queueFast(supabase, body = {}) {
  const sendId = body.send_id || body.sendId;
  const token = String(body.confirmation_token || body.confirmationToken || "");
  const phrase = cleanText(body.confirmation_phrase || body.confirmationPhrase || "", 80);
  const requestedInput = batchSize(body.batch_size || body.batchSize);
  if (!sendId || !token) throw new ApiError(400, "Confirmation token is required.");

  const { data: send } = ok(await supabase.from("marketing_email_sends").select(SEND_COLUMNS).eq("id", sendId).maybeSingle(), "Could not load prepared send.");
  if (!send) throw new ApiError(404, "Prepared send was not found.");
  const provider = String(send.metadata?.email_provider || send.provider || "brevo").toLowerCase();
  if (provider !== activeEmailProvider()) throw new ApiError(409, "Email provider changed after preparation. Prepare the send again.");
  requireConfig(provider);
  if (send.status !== "preparing") throw new ApiError(409, "This send is no longer waiting for confirmation.");
  if (send.confirmation_token_hash !== hash(token)) throw new ApiError(409, "Confirmation token is invalid or has already been used.");
  if (Date.now() > new Date(send.metadata?.token_expires_at || 0).getTime()) throw new ApiError(409, "Confirmation token has expired. Prepare the send again.");
  const requested = Number(send.requested_count || 0);
  if (requestedInput !== requested || phrase !== `SEND ${requested}`) throw new ApiError(409, "Batch confirmation no longer matches the prepared send. Prepare the send again.");

  const campaignResult = ok(await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", send.campaign_id).maybeSingle(), "Could not load campaign snapshot.");
  const campaign = campaignResult.data;
  if (!campaign || campaign.status !== "ready") throw new ApiError(400, "Campaign must still be Ready before sending.");

  const recipients = await firstEligibleRecipients(supabase, send, campaign, requested);
  if (recipients.length !== requested) {
    await supabase.from("marketing_email_sends").update({ status: "cancelled", completed_at: new Date().toISOString(), error_summary: "Eligible audience changed before queueing." }).eq("id", send.id);
    throw new ApiError(409, "The eligible audience changed. Press Send again to use the current audience.");
  }

  const started = new Date().toISOString();
  const reservingMeta = { ...metadata(send.metadata), queue_state: "reserving_fast", dispatch_mode: null, reservation_started_at: started, queued_recipient_count: 0, campaign_snapshot: campaign };
  const claim = ok(await supabase.from("marketing_email_sends").update({ confirmation_token_hash: null, metadata: reservingMeta, error_summary: "" }).eq("id", send.id).eq("status", "preparing").eq("confirmation_token_hash", hash(token)).select("id").maybeSingle(), "Could not claim prepared send.");
  if (!claim.data) throw new ApiError(409, "Another request already claimed this send.");

  const rows = recipients.map((r) => ({
    send_id: send.id, campaign_id: send.campaign_id, send_type: "production", customer_id: r.customer_id, email: r.email, status: "pending",
    metadata: { name: r.name, first_name: r.first_name, last_name: r.last_name, company: r.company, email_provider: provider, queue_state: "queued" },
  }));
  let reserved = 0;
  try {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const inserted = await supabase.from("marketing_email_send_recipients").insert(chunk);
      if (inserted.error) throw new Error(`Recipient chunk ${i / INSERT_CHUNK + 1}: ${inserted.error.message}`);
      reserved += chunk.length;
    }
    const queuedAt = new Date().toISOString();
    const queuedMeta = { ...reservingMeta, dispatch_mode: "queued_worker", queue_state: "queued", queued_at: queuedAt, queued_recipient_count: reserved, processed_count: 0, pending_count: reserved, worker_last_run_at: null };
    const queued = ok(await supabase.from("marketing_email_sends").update({ status: "sending", started_at: queuedAt, metadata: queuedMeta, error_summary: "" }).eq("id", send.id).eq("status", "preparing").select(SEND_COLUMNS).maybeSingle(), "Could not hand queue to background sender.");
    if (!queued.data) throw new Error("Queue handoff lost its claim.");
    console.info("[campaign-send-resilient] queued", { send_id: send.id, requested, reserved });
    return { send: queued.data, queued: true, queued_count: reserved, message: `Batch queued: ${reserved} emails.` };
  } catch (error) {
    console.error("[campaign-send-resilient] reservation failed", { send_id: send.id, requested, reserved, message: error?.message || String(error) });
    await failSafe(supabase, send, reservingMeta, reserved, error?.message || String(error));
    throw new ApiError(500, "The batch did not start. No campaign email was submitted and it is safe to retry.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const body = bodyOf(req);
  const action = body.action || "sendHistory";
  if (req.method === "POST" && (action === "confirmProductionSend" || action === "sendProductionBatch")) {
    if (!authorized(req)) return json(res, 401, { ok: false, message: "Campaign Sending API access denied." });
    try { return json(res, 200, { ok: true, ...(await queueFast(db(), body)) }); }
    catch (error) {
      console.error("[campaign-send-resilient] request failed", { action, message: error?.message || String(error) });
      return json(res, error?.statusCode || 500, { ok: false, message: error?.message || "Campaign queue error." });
    }
  }
  return hardenedCampaignSendHandler(req, res);
}
