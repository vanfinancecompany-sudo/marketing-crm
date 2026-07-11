const API_ROUTE = "/api/marketing-campaigns";
const API_KEY_STORAGE_KEY = "marketingCustomerDatabaseApiKey";

function getApiKey() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) || window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

async function requestMarketingCampaigns(action, payload = {}) {
  const apiKey = getApiKey();
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-marketing-customer-database-key": apiKey } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "Marketing Campaign request failed.");
  }

  return result;
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

export async function previewMarketingCampaignAudience(campaign, rules) {
  const result = await requestMarketingCampaigns("previewAudience", { campaign, rules });
  return result.audience;
}

export async function saveMarketingCampaignAudience(campaign, rules) {
  const result = await requestMarketingCampaigns("saveAudience", { campaign, rules });
  return {
    campaign: result.campaign,
    audience: result.audience,
  };
}
