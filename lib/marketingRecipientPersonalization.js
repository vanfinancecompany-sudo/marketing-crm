import {
  CampaignValidationError,
  renderCampaignPreview,
} from "./marketingCampaignTemplateRenderer.js";

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /{{\s*[a-zA-Z0-9_]+\s*}}/;
const DESIGNER_SAMPLE_FIRST_NAME = "Alex";

function cleanValue(value, fallback = "", limit = 5000) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, limit);
}

export function normalizeRecipientFirstName(value, fallback = "there") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const withoutTitle = text.replace(/^(?:mr|mrs|miss|ms|dr)\.?\s+/i, "");
  if (!withoutTitle || withoutTitle.length > 80) return fallback;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?: [\p{L}\p{M}][\p{L}\p{M}'’.-]*)*$/u.test(withoutTitle)) return fallback;
  return withoutTitle;
}

export function recipientReplacementValues(values = {}, options = {}) {
  const mode = options.mode || "recipient";
  const firstNameFallback = mode === "designer_preview" ? DESIGNER_SAMPLE_FIRST_NAME : mode === "test" ? "Stuart" : "there";
  return {
    campaign_name: cleanValue(values.campaign_name, "July New Stock", 300),
    first_name: normalizeRecipientFirstName(values.first_name, firstNameFallback),
    last_name: cleanValue(values.last_name, "", 200),
    company: cleanValue(values.company || values.company_name, "Van Finance Company", 300),
    company_name: cleanValue(values.company_name || values.company, "Van Finance Company", 300),
    customer_id: cleanValue(values.customer_id, "", 120),
    vehicle_count: cleanValue(values.vehicle_count, "3", 20),
    vehicle_grid: cleanValue(values.vehicle_grid, "[Vehicle grid preview]", 500),
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
  return /{{\s*first_name\s*}}/i.test(JSON.stringify(campaign));
}

function renderedContainsName(rendered = {}, name = "") {
  if (!name) return false;
  const haystack = [rendered.subject, rendered.preview_text, rendered.html].map((value) => String(value || "")).join("\n");
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
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
      designer_sample_used: mode === "designer_preview" && replacements.first_name === DESIGNER_SAMPLE_FIRST_NAME,
      designer_sample_leaked: mode !== "designer_preview"
        && replacements.first_name.toLowerCase() !== DESIGNER_SAMPLE_FIRST_NAME.toLowerCase()
        && renderedContainsName(rendered, DESIGNER_SAMPLE_FIRST_NAME),
    },
  };
}

export function unresolvedMarketingPlaceholders(rendered = {}) {
  return [rendered.subject, rendered.preview_text, rendered.html]
    .filter((value) => UNRESOLVED_PLACEHOLDER_PATTERN.test(String(value || "")));
}

export function assertProductionPersonalization(rendered = {}) {
  const mode = rendered.personalization?.mode;
  if (rendered.personalization?.designer_sample_used || rendered.personalization?.designer_sample_leaked || mode === "designer_preview") {
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
