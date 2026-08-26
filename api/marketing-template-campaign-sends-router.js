import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import legacyCampaignSendHandler from "./marketing-template-campaign-sends.js";
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
  normalizeCampaignContactControls,
} from "../lib/marketingCampaignContactControls.js";
import { cleanText } from "../lib/marketingEmailTemplateRenderer.js";
import {
  activeEmailProvider,
  emailProviderConfig,
} from "../lib/emailProviders/marketingProvider.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const CAMPAIGN_COLUMNS = "id,name,description,channel,objective,status,tags,metadata,created_by,created_at,updated_at,archived_at,campaign_type,template_id,template_name,template_snapshot,subject_line,preview_text,audience_snapshot";
const SEND_COLUMNS = "id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_by,created_at,updated_at,started_at,completed_at,confirmation_token_hash,frozen_subject,frozen_preview_text,frozen_html_hash,metadata,error_summary";
const PIPELINES = new Set(["all", "finance", "rent2buy", "both"]);
const AUDIENCE_MODES = new Set(["standard", "never_emailed", "recently_imported", "manual_customer_ids", "custom_search"]);
const PAGE_SIZE = 1000;
const MAX_PRODUCTION_BATCH_SIZE = 500;

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

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

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeCustomerId(value) {
  return normalizeCurrentSendCustomerId(value);
}

function recentlyImportedIso() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
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
  const contactControls = normalizeCampaignContactControls(values, (message) => new ApiError(400, message));
  return { pipeline, mode, manual_customer_ids: manualCustomerIds, search, ...contactControls };
}

function applyAudienceFilters(query, rules) {
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
          .select("id,marketing_contacts!inner(customer_id)")
          .in("batch_id", batchIds.slice(batchIndex, batchIndex + 100));
        assertSupabase(customerResult, "Could not inspect exported customers.");
        for (const row of customerResult.data || []) {
          const contact = Array.isArray(row.marketing_contacts) ? row.marketing_contacts[0] : row.marketing_contacts;
          const customerId = normalizeCustomerId(contact?.customer_id);
          if (customerId) ids.add(customerId);
        }
      }
    }
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("marketing_campaign_batches") && !message.includes("marketing_campaign_batch_customers")) throw error;
  }
  return ids;
}

async function resolveRecipients(supabase, campaign) {
  const rules = campaignAudienceRules(campaign);
  const alreadySent = await loadCurrentSendProcessedIdentities(supabase, campaign.id, assertSupabase);
  const exportedEmailIds = rules.mode === "never_emailed" ? await loadExportedEmailContactIds(supabase) : new Set();
  const contactExclusions = await loadCampaignContactExclusions(supabase, rules, campaign.id, assertSupabase);
  const eligibilityState = createCurrentSendEligibilityState(alreadySent);
  const recipients = [];
  let totalMatching = 0;
  let suppressed = 0;
  let skippedDuplicate = 0;
  let invalidEmail = 0;
  let previousCampaignExcluded = 0;
  let eligibleBeforeRecentContact = 0;
  let minimumFrequencyLockExcluded = 0;
  let additionalRecentContactExcluded = 0;
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
    const permanentlySuppressed = await loadPermanentCurrentSendSuppressions(
      supabase,
      rows.map((row) => row.email_normalized || row.email),
      assertSupabase
    );
    for (const row of rows) {
      const customerId = normalizeCustomerId(row.customer_id);
      if (rules.mode === "never_emailed" && exportedEmailIds.has(customerId)) continue;
      totalMatching += 1;
      const decision = evaluateCurrentSendEligibility(row, { state: eligibilityState, permanentlySuppressedEmails: permanentlySuppressed });
      if (!decision.eligible) {
        if (decision.reason === "invalid_email") invalidEmail += 1;
        if (["inactive", "invalid_email", "suppressed"].includes(decision.reason)) suppressed += 1;
        else skippedDuplicate += 1;
        continue;
      }
      if (matchesPreviousCampaignContactExclusion(row, contactExclusions)) {
        previousCampaignExcluded += 1;
        continue;
      }
      eligibleBeforeRecentContact += 1;
      if (matchesRecentContactExclusion(row, contactExclusions)) {
        if (matchesMinimumFrequencyLock(row, contactExclusions)) minimumFrequencyLockExcluded += 1;
        else additionalRecentContactExcluded += 1;
        continue;
      }
      recipients.push({
        customer_id: customerId,
        email: decision.email,
        name: [row.first_name, row.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || row.company || row.customer_id || "Customer",
        first_name: String(row.first_name || "").trim(),
        last_name: String(row.last_name || "").trim(),
        company: String(row.company || "").trim(),
      });
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
      history_excluded_count: previousCampaignExcluded + minimumFrequencyLockExcluded + additionalRecentContactExcluded,
      previous_campaign_excluded_count: previousCampaignExcluded,
      eligible_before_recent_contact_restriction: eligibleBeforeRecentContact,
      minimum_frequency_lock_excluded_count: minimumFrequencyLockExcluded,
      additional_recent_contact_excluded_count: additionalRecentContactExcluded,
      recent_contact_excluded_count: minimumFrequencyLockExcluded + additionalRecentContactExcluded,
      invalid_email_count: invalidEmail,
      final_eligible_count: Math.max(0, eligibleBeforeRecentContact - minimumFrequencyLockExcluded - additionalRecentContactExcluded),
    },
  };
}

function requestedBatchSize(value) {
  const size = Number(value || 25);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PRODUCTION_BATCH_SIZE) {
    throw new ApiError(400, `Batch size must be between 1 and ${MAX_PRODUCTION_BATCH_SIZE}.`);
  }
  return size;
}

function countsMatch(send, counts) {
  const totalSkipped = counts.skipped_duplicate_count + counts.history_excluded_count;
  return Number(send.metadata?.matching_count || 0) === counts.matching_count
    && Number(send.eligible_count || 0) === counts.final_eligible_count
    && Number(send.suppressed_count || 0) === counts.suppressed_count
    && Number(send.skipped_duplicate_count || 0) === totalSkipped
    && Number(send.metadata?.history_excluded_count || 0) === counts.history_excluded_count
    && Number(send.metadata?.eligible_before_recent_contact_restriction || 0) === counts.eligible_before_recent_contact_restriction
    && Number(send.metadata?.minimum_frequency_lock_excluded_count || 0) === counts.minimum_frequency_lock_excluded_count
    && Number(send.metadata?.additional_recent_contact_excluded_count || 0) === counts.additional_recent_contact_excluded_count;
}

function requireProductionSendConfig(provider) {
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

async function queueProductionSend(supabase, body = {}) {
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
    await supabase.from("marketing_email_sends").update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_summary: "Recipient counts changed before confirmation.",
    }).eq("id", send.id);
    throw new ApiError(409, "Recipient counts changed. Prepare the send again.");
  }

  const selectedRecipients = fullRecount.recipients.slice(0, finalCount);
  const reservingMetadata = {
    ...(send.metadata || {}),
    queue_state: "reserving",
    queued_at: new Date().toISOString(),
    queued_recipient_count: finalCount,
    campaign_snapshot: campaign,
  };
  const claim = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({
        status: "sending",
        started_at: null,
        completed_at: null,
        confirmation_token_hash: null,
        metadata: reservingMetadata,
        error_summary: "",
      })
      .eq("id", send.id)
      .eq("status", "preparing")
      .eq("confirmation_token_hash", tokenHash(token))
      .select(SEND_COLUMNS)
      .maybeSingle(),
    "Could not reserve prepared send."
  );
  if (!claim.data) throw new ApiError(409, "Another request already claimed this send.");

  const recipientRows = selectedRecipients.map((recipient) => ({
    send_id: send.id,
    campaign_id: campaign.id,
    send_type: "production",
    customer_id: recipient.customer_id,
    email: recipient.email,
    status: "pending",
    metadata: {
      name: recipient.name,
      first_name: recipient.first_name,
      last_name: recipient.last_name,
      company: recipient.company,
      email_provider: preparedProvider,
      queue_state: "queued",
    },
  }));
  try {
    assertSupabase(
      await supabase.from("marketing_email_send_recipients").insert(recipientRows),
      "Could not queue campaign recipients."
    );
  } catch (error) {
    await supabase.from("marketing_email_sends").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: `Recipients could not be safely queued: ${cleanText(error?.message || "Unknown queue error", 700)}`,
      metadata: { ...reservingMetadata, queue_state: "attention" },
    }).eq("id", send.id).eq("status", "sending");
    throw error;
  }

  const queuedMetadata = {
    ...reservingMetadata,
    dispatch_mode: "queued_worker",
    queue_state: "queued",
    processed_count: 0,
    pending_count: finalCount,
    worker_last_run_at: null,
  };
  const queued = assertSupabase(
    await supabase
      .from("marketing_email_sends")
      .update({ metadata: queuedMetadata })
      .eq("id", send.id)
      .eq("status", "sending")
      .select(SEND_COLUMNS)
      .single(),
    "Could not finalize campaign queue."
  );
  return {
    send: queued.data,
    queued: true,
    queued_count: finalCount,
    message: `Batch queued: ${finalCount} emails. You can leave this page while they send in the background.`,
  };
}

export default async function handler(request, response) {
  const body = parseBody(request);
  const action = body.action || "sendHistory";
  if (request.method === "POST" && (action === "confirmProductionSend" || action === "sendProductionBatch")) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    if (!authorize(request)) {
      json(response, 401, { ok: false, message: "Campaign Sending API access denied." });
      return;
    }
    try {
      const result = await queueProductionSend(getSupabase(), body);
      json(response, 200, { ok: true, ...result });
    } catch (error) {
      json(response, error?.statusCode || 500, { ok: false, message: error?.message || "Campaign queue error." });
    }
    return;
  }
  return legacyCampaignSendHandler(request, response);
}
