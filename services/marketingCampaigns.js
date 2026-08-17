import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-centre-campaigns";
const DRAFT_AUDIENCE_PREVIEW_ROUTE = "/api/marketing-centre-campaign-audience-preview";
const OPPORTUNITIES_ROUTE = "/api/marketing-centre-opportunities";

let lastDraftAudiencePreview = null;

function sameRules(first, second) {
  return JSON.stringify(first || {}) === JSON.stringify(second || {});
}

function stripLocalCampaignFlags(campaign) {
  if (!campaign || typeof campaign !== "object") return campaign;
  const { __audienceAlreadySaved, __audience, ...safeCampaign } = campaign;
  return safeCampaign;
}

async function requestJson(route, payload = {}) {
  const response = await fetch(route, {
    method: "POST",
    headers: buildMarketingAccessHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });

  return parseMarketingJsonResponse(response, "Marketing Campaign request failed.");
}

async function requestMarketingCampaigns(action, payload = {}) {
  return requestJson(API_ROUTE, { action, ...payload });
}

export async function validateMarketingCampaignAccess() {
  await requestMarketingCampaigns("validateAccess");
  return true;
}

export async function listMarketingCampaigns({ includeArchived = false } = {}) {
  const result = await requestMarketingCampaigns("list", { includeArchived });
  return {
    campaigns: result.campaigns || [],
    stats: result.stats || {},
  };
}

export async function createMarketingCampaign(values) {
  if (lastDraftAudiencePreview) {
    if (lastDraftAudiencePreview.channel !== values?.channel) {
      throw new Error("Configure an audience before creating this campaign.");
    }

    const result = await createMarketingCampaignWithAudience(values, lastDraftAudiencePreview.rules);
    lastDraftAudiencePreview = null;
    return {
      ...result.campaign,
      __audienceAlreadySaved: true,
      __audience: result.audience,
    };
  }

  const result = await requestMarketingCampaigns("create", { values });
  return result.campaign;
}

export async function createMarketingCampaignWithAudience(values, rules) {
  const result = await requestMarketingCampaigns("createWithAudience", { values, rules });
  return {
    campaign: result.campaign,
    audience: result.audience,
  };
}

export async function updateMarketingCampaign(campaign, values) {
  const result = await requestMarketingCampaigns("update", { campaign, values });
  return result.campaign;
}

export async function archiveMarketingCampaign(campaign) {
  const result = await requestMarketingCampaigns("archive", { campaign });
  return result.campaign;
}

export async function getMarketingCampaignAudienceOptions() {
  const result = await requestMarketingCampaigns("audienceOptions");
  return result.options || { sources: [], tags: [] };
}

export async function getMarketingCampaignDashboard(campaign, preferredBatchSize = 1000) {
  const result = await requestMarketingCampaigns("campaignDashboard", { campaign, preferredBatchSize });
  return result.dashboard || {};
}

export async function getMarketingOpportunities() {
  const result = await requestJson(OPPORTUNITIES_ROUTE);
  return result.opportunities || [];
}

export async function previewMarketingCampaignAudience(campaign, rules) {
  const result = await requestMarketingCampaigns("previewAudience", { campaign, rules });
  return result.audience;
}

export async function previewMarketingCampaignDraftAudience(channel, rules) {
  const result = await requestJson(DRAFT_AUDIENCE_PREVIEW_ROUTE, { channel, rules });
  lastDraftAudiencePreview = {
    channel,
    rules,
    audience: result.audience,
  };
  return result.audience;
}

export async function saveMarketingCampaignAudience(campaign, rules) {
  if (campaign?.__audienceAlreadySaved) {
    const audience = campaign.__audience || { rules, eligible_count: null, calculated_at: null };
    if (!sameRules(audience.rules, rules)) {
      throw new Error("Configure an audience before creating this campaign.");
    }
    return {
      campaign: stripLocalCampaignFlags(campaign),
      audience,
    };
  }

  const result = await requestMarketingCampaigns("saveAudience", { campaign, rules });
  return {
    campaign: result.campaign,
    audience: result.audience,
  };
}

export async function listMarketingCampaignBatches(campaign) {
  const result = await requestMarketingCampaigns("listBatches", { campaign });
  return {
    batches: result.batches || [],
    summary: result.summary || {},
  };
}

export async function listMarketingCampaignBatchHistory(campaign) {
  const result = await requestMarketingCampaigns("listBatchHistory", { campaign });
  return {
    batches: result.batches || [],
    summary: result.summary || {},
  };
}

export async function previewMarketingCampaignBatch(campaign, requestedSize) {
  const result = await requestMarketingCampaigns("previewNextBatch", { campaign, requestedSize });
  return result.preview;
}

export async function generateMarketingCampaignBatch(campaign, requestedSize) {
  const result = await requestMarketingCampaigns("generateBatch", { campaign, requestedSize });
  return {
    batch: result.batch,
    summary: result.summary || {},
  };
}

export async function exportMarketingCampaignBatch(batch, { confirmExport = false, exportedBy = "" } = {}) {
  const result = await requestMarketingCampaigns("exportBatch", { batch, confirmExport, exportedBy });
  return {
    batch: result.batch,
    summary: result.summary || {},
    csv: result.csv || null,
  };
}

export async function downloadMarketingCampaignBatchCsv(batch) {
  const result = await requestMarketingCampaigns("downloadBatchCsv", { batch });
  return {
    batch: result.batch,
    csv: result.csv || null,
  };
}
