import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  CampaignValidationError,
  cleanText,
  renderCampaignPreview,
} from "../lib/marketingEmailTemplateRenderer.js";
import {
  SENDGRID_TEST_SENDER_EMAIL,
  sendSendGridEmail,
} from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const TEST_COOLDOWN_MS = 60 * 1000;
const INTERNAL_EMAIL_DOMAINS = new Set(["vanfinancecompany.co.uk", "rent2buyvans.co.uk"]);
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expected) return false;
  const header = request.headers[API_KEY_HEADER] || "";
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return header === expected || bearer === expected;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function assertSupabase(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateEmail(value, label) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, `${label} is not valid.`);
  }
  return email;
}

export function allowedSendGridTestRecipient(requestedValue, configuredValue) {
  const requested = validateEmail(requestedValue, "Test recipient email");
  const configured = validateEmail(configuredValue, "Configured SendGrid test recipient email");
  const domain = configured.split("@")[1] || "";
  return INTERNAL_EMAIL_DOMAINS.has(domain) && requested === configured ? requested : "";
}

async function sendControlledTest(supabase, body = {}) {
  if (!process.env.SENDGRID_API_KEY) throw new ApiError(400, "SendGrid API key is not configured.");
  if (!process.env.SENDGRID_TEST_RECIPIENT_EMAIL) throw new ApiError(400, "SendGrid test recipient is not configured.");
  const recipientEmail = allowedSendGridTestRecipient(body.email || body.recipient_email, process.env.SENDGRID_TEST_RECIPIENT_EMAIL);
  if (!recipientEmail) throw new ApiError(403, "SendGrid test recipient is not the configured internal address.");
  const campaignId = cleanText(body.campaign_id || body.campaignId, 80);
  if (!campaignId) throw new ApiError(400, "Campaign ID is required.");

  const campaignResult = assertSupabase(
    await supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS).eq("id", campaignId).eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE).maybeSingle(),
    "Could not load template campaign."
  );
  const campaign = campaignResult.data;
  if (!campaign) throw new ApiError(404, "Template campaign was not found.");
  if (campaign.status === "archived") throw new ApiError(400, "Archived campaigns cannot send test emails.");

  const since = new Date(Date.now() - TEST_COOLDOWN_MS).toISOString();
  const cooldown = assertSupabase(
    await supabase.from("marketing_email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("send_type", "test").eq("provider", "sendgrid").gte("created_at", since),
    "Could not check SendGrid test-send cooldown."
  );
  if ((cooldown.count || 0) > 0) throw new ApiError(429, "Please wait before sending another SendGrid test email for this campaign.");

  const preview = renderCampaignPreview(campaign);
  const subject = `[SENDGRID TEST] ${preview.subject || campaign.subject_line || "Marketing email"}`;
  const notice = `<p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;text-align:center;">SendGrid test email only. No production unsubscribe or suppression action is included.</p>`;
  const html = String(preview.html || "").replace("</body>", `${notice}</body>`);
  const now = new Date().toISOString();
  const sendResult = assertSupabase(
    await supabase.from("marketing_email_sends").insert({
      campaign_id: campaign.id,
      send_type: "test",
      status: "sending",
      provider: "sendgrid",
      requested_count: 1,
      eligible_count: 1,
      suppressed_count: 0,
      sent_count: 0,
      failed_count: 0,
      skipped_duplicate_count: 0,
      created_by: cleanText(body.created_by || "Marketing CRM SendGrid test", 200),
      started_at: now,
      frozen_subject: subject,
      frozen_preview_text: preview.preview_text || campaign.preview_text || "",
      frozen_html_hash: crypto.createHash("sha256").update(`${subject}\n${html}`).digest("hex"),
      metadata: {
        email_provider: "sendgrid",
        preview_only: true,
        test_recipient_domain: recipientEmail.split("@")[1],
        sender_email: SENDGRID_TEST_SENDER_EMAIL,
      },
    }).select(SEND_COLUMNS).single(),
    "Could not create SendGrid test-send audit record."
  );
  const send = sendResult.data;
  const recipientResult = assertSupabase(
    await supabase.from("marketing_email_send_recipients").insert({
      send_id: send.id,
      campaign_id: campaign.id,
      send_type: "test",
      customer_id: null,
      email: recipientEmail,
      status: "pending",
      metadata: { test: true, preview_only: true, email_provider: "sendgrid" },
    }).select("*").single(),
    "Could not create SendGrid test recipient record."
  );
  const recipient = recipientResult.data;

  let providerAccepted = false;
  try {
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: recipientEmail,
      toName: "Internal test recipient",
      subject,
      html,
      customArgs: {
        marketing_campaign_id: campaign.id,
        marketing_send_id: send.id,
        marketing_recipient_id: recipient.id,
        marketing_send_type: "test",
      },
    });
    providerAccepted = true;
    const completedAt = new Date().toISOString();
    assertSupabase(
      await supabase.from("marketing_email_send_recipients").update({
        status: "accepted",
        provider_message_id: provider.messageId,
        first_sent_at: completedAt,
        metadata: { test: true, preview_only: true, email_provider: "sendgrid", provider_response: provider.response },
      }).eq("id", recipient.id),
      "Could not update SendGrid test recipient."
    );
    assertSupabase(
      await supabase.from("marketing_email_sends").update({ status: "completed", sent_count: 1, completed_at: completedAt }).eq("id", send.id),
      "Could not complete SendGrid test audit record."
    );
    return { send_id: send.id, recipient_id: recipient.id, provider_message_id: provider.messageId, sender_email: SENDGRID_TEST_SENDER_EMAIL };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const recipientStatus = providerAccepted || error?.ambiguous ? "submission_unknown" : "failed";
    await supabase.from("marketing_email_send_recipients").update({ status: recipientStatus, failure_reason: cleanText(error.message, 1000), last_event_at: completedAt }).eq("id", recipient.id);
    await supabase.from("marketing_email_sends").update({ status: "failed", failed_count: 1, completed_at: completedAt, error_summary: cleanText(error.message, 1000) }).eq("id", send.id);
    throw error;
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return json(response, 405, { ok: false, message: "Method not allowed." });
  if (!authorize(request)) return json(response, 401, { ok: false, message: "SendGrid test access denied." });
  try {
    const result = await sendControlledTest(getSupabase(), parseBody(request));
    return json(response, 200, { ok: true, test_only: true, ...result });
  } catch (error) {
    const status = error?.statusCode || (error instanceof CampaignValidationError ? 400 : 500);
    return json(response, status, { ok: false, message: error?.message || "SendGrid test send failed." });
  }
}
