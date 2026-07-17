import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  CampaignValidationError,
  cleanText,
  renderCampaignPreview,
} from "../lib/marketingEmailTemplateRenderer.js";
import { campaignRecipientIdentitySets } from "../lib/customerDatabaseCleanse.js";
import {
  SendGridProviderError,
  sendSendGridEmail,
} from "../lib/emailProviders/sendgrid.js";
import {
  activeEmailProvider,
  emailProviderConfig,
  smtp2goSelected,
} from "../lib/emailProviders/marketingProvider.js";

export { activeEmailProvider, emailProviderConfig, smtp2goSelected } from "../lib/emailProviders/marketingProvider.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const RECIPIENT_COLUMNS = "id,send_id,campaign_id,send_type,customer_id,email,status,provider_message_id,provider_event_id,failure_reason,first_sent_at,last_event_at,created_at,updated_at,metadata";
const PIPELINES = new Set(["all", "finance", "rent2buy", "both"]);
const AUDIENCE_MODES = new Set(["standard", "never_emailed", "recently_imported", "manual_customer_ids", "custom_search"]);
const EMAIL_SUPPRESSION_TYPES = ["email_unsubscribed", "email_bounced", "manual_suppression", "global_do_not_contact"];
const PAGE_SIZE = 1000;
const MAX_PRODUCTION_BATCH_SIZE = 500;
const PREPARE_TOKEN_TTL_MS = 10 * 60 * 1000;
const TEST_COOLDOWN_MS = 60 * 1000;
const SUCCESSFUL_PRODUCTION_STATUSES = ["pending", "accepted", "sent", "delivered", "opened", "clicked", "submission_unknown"];

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

class AmbiguousSubmissionError extends ApiError {
  constructor(message) {
    super(502, message);
    this.name = "AmbiguousSubmissionError";
    this.ambiguous = true;
  }
}

class BrevoHttpError extends ApiError {
  constructor(statusCode, responseBody) {
    const safeBody = cleanText(responseBody || "Empty response body.", 1000);
    super(502, `Brevo HTTP ${statusCode}: ${safeBody}`);
    this.name = "BrevoHttpError";
    this.brevoStatusCode = statusCode;
    this.brevoResponseBody = safeBody;
    this.provider = "brevo";
    this.providerStatusCode = statusCode;
    this.providerResponseBody = safeBody;
  }
}

class SMTP2GOHttpError extends ApiError {
  constructor(statusCode, responseBody) {
    const safeBody = cleanText(responseBody || "Empty response body.", 1000);
    super(502, `SMTP2GO HTTP ${statusCode}: ${safeBody}`);
    this.name = "SMTP2GOHttpError";
    this.provider = "smtp2go";
    this.providerStatusCode = statusCode;
    this.providerResponseBody = safeBody;
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
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;
  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function isMissingSendInfrastructure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("marketing_email_sends")
    || message.includes("marketing_email_send_recipients")
    || message.includes("marketing_email_unsubscribe")
    || message.includes("could not find the function")
    || message.includes("does not exist")
    || message.includes("schema cache");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateEmail(value, label = "Email address") {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, `${label} is not valid.`);
  }
  return email;
}

function safeRecipientEmail(value) {
  const email = normalizeEmail(value);
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeCustomerId(value) {
  return cleanText(value, 80).toUpperCase();
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token) {
  return hashValue(token);
}

function activeSuppressionEntry(value) {
  return value && typeof value === "object" && value.active !== false;
}

function emailSuppressed(row = {}) {
  if (String(row.lifecycle_status || "active") !== "active") return true;
  if (String(row.marketing_status || "active") !== "active") return true;
  const suppression = row.suppression && typeof row.suppression === "object" ? row.suppression : {};
  return EMAIL_SUPPRESSION_TYPES.some((type) => activeSuppressionEntry(suppression[type]));
}

function normalizedFullName(row = {}) {
  return [row.first_name, row.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || row.company || row.customer_id || "Customer";
}

function normalizeAudienceRules(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new ApiError(400, "Audience rules must be an object.");
  const pipeline = cleanText(values.pipeline || "all", 40).toLowerCase();
  const mode = cleanText(values.mode || "standard", 60).toLowerCase();
  const search = cleanText(values.search || "", 120);
  const manualCustomerIds = Array.isArray(values.manual_customer_ids)
    ? values.manual_customer_ids.map(normalizeCustomerId).filter(Boolean)
    : String(values.manual_customer_ids || "").split(/[\s,;]+/).map(normalizeCustomerId).filter(Boolean);

  if (!PIPELINES.has(pipeline)) throw new ApiError(400, "Unsupported audience pipeline.");
  if (!AUDIENCE_MODES.has(mode)) throw new ApiError(400, "Unsupported audience option.");
  if (search && /[%{}"\\]/.test(search)) throw new ApiError(400, "Search contains unsupported characters.");
  if (manualCustomerIds.length > 500) throw new ApiError(400, "Manual customer ID audiences can contain a maximum of 500 IDs.");
  if (new Set(manualCustomerIds).size !== manualCustomerIds.length) throw new ApiError(400, "Manual customer IDs must be unique.");
  for (const id of manualCustomerIds) {
    if (!/^[A-Z0-9_-]{3,80}$/.test(id)) throw new ApiError(400, "Manual customer IDs contain an unsupported value.");
  }
  if (mode === "manual_customer_ids" && !manualCustomerIds.length) throw new ApiError(400, "Enter at least one manual customer ID.");
  if (mode === "custom_search" && !search) throw new ApiError(400, "Enter a custom search term.");
  return { pipeline, mode, manual_customer_ids: manualCustomerIds, search };
}

function recentlyImportedIso() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function applyAudienceFilters(query, rules) {
  query = query.eq("lifecycle_status", "active").eq("email_ready", true);
  if (rules.pipeline !== "all") query = query.eq("pipeline", rules.pipeline);
  if (rules.mode === "recently_imported") query = query.gte("created_at", recentlyImportedIso());
  if (rules.mode === "manual_customer_ids") query = query.in("customer_id", rules.manual_customer_ids);
  if (rules.mode === "custom_search") {
    const term = rules.search.replace(/[%,]/g, "");
    query = query.or(`customer_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,postcode.ilike.%${term}%`);
  }
  return query;
}

async function loadOwnedTemplateCampaign(supabase, id) {
  if (!id) throw new ApiError(400, "Campaign ID is required.");
  const result = await supabase
    .from("marketing_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", id)
    .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE)
    .maybeSingle();
  assertSupabase(result, "Could not load template campaign.");
  if (!result.data) throw new ApiError(404, "Template campaign was not found.");
  return result.data;
}

function campaignAudienceRules(campaign = {}) {
  const rules = campaign.audience_snapshot?.rules;
  if (!rules) throw new ApiError(400, "Campaign does not have saved audience rules.");
  return normalizeAudienceRules(rules);
}

function renderFrozenCampaign(campaign = {}, options = {}) {
  const unsubscribeUrl = options.unsubscribeUrl || "";
  const preview = renderCampaignPreview(campaign);
  const marker = options.test ? "[TEST] " : "";
  const subject = `${marker}${preview.subject || campaign.subject_line || "Marketing email"}`;
  const unsubscribeHtml = unsubscribeUrl
    ? `<p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;text-align:center;">You can unsubscribe from marketing emails here: <a href="${unsubscribeUrl}" style="color:#2563eb;">unsubscribe</a>.</p>`
    : options.test
      ? `<p style="margin:18px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;text-align:center;">Test email only. No production unsubscribe action is included.</p>`
      : "";
  const html = String(preview.html || "").replace("</body>", `${unsubscribeHtml}</body>`);
  return {
    subject,
    preview_text: preview.preview_text || campaign.preview_text || "",
    html,
    html_hash: hashValue(`${subject}\n${html}`),
  };
}

function requireProductionSendConfig(provider = activeEmailProvider()) {
  const config = emailProviderConfig(provider);
  const missing = [];
  if (provider === "smtp2go") {
    if (!process.env.SMTP2GO_API_KEY) missing.push("SMTP2GO_API_KEY");
    if (!process.env.SMTP2GO_SENDER_EMAIL) missing.push("SMTP2GO_SENDER_EMAIL");
    if (!process.env.SMTP2GO_SENDER_NAME) missing.push("SMTP2GO_SENDER_NAME");
  } else if (provider === "brevo") {
    if (!process.env.BREVO_API_KEY) missing.push("BREVO_API_KEY");
    if (!process.env.BREVO_SENDER_EMAIL) missing.push("BREVO_SENDER_EMAIL");
    if (!process.env.BREVO_SENDER_NAME) missing.push("BREVO_SENDER_NAME");
  } else {
    if (!config.apiKey) missing.push("SENDGRID_API_KEY");
    if (!config.senderEmail) missing.push("SendGrid verified sender email");
    if (!config.senderName) missing.push("SendGrid sender name");
    if (!config.webhookVerificationConfigured) missing.push("SENDGRID_WEBHOOK_VERIFICATION_KEY");
  }
  if (!process.env.MARKETING_PUBLIC_BASE_URL) missing.push("MARKETING_PUBLIC_BASE_URL");
  if (!process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET) missing.push("MARKETING_UNSUBSCRIBE_TOKEN_SECRET");
  if (missing.length) throw new ApiError(400, `Production sending is not configured. Missing: ${missing.join(", ")}.`);
}

function emailProviderConfigStatus(provider = activeEmailProvider(), environment = process.env) {
  const config = emailProviderConfig(provider, environment);
  return {
    provider: config.provider,
    configured: Boolean(config.apiKey && config.senderEmail && config.senderName),
    api_key_configured: Boolean(config.apiKey),
    api_key_valid: config.id === "sendgrid" ? config.apiKeyFormatValid : Boolean(config.apiKey),
    sender_email_configured: Boolean(config.senderEmail),
    sender_name: config.senderName || "",
    webhook_verification_configured: config.webhookVerificationConfigured,
    public_base_url_configured: Boolean(process.env.MARKETING_PUBLIC_BASE_URL),
    unsubscribe_secret_configured: Boolean(process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET),
  };
}

function databaseSendProvider(provider) {
  return provider === "sendgrid" ? "sendgrid" : "brevo";
}

async function callBrevoEmail({ to, name, subject, html, tags = [], headers = {} }, options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!environment.BREVO_API_KEY) throw new ApiError(400, "Brevo API key is not configured.");
  if (!environment.BREVO_SENDER_EMAIL || !environment.BREVO_SENDER_NAME) throw new ApiError(400, "Brevo sender is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": environment.BREVO_API_KEY,
      },
      signal: controller.signal,
      body: JSON.stringify({
        sender: { email: environment.BREVO_SENDER_EMAIL, name: environment.BREVO_SENDER_NAME },
        to: [{ email: to, name }],
        subject,
        htmlContent: html,
        tags,
        headers,
      }),
    });
    const text = await response.text().catch(() => {
      throw new AmbiguousSubmissionError("Brevo response could not be read after submission.");
    });
    let data = {};
    if (text) {
      try { data = JSON.parse(text); }
      catch {
        if (response.ok) throw new AmbiguousSubmissionError("Brevo accepted status but returned an unreadable response.");
        data = { message: text.slice(0, 300) };
      }
    }
    if (!response.ok) throw new BrevoHttpError(response.status, text || JSON.stringify(data));
    const messageId = data.messageId || data.messageIds?.[0] || "";
    if (!messageId) throw new AmbiguousSubmissionError("Brevo response did not include a message id.");
    return { messageId, response: data };
  } catch (error) {
    if (error?.name === "AbortError") throw new AmbiguousSubmissionError("Brevo request timed out after submission was attempted.");
    if (error instanceof ApiError) throw error;
    throw new AmbiguousSubmissionError("Brevo submission outcome is unknown due to a network error.");
  } finally {
    clearTimeout(timeout);
  }
}

function smtp2goMailbox(email, name = "") {
  const safeEmail = cleanText(email, 320).replace(/[\r\n<>]/g, "");
  const safeName = cleanText(name, 200).replace(/[\r\n<>"]/g, "");
  return safeName ? `${safeName} <${safeEmail}>` : safeEmail;
}

const SMTP2GO_CORRELATION_HEADERS = [
  "X-Marketing-Campaign-Id",
  "X-Marketing-Send-Id",
  "X-Marketing-Recipient-Id",
];

function smtp2goCustomHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new ApiError(400, "SMTP2GO correlation headers must be an object.");
  return SMTP2GO_CORRELATION_HEADERS.flatMap((header) => {
    const value = headers[header];
    if (value === undefined || value === null || value === "") return [];
    if (typeof value !== "string") throw new ApiError(400, `${header} must be a plain string ID.`);
    const scalarId = value.trim();
    if (!scalarId || !/^[A-Za-z0-9_-]+$/.test(scalarId)) throw new ApiError(400, `${header} must contain a plain scalar ID.`);
    return [{ header, value: scalarId.slice(0, 255) }];
  });
}

async function callSMTP2GO({ to, name, subject, html, text = "", cc = [], bcc = [], replyTo = "", attachments = [], tags = [], headers = {} }, options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!environment.SMTP2GO_API_KEY) throw new ApiError(400, "SMTP2GO API key is not configured.");
  if (!environment.SMTP2GO_SENDER_EMAIL || !environment.SMTP2GO_SENDER_NAME) throw new ApiError(400, "SMTP2GO sender is not configured.");
  const customHeaders = smtp2goCustomHeaders(headers);
  const payload = {
    sender: smtp2goMailbox(environment.SMTP2GO_SENDER_EMAIL, environment.SMTP2GO_SENDER_NAME),
    to: [smtp2goMailbox(to, name)],
    subject,
    html_body: html,
    custom_headers: customHeaders,
  };
  if (text) payload.text_body = text;
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  if (attachments.length) payload.attachments = attachments;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": environment.SMTP2GO_API_KEY,
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    const responseText = await response.text().catch(() => {
      throw new AmbiguousSubmissionError("SMTP2GO response could not be read after submission.");
    });
    let data = {};
    if (responseText) {
      try { data = JSON.parse(responseText); }
      catch {
        if (response.ok) throw new AmbiguousSubmissionError("SMTP2GO accepted status but returned an unreadable response.");
        data = { error: responseText.slice(0, 300) };
      }
    }
    if (!response.ok) throw new SMTP2GOHttpError(response.status, responseText || JSON.stringify(data));
    const succeeded = Number(data?.data?.succeeded || 0);
    const failed = Number(data?.data?.failed || 0);
    const messageId = data?.data?.email_id || "";
    if (failed > 0 || succeeded < 1) throw new SMTP2GOHttpError(response.status, responseText || JSON.stringify(data));
    if (!messageId) throw new AmbiguousSubmissionError("SMTP2GO response did not include an email id.");
    return { messageId, response: data };
  } catch (error) {
    if (error?.name === "AbortError") throw new AmbiguousSubmissionError("SMTP2GO request timed out after submission was attempted.");
    if (error instanceof ApiError) throw error;
    throw new AmbiguousSubmissionError("SMTP2GO submission outcome is unknown due to a network error.");
  } finally {
    clearTimeout(timeout);
  }
}

function sendGridCustomArguments(payload = {}) {
  const headers = payload.headers || {};
  return {
    marketing_campaign_id: headers["X-Marketing-Campaign-Id"] || "",
    marketing_send_id: headers["X-Marketing-Send-Id"] || "",
    marketing_recipient_id: headers["X-Marketing-Recipient-Id"] || "",
    marketing_send_type: payload.sendType || "",
  };
}

export async function callEmailProvider(payload, options = {}) {
  const environment = options.environment || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const provider = options.provider || activeEmailProvider(environment);
  if (provider === "smtp2go") return callSMTP2GO(payload, { environment, fetchImpl });
  if (provider === "brevo") return callBrevoEmail(payload, { environment, fetchImpl });
  if (provider === "sendgrid") {
    const config = emailProviderConfig(provider, environment);
    return sendSendGridEmail({
      apiKey: config.apiKey,
      to: payload.to,
      toName: payload.name,
      subject: payload.subject,
      html: payload.html,
      customArgs: sendGridCustomArguments(payload),
      headers: payload.headers,
      categories: payload.tags,
      fromEmail: config.senderEmail,
      fromName: config.senderName,
      fetchImpl,
    });
  }
  throw new ApiError(400, "Unsupported marketing email provider.");
}

function unsubscribePayload({ customerId, email, campaignId, sendId, recipientId }) {
  const exp = Date.now() + 365 * 24 * 60 * 60 * 1000;
  return { customer_id: customerId, email: normalizeEmail(email), campaign_id: campaignId, send_id: sendId, recipient_id: recipientId, exp };
}

function signUnsubscribeToken(payload) {
  const secret = process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET;
  if (!secret) throw new ApiError(400, "Unsubscribe token secret is not configured.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function publicUnsubscribeUrl(payload) {
  const base = String(process.env.MARKETING_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new ApiError(400, "Public base URL is not configured.");
  return `${base}/api/marketing-unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(payload))}`;
}

async function loadAlreadySentIdentities(supabase, campaignId) {
  const rows = [];
  let from = 0;
  while (true) {
    const result = await supabase
      .from("marketing_email_send_recipients")
      .select("customer_id,email")
      .eq("campaign_id", campaignId)
      .eq("send_type", "production")
      .in("status", SUCCESSFUL_PRODUCTION_STATUSES)
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) {
      if (isMissingSendInfrastructure(result.error)) return { customerIds: new Set(), emails: new Set() };
      throw new Error(result.error.message || "Could not inspect previous sends.");
    }
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return campaignRecipientIdentitySets(rows);
}

async function loadPermanentSuppressedEmails(supabase, values = []) {
  const emails = [...new Set(values.map(safeRecipientEmail).filter(Boolean))];
  const suppressed = new Set();
  for (let index = 0; index < emails.length; index += 250) {
    const result = await supabase
      .from("marketing_suppression_identities")
      .select("email_normalized")
      .in("email_normalized", emails.slice(index, index + 250));
    assertSupabase(result, "Could not check permanent email suppressions.");
    (result.data || []).forEach((row) => {
      const email = safeRecipientEmail(row.email_normalized);
      if (email) suppressed.add(email);
    });
  }
  return suppressed;
}

async function loadExportedEmailContactIds(supabase) {
  const ids = new Set();
  try {
    const campaignResult = await supabase.from("marketing_campaigns").select("id").eq("channel", "email");
    assertSupabase(campaignResult, "Could not inspect exported email campaigns.");
    const campaignIds = (campaignResult.data || []).map((row) => row.id).filter(Boolean);
    for (let index = 0; index < campaignIds.length; index += 100) {
      const batchResult = await supabase
        .from("marketing_campaign_batches")
        .select("id")
        .in("campaign_id", campaignIds.slice(index, index + 100))
        .eq("status", "exported");
      assertSupabase(batchResult, "Could not inspect exported batches.");
      const batchIds = (batchResult.data || []).map((row) => row.id).filter(Boolean);
      for (let batchIndex = 0; batchIndex < batchIds.length; batchIndex += 100) {
        const customerResult = await supabase
          .from("marketing_campaign_batch_customers")
          .select("marketing_contacts!inner(customer_id)")
          .in("batch_id", batchIds.slice(batchIndex, batchIndex + 100));
        assertSupabase(customerResult, "Could not inspect exported customers.");
        (customerResult.data || []).forEach((row) => {
          const contact = Array.isArray(row.marketing_contacts) ? row.marketing_contacts[0] : row.marketing_contacts;
          const customerId = normalizeCustomerId(contact?.customer_id);
          if (customerId) ids.add(customerId);
        });
      }
    }
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("marketing_campaign_batches") && !message.includes("marketing_campaign_batch_customers")) throw error;
  }
  return ids;
}

async function resolveRecipients(supabase, campaign, options = {}) {
  const rules = campaignAudienceRules(campaign);
  const alreadySent = await loadAlreadySentIdentities(supabase, campaign.id);
  const exportedEmailIds = rules.mode === "never_emailed" ? await loadExportedEmailContactIds(supabase) : new Set();
  const byEmail = new Set();
  const byCustomerId = new Set();
  const recipients = [];
  let totalMatching = 0;
  let suppressed = 0;
  let skippedDuplicate = 0;
  let invalidEmail = 0;
  let from = 0;
  while (true) {
    const result = await applyAudienceFilters(
      supabase
        .from("marketing_contacts")
        .select("id,customer_id,first_name,last_name,company,email,email_normalized,marketing_status,lifecycle_status,email_ready,suppression,pipeline,source,created_at")
        .order("customer_id", { ascending: true })
        .order("id", { ascending: true }),
      rules
    ).range(from, from + PAGE_SIZE - 1);
    assertSupabase(result, "Could not resolve campaign recipients.");
    const rows = result.data || [];
    const permanentlySuppressed = await loadPermanentSuppressedEmails(
      supabase,
      rows.map((row) => row.email_normalized || row.email)
    );
    for (const row of rows) {
      const customerId = normalizeCustomerId(row.customer_id);
      if (rules.mode === "never_emailed" && exportedEmailIds.has(customerId)) continue;
      totalMatching += 1;
      const email = safeRecipientEmail(row.email_normalized || row.email);
      if (!row.email_ready || !email) {
        suppressed += 1;
        invalidEmail += 1;
        continue;
      }
      if (emailSuppressed(row) || permanentlySuppressed.has(email)) { suppressed += 1; continue; }
      if (alreadySent.customerIds.has(customerId) || alreadySent.emails.has(email)) { skippedDuplicate += 1; continue; }
      if (byCustomerId.has(customerId) || byEmail.has(email)) { skippedDuplicate += 1; continue; }
      byCustomerId.add(customerId);
      byEmail.add(email);
      if (!options.limit || recipients.length < options.limit) {
        recipients.push({
          id: row.id,
          customer_id: customerId,
          email,
          name: normalizedFullName(row),
          first_name: row.first_name || "",
          last_name: row.last_name || "",
        });
      }
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return {
    rules,
    recipients,
    counts: {
      matching_count: totalMatching,
      suppressed_count: suppressed,
      skipped_duplicate_count: skippedDuplicate,
      invalid_email_count: invalidEmail,
      final_eligible_count: Math.max(0, totalMatching - suppressed - skippedDuplicate),
      resolved_count: recipients.length,
    },
  };
}

export async function providerStatus(environment = process.env, fetchImpl = globalThis.fetch) {
  const provider = activeEmailProvider(environment);
  const status = emailProviderConfigStatus(provider, environment);
  const config = emailProviderConfig(provider, environment);
  let connectivity = "not_configured";
  let message = `${status.provider} is not fully configured.`;
  if (provider === "sendgrid") {
    const mailSendConfigured = status.api_key_valid && status.sender_email_configured && Boolean(status.sender_name);
    connectivity = mailSendConfigured ? "configured" : "not_configured";
    message = mailSendConfigured
      ? "Configured for Mail Send. Provider acceptance is confirmed only by an actual controlled send."
      : status.api_key_configured && !status.api_key_valid
        ? "SendGrid API key format is not valid."
        : "SendGrid Mail Send configuration is incomplete.";
    const safeStatus = { ...status, connectivity, message };
    return { provider_status: safeStatus, brevo: safeStatus };
  }
  if (status.api_key_configured) {
    const request = provider === "smtp2go"
      ? {
          url: "https://api.smtp2go.com/v3/api_keys/permissions",
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": config.apiKey },
          body: "{}",
        }
      : {
            url: "https://api.brevo.com/v3/account",
            method: "GET",
            headers: { "api-key": config.apiKey },
          };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      connectivity = response.ok ? "authorised" : "rejected";
      message = response.ok ? `${status.provider} API key authorised.` : `${status.provider} API key was rejected.`;
    } catch {
      connectivity = "unreachable";
      message = `Could not reach ${status.provider} configuration endpoint.`;
    }
  }
  const safeStatus = { ...status, connectivity, message };
  return { provider_status: safeStatus, brevo: safeStatus };
}

async function getCampaignProgress(supabase, campaign, sends = []) {
  const processedResult = assertSupabase(
    await supabase
      .from("marketing_email_send_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("send_type", "production"),
    "Could not count processed campaign recipients."
  );
  const totalAudience = Number(campaign.audience_snapshot?.final_send_count || 0);
  const alreadyProcessed = Number(processedResult.count || 0);
  const lastBatch = sends.find((send) => send.send_type === "production" && ["sending", "completed", "partially_failed", "failed"].includes(send.status)) || null;
  let lastBatchSummary = null;

  if (lastBatch) {
    const recipientResult = assertSupabase(
      await supabase
        .from("marketing_email_send_recipients")
        .select("status")
        .eq("send_id", lastBatch.id)
        .eq("send_type", "production"),
      "Could not load the latest campaign batch summary."
    );
    const recipientRows = recipientResult.data || [];
    const acceptedStatuses = new Set(["accepted", "sent", "delivered", "opened", "clicked"]);
    lastBatchSummary = {
      sent: recipientRows.length,
      accepted: recipientRows.filter((recipient) => acceptedStatuses.has(recipient.status)).length,
      failed: Number(lastBatch.failed_count || 0),
      suppressed: recipientRows.filter((recipient) => recipient.status === "skipped_suppressed").length,
      completed_at: lastBatch.completed_at || "",
    };
  }

  return {
    total_audience: totalAudience,
    already_processed: alreadyProcessed,
    eligible_remaining: Math.max(0, totalAudience - alreadyProcessed),
    progress_percent: totalAudience > 0 ? Math.min(100, Math.round((alreadyProcessed / totalAudience) * 100)) : 0,
    last_batch: lastBatchSummary,
  };
}

async function listSendHistory(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  try {
    const { data } = assertSupabase(
      await supabase.from("marketing_email_sends").select(SEND_COLUMNS).eq("campaign_id", campaign.id).order("created_at", { ascending: false }).limit(25),
      "Could not load email send history."
    );
    const sends = data || [];
    return {
      sends,
      progress: await getCampaignProgress(supabase, campaign, sends),
      migration_required: false,
    };
  } catch (error) {
    if (isMissingSendInfrastructure(error)) return { sends: [], progress: null, migration_required: true };
    throw error;
  }
}

async function sendTest(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  if (campaign.status === "archived") throw new ApiError(400, "Archived campaigns cannot send test emails.");
  const recipientEmail = validateEmail(body.email || body.recipient_email, "Test recipient email");
  const since = new Date(Date.now() - TEST_COOLDOWN_MS).toISOString();
  try {
    const cooldown = await supabase
      .from("marketing_email_sends")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("send_type", "test")
      .gte("created_at", since);
    assertSupabase(cooldown, "Could not check test-send cooldown.");
    if ((cooldown.count || 0) > 0) throw new ApiError(429, "Please wait before sending another test email for this campaign.");
  } catch (error) {
    if (!isMissingSendInfrastructure(error)) throw error;
    throw new ApiError(400, "Email send migration has not been applied yet.");
  }
  const selectedProvider = activeEmailProvider();
  const rendered = renderFrozenCampaign(campaign, { test: true });
  const now = new Date().toISOString();
  const { data: send } = assertSupabase(
    await supabase.from("marketing_email_sends").insert({
      campaign_id: campaign.id,
      send_type: "test",
      provider: databaseSendProvider(selectedProvider),
      status: "sending",
      requested_count: 1,
      eligible_count: 1,
      suppressed_count: 0,
      sent_count: 0,
      failed_count: 0,
      skipped_duplicate_count: 0,
      created_by: cleanText(body.createdBy || "Marketing CRM", 200),
      started_at: now,
      frozen_subject: rendered.subject,
      frozen_preview_text: rendered.preview_text,
      frozen_html_hash: rendered.html_hash,
      metadata: { test_recipient_domain: recipientEmail.split("@")[1] || "", email_provider: selectedProvider },
    }).select(SEND_COLUMNS).single(),
    "Could not create test-send audit record."
  );
  const { data: recipientRecord } = assertSupabase(
    await supabase.from("marketing_email_send_recipients").insert({
      send_id: send.id,
      campaign_id: campaign.id,
      send_type: "test",
      customer_id: null,
      email: recipientEmail,
      status: "pending",
      metadata: { test: true, email_provider: selectedProvider },
    }).select(RECIPIENT_COLUMNS).single(),
    "Could not create test recipient audit record."
  );
  let provider;
  try {
    provider = await callEmailProvider({
      to: recipientEmail,
      name: "Test recipient",
      subject: rendered.subject,
      html: rendered.html,
      tags: ["marketing-crm", "test", campaign.id],
      sendType: "test",
      headers: {
        "X-Marketing-Campaign-Id": campaign.id,
        "X-Marketing-Send-Id": send.id,
        "X-Marketing-Recipient-Id": recipientRecord.id,
      },
    }, { provider: selectedProvider });
    const completedAt = new Date().toISOString();
    await supabase.from("marketing_email_sends").update({ status: "completed", sent_count: 1, completed_at: completedAt }).eq("id", send.id);
    await supabase.from("marketing_email_send_recipients").update({
      status: "accepted",
      provider_message_id: provider.messageId || null,
      first_sent_at: completedAt,
      metadata: { test: true, email_provider: selectedProvider, provider_response: provider.response || {} },
    }).eq("id", recipientRecord.id);
    return { send: { ...send, status: "completed", sent_count: 1, completed_at: completedAt }, provider_message_id: provider.messageId || "" };
  } catch (error) {
    await supabase.from("marketing_email_send_recipients").update({
      status: error?.ambiguous ? "submission_unknown" : "failed",
      failure_reason: cleanText(error.message, 1000),
      last_event_at: new Date().toISOString(),
    }).eq("id", recipientRecord.id);
    await supabase.from("marketing_email_sends").update({ status: "failed", failed_count: 1, completed_at: new Date().toISOString(), error_summary: error.message }).eq("id", send.id);
    throw error;
  }
}

export function requestedBatchSize(value) {
  const size = Number(value || 25);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PRODUCTION_BATCH_SIZE) {
    throw new ApiError(400, `Batch size must be between 1 and ${MAX_PRODUCTION_BATCH_SIZE}.`);
  }
  return size;
}

function countsMatch(send, counts) {
  return Number(send.metadata?.matching_count || 0) === counts.matching_count
    && Number(send.eligible_count || 0) === counts.final_eligible_count
    && Number(send.suppressed_count || 0) === counts.suppressed_count
    && Number(send.skipped_duplicate_count || 0) === counts.skipped_duplicate_count;
}

async function prepareProductionSend(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  if (campaign.status !== "ready") throw new ApiError(400, "Only Ready campaigns can prepare a production send.");
  if (campaign.status === "archived") throw new ApiError(400, "Archived campaigns cannot send.");
  const selectedProvider = activeEmailProvider();
  requireProductionSendConfig(selectedProvider);
  const batchSize = requestedBatchSize(body.batch_size || body.batchSize);
  const resolved = await resolveRecipients(supabase, campaign);
  if (resolved.counts.final_eligible_count <= 0) throw new ApiError(400, "No eligible recipients remain for this campaign.");
  const selectedCount = Math.min(batchSize, resolved.counts.final_eligible_count, MAX_PRODUCTION_BATCH_SIZE);
  const rendered = renderFrozenCampaign(campaign, { test: false, unsubscribeUrl: "{{unsubscribe_url}}" });
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PREPARE_TOKEN_TTL_MS).toISOString();
  try {
    const { data: send } = assertSupabase(
      await supabase.from("marketing_email_sends").insert({
        campaign_id: campaign.id,
        send_type: "production",
        provider: databaseSendProvider(selectedProvider),
        status: "preparing",
        requested_count: selectedCount,
        eligible_count: resolved.counts.final_eligible_count,
        suppressed_count: resolved.counts.suppressed_count,
        sent_count: 0,
        failed_count: 0,
        skipped_duplicate_count: resolved.counts.skipped_duplicate_count,
        created_by: cleanText(body.createdBy || "Marketing CRM", 200),
        confirmation_token_hash: tokenHash(token),
        frozen_subject: rendered.subject,
        frozen_preview_text: rendered.preview_text,
        frozen_html_hash: rendered.html_hash,
        metadata: {
          token_expires_at: expiresAt,
          audience_rules: resolved.rules,
          matching_count: resolved.counts.matching_count,
          invalid_email_count: resolved.counts.invalid_email_count,
          proposed_batch_size: selectedCount,
          sender_email_configured: emailProviderConfigStatus().sender_email_configured,
          email_provider: selectedProvider,
        },
      }).select(SEND_COLUMNS).single(),
      "Could not create production-send preparation."
    );
    return {
      preparation: {
        send_id: send.id,
        confirmation_token: token,
        expires_at: expiresAt,
        confirmation_phrase: `SEND ${selectedCount}`,
        matching_count: resolved.counts.matching_count,
        suppressed_count: resolved.counts.suppressed_count,
        skipped_duplicate_count: resolved.counts.skipped_duplicate_count,
        invalid_email_count: resolved.counts.invalid_email_count,
        final_eligible_count: resolved.counts.final_eligible_count,
        proposed_batch_size: selectedCount,
        subject: rendered.subject,
        html_hash: rendered.html_hash,
        sender_name: emailProviderConfigStatus().sender_name,
        sender_email_configured: emailProviderConfigStatus().sender_email_configured,
      },
    };
  } catch (error) {
    if (isMissingSendInfrastructure(error)) throw new ApiError(400, "Email send migration has not been applied yet.");
    throw error;
  }
}

async function cancelPreparedSend(supabase, body = {}) {
  const sendId = body.send_id || body.sendId;
  if (!sendId) throw new ApiError(400, "Send ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_email_sends").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", sendId).eq("status", "preparing").select(SEND_COLUMNS).maybeSingle(),
    "Could not cancel prepared send."
  );
  if (!data) throw new ApiError(409, "Prepared send could not be cancelled.");
  return { send: data };
}

async function confirmProductionSend(supabase, body = {}) {
  const sendId = body.send_id || body.sendId;
  const token = String(body.confirmation_token || body.confirmationToken || "");
  const phrase = cleanText(body.confirmation_phrase || body.confirmationPhrase || "", 80);
  const requestedLimit = requestedBatchSize(body.batch_size || body.batchSize);
  if (!sendId || !token) throw new ApiError(400, "Confirmation token is required.");
  const { data: send } = assertSupabase(
    await supabase.from("marketing_email_sends").select(SEND_COLUMNS).eq("id", sendId).maybeSingle(),
    "Could not load prepared send."
  );
  if (!send) throw new ApiError(404, "Prepared send was not found.");
  const selectedProvider = activeEmailProvider();
  const preparedProvider = String(send.metadata?.email_provider || send.provider || "brevo").toLowerCase();
  if (preparedProvider !== selectedProvider) throw new ApiError(409, "Email provider changed after preparation. Prepare the send again.");
  requireProductionSendConfig(preparedProvider);
  if (send.status !== "preparing") throw new ApiError(409, "This send is no longer waiting for confirmation.");
  if (send.confirmation_token_hash !== tokenHash(token)) throw new ApiError(409, "Confirmation token is invalid or has already been used.");
  const expiresAt = new Date(send.metadata?.token_expires_at || 0).getTime();
  if (!expiresAt || Date.now() > expiresAt) throw new ApiError(409, "Confirmation token has expired. Prepare the send again.");
  const campaign = await loadOwnedTemplateCampaign(supabase, send.campaign_id);
  if (campaign.status !== "ready") throw new ApiError(400, "Campaign must still be Ready before sending.");

  const fullRecount = await resolveRecipients(supabase, campaign);
  const finalCount = Math.min(requestedLimit, fullRecount.counts.final_eligible_count, MAX_PRODUCTION_BATCH_SIZE);
  if (finalCount <= 0) throw new ApiError(400, "No eligible recipients remain for this campaign.");
  if (phrase !== `SEND ${finalCount}`) throw new ApiError(409, `Type SEND ${finalCount} to confirm this production batch.`);
  if (finalCount !== Number(send.requested_count || 0) || !countsMatch(send, fullRecount.counts)) {
    await supabase.from("marketing_email_sends").update({ status: "cancelled", completed_at: new Date().toISOString(), error_summary: "Recipient counts changed before confirmation." }).eq("id", send.id);
    throw new ApiError(409, "Recipient counts changed. Prepare the send again.");
  }

  const selectedRecipients = fullRecount.recipients.slice(0, finalCount);
  const claim = assertSupabase(
    await supabase.from("marketing_email_sends").update({ status: "sending", started_at: new Date().toISOString(), confirmation_token_hash: null }).eq("id", send.id).eq("status", "preparing").eq("confirmation_token_hash", tokenHash(token)).select(SEND_COLUMNS),
    "Could not claim prepared send."
  );
  const claimed = (claim.data || [])[0];
  if (!claimed) throw new ApiError(409, "Another request already claimed this send.");

  const renderedBase = renderFrozenCampaign(campaign, { test: false, unsubscribeUrl: "{{unsubscribe_url}}" });
  let sentCount = 0;
  let failedCount = 0;
  let unknownCount = 0;
  let skippedDuplicate = Number(fullRecount.counts.skipped_duplicate_count || 0);
  const failureReasons = [];

  for (const recipient of selectedRecipients) {
    const inserted = await supabase.from("marketing_email_send_recipients").insert({
      send_id: send.id,
      campaign_id: campaign.id,
      send_type: "production",
      customer_id: recipient.customer_id,
      email: recipient.email,
      status: "pending",
      metadata: { name: recipient.name, email_provider: preparedProvider },
    }).select(RECIPIENT_COLUMNS).maybeSingle();
    if (inserted.error) {
      const message = String(inserted.error.message || "").toLowerCase();
      if (message.includes("duplicate") || message.includes("unique")) { skippedDuplicate += 1; continue; }
      throw new Error(inserted.error.message || "Could not reserve recipient.");
    }
    const recipientRecord = inserted.data;
    try {
      const [latest, identity] = await Promise.all([
        supabase.from("marketing_contacts").select("marketing_status,lifecycle_status,suppression,email_ready,email,email_normalized").eq("customer_id", recipient.customer_id).maybeSingle(),
        supabase.from("marketing_suppression_identities").select("id").eq("email_normalized", recipient.email).maybeSingle(),
      ]);
      assertSupabase(latest, "Could not recheck recipient suppression.");
      assertSupabase(identity, "Could not recheck permanent email suppression.");
      const latestContact = latest.data || {};
      if (identity.data?.id || latestContact.lifecycle_status !== "active" || !latestContact.email_ready || emailSuppressed(latestContact) || safeRecipientEmail(latestContact.email_normalized || latestContact.email) !== recipient.email) {
        await supabase.from("marketing_email_send_recipients").update({ status: "skipped_suppressed", failure_reason: "Suppressed or email changed before provider submission." }).eq("id", recipientRecord.id);
        continue;
      }
      const unsubscribeUrl = publicUnsubscribeUrl(unsubscribePayload({ customerId: recipient.customer_id, email: recipient.email, campaignId: campaign.id, sendId: send.id, recipientId: recipientRecord.id }));
      const html = renderedBase.html.replace("{{unsubscribe_url}}", unsubscribeUrl);
      const provider = await callEmailProvider({
        to: recipient.email,
        name: recipient.name,
        subject: renderedBase.subject,
        html,
        tags: ["marketing-crm", "production", campaign.id],
        sendType: "production",
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "X-Marketing-Campaign-Id": campaign.id,
          "X-Marketing-Send-Id": send.id,
          "X-Marketing-Recipient-Id": recipientRecord.id,
        },
      }, { provider: preparedProvider });
      await supabase.from("marketing_email_send_recipients").update({
        status: "accepted",
        provider_message_id: provider.messageId || null,
        first_sent_at: new Date().toISOString(),
        metadata: { name: recipient.name, email_provider: preparedProvider, provider_response: provider.response || {} },
      }).eq("id", recipientRecord.id);
      sentCount += 1;
    } catch (error) {
      if (error?.ambiguous) {
        unknownCount += 1;
        await supabase.from("marketing_email_send_recipients").update({ status: "submission_unknown", failure_reason: cleanText(error.message, 1000), last_event_at: new Date().toISOString() }).eq("id", recipientRecord.id);
      } else {
        failedCount += 1;
        const failureReason = cleanText(error.message, 1000);
        failureReasons.push(failureReason);
        if (error instanceof BrevoHttpError || error instanceof SMTP2GOHttpError || error instanceof SendGridProviderError) {
          console.error(`${emailProviderConfig(preparedProvider).provider} production send rejected`, {
            campaign_id: campaign.id,
            send_id: send.id,
            recipient_id: recipientRecord.id,
            provider: error.provider,
            http_status: error.providerStatusCode,
            ...(error.providerResponseBody ? { response_body: error.providerResponseBody } : {}),
          });
        }
        await supabase.from("marketing_email_send_recipients").update({ status: "failed", failure_reason: failureReason, last_event_at: new Date().toISOString() }).eq("id", recipientRecord.id);
      }
    }
  }

  const finalStatus = failedCount || unknownCount ? (sentCount > 0 ? "partially_failed" : "failed") : "completed";
  const completedAt = new Date().toISOString();
  const errorParts = [];
  if (failedCount) errorParts.push(`${failedCount} recipient(s) failed immediate provider submission`);
  if (failureReasons.length) errorParts.push(`First failure: ${failureReasons[0]}`);
  if (unknownCount) errorParts.push(`${unknownCount} recipient submission outcome(s) unknown; reconcile in ${emailProviderConfig(preparedProvider).provider} before retrying`);
  const { data: updatedSend } = assertSupabase(
    await supabase.from("marketing_email_sends").update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      skipped_duplicate_count: skippedDuplicate,
      completed_at: completedAt,
      metadata: { ...(send.metadata || {}), submission_unknown_count: unknownCount, invalid_email_count: fullRecount.counts.invalid_email_count },
      error_summary: errorParts.join("; "),
    }).eq("id", send.id).select(SEND_COLUMNS).single(),
    "Could not update send audit."
  );
  return { send: updatedSend };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Campaign Sending API access denied." });
    return;
  }
  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "sendHistory";
    let result;
    if (action === "validateAccess") result = {};
    else if (action === "providerStatus" || action === "brevoStatus") result = await providerStatus();
    else if (action === "sendHistory") result = await listSendHistory(supabase, body);
    else if (action === "sendTest") result = await sendTest(supabase, body);
    else if (action === "prepareProductionSend") result = await prepareProductionSend(supabase, body);
    else if (action === "confirmProductionSend" || action === "sendProductionBatch") result = await confirmProductionSend(supabase, body);
    else if (action === "cancelPreparedSend") result = await cancelPreparedSend(supabase, body);
    else throw new ApiError(400, "Unknown Campaign Sending API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error?.statusCode || (error instanceof CampaignValidationError ? 400 : 500);
    json(response, status, { ok: false, message: error?.message || "Campaign Sending API error." });
  }
}
