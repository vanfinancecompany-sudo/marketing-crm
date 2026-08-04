import {
  CampaignValidationError,
  renderCampaignPreview,
} from "./marketingCampaignTemplateRenderer.js";

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /{{\s*[a-zA-Z0-9_]+\s*}}/;
const EMAIL_GREETING_PATTERN = /\bHi(?:\s|&nbsp;)+(?:\{\{\s*first_name\s*\}\}|[A-Za-z][A-Za-z'’\-]{0,79})(?:\s*,|(?=\s*(?:<|$|\r?\n)))/giu;
export const FIXED_EMAIL_TEMPLATE_GREETING = "Hi there,";

function cleanValue(value, fallback = "", limit = 5000) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, limit);
}

export function recipientReplacementValues(values = {}, options = {}) {
  const mode = options.mode || "recipient";
  const firstName = mode === "designer_preview" ? cleanValue(values.first_name, "Alex", 200) : "there";
  return {
    campaign_name: cleanValue(values.campaign_name, "July New Stock", 300),
    first_name: firstName,
    last_name: cleanValue(values.last_name, "", 200),
    company: cleanValue(values.company || values.company_name, "Van Finance Company", 300),
    company_name: cleanValue(values.company_name || values.company, "Van Finance Company", 300),
    customer_id: cleanValue(values.customer_id, "", 120),
    vehicle_count: cleanValue(values.vehicle_count, "3", 20),
    vehicle_grid: cleanValue(values.vehicle_grid, "[Vehicle grid preview]", 500),
  };
}

export function replaceEmailTemplateGreeting(value) {
  return String(value ?? "").replace(EMAIL_GREETING_PATTERN, FIXED_EMAIL_TEMPLATE_GREETING);
}

export function emailTemplatePlainText(html) {
  return replaceEmailTemplateGreeting(String(html || "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<(?:br|\/p|\/h[1-6]|\/tr|\/li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

export function finalizeProviderEmailTemplate(rendered = {}) {
  const html = replaceEmailTemplateGreeting(rendered.html);
  return {
    ...rendered,
    subject: replaceEmailTemplateGreeting(rendered.subject),
    preview_text: replaceEmailTemplateGreeting(rendered.preview_text),
    html,
    text: replaceEmailTemplateGreeting(rendered.text || emailTemplatePlainText(html)),
  };
}

export function replaceRecipientPlaceholders(value, values = {}, options = {}) {
  const replacements = recipientReplacementValues(values, options);
  return String(value ?? "").replace(PLACEHOLDER_PATTERN, (match, key) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match,
  );
}

function replaceDeep(value, replacements, options) {
  if (typeof value === "string") return replaceRecipientPlaceholders(value, replacements, options);
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, replacements, options));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceDeep(item, replacements, options)]),
  );
}

function campaignContainsFirstNamePlaceholder(campaign = {}) {
  return JSON.stringify(campaign).includes("{{first_name}}") || /{{\s*first_name\s*}}/i.test(JSON.stringify(campaign));
}

export function renderRecipientCampaignPreview(campaign = {}, values = {}, options = {}) {
  const mode = options.mode || "recipient";
  const replacements = recipientReplacementValues(values, { mode });
  const personalizedCampaign = replaceDeep(campaign, replacements, { mode });
  const rendered = renderCampaignPreview(personalizedCampaign);
  return {
    ...rendered,
    personalization: {
      mode,
      first_name: replacements.first_name,
      customer_id: replacements.customer_id,
      source_used_first_name_placeholder: campaignContainsFirstNamePlaceholder(campaign),
      designer_sample_used: mode === "designer_preview" && replacements.first_name === "Alex",
    },
  };
}

export function unresolvedMarketingPlaceholders(rendered = {}) {
  return [rendered.subject, rendered.preview_text, rendered.html, rendered.text]
    .filter((value) => UNRESOLVED_PLACEHOLDER_PATTERN.test(String(value || "")));
}

export function assertProductionPersonalization(rendered = {}) {
  const mode = rendered.personalization?.mode;
  if (rendered.personalization?.designer_sample_used || mode === "designer_preview") {
    throw new CampaignValidationError("Designer sample data cannot be submitted to an email provider.");
  }
  if (!new Set(["recipient", "test"]).has(mode)) {
    throw new CampaignValidationError("Email provider submission requires explicit recipient personalisation.");
  }
  if (unresolvedMarketingPlaceholders(rendered).length) {
    throw new CampaignValidationError("Email contains an unresolved marketing placeholder and was not submitted.");
  }
  if (!cleanValue(rendered.personalization?.first_name)) {
    throw new CampaignValidationError("Recipient first-name personalisation was not resolved.");
  }
  return rendered;
}
