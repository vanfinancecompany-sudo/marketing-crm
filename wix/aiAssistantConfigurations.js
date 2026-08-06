// Copy this file into Wix Public files as aiAssistantConfigurations.js.
// API base URLs are supplied during installation because Vercel project aliases differ by environment.

function endpoint(apiBaseUrl) {
  return `${String(apiBaseUrl || "").replace(/\/$/, "")}/api/ai-assistant-customer`;
}

export function developmentAiAssistantConfig({ previewApiBaseUrl, privacyUrl }) {
  return {
    endpoint: endpoint(previewApiBaseUrl),
    privacyUrl,
    environment: "development",
  };
}

export function productionAiAssistantConfig({ productionApiBaseUrl, privacyUrl }) {
  return {
    endpoint: endpoint(productionApiBaseUrl),
    privacyUrl,
    environment: "production",
  };
}
