const API_ROUTE = "/api/marketing-campaigns";
const DRAFT_AUDIENCE_PREVIEW_ROUTE = "/api/marketing-campaign-audience-preview";
const API_KEY_STORAGE_KEY = "marketingCustomerDatabaseApiKey";

function getApiKey() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) || window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

async function requestJson(route, payload = {}) {
  const apiKey = getApiKey();
  const response = await fetch(route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-marketing-customer-database-key": apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "Marketing Campaign request failed.");
  }

  return result;
}

async function requestMarketingCampaigns(action, payload = {}) {
  return requestJson(API_ROUTE, { action, ...payload });
}

export async function listMarketingCampaigns({ includeArchived = false } = {}) {
  const result = await requestMarketingCampaigns("list", { includeArchived });
  return {
    campaigns: result.campaigns || [],
    stats: result.stats || {},
  };
}

export async function createMarketingCampaign(values) {
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

export async function previewMarketingCampaignAudience(campaign, rules) {
  const result = await requestMarketingCampaigns("previewAudience", { campaign, rules });
  return result.audience;
}

export async function previewMarketingCampaignDraftAudience(channel, rules) {
  const result = await requestJson(DRAFT_AUDIENCE_PREVIEW_ROUTE, { channel, rules });
  return result.audience;
}

export async function saveMarketingCampaignAudience(campaign, rules) {
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
