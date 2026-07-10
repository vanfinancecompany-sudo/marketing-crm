const API_KEY_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const API_KEY_HEADER = "x-marketing-customer-database-key";

export function getMarketingCustomerApiKey() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

export async function requestMarketingCustomerApi(route, action, payload = {}) {
  const apiKey = getMarketingCustomerApiKey();
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { [API_KEY_HEADER]: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
  };

  const response = await fetch(route, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    throw new Error(result.message || "Customer Database request failed.");
  }

  return result;
}
