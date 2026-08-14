export const MARKETING_ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
export const MARKETING_ACCESS_HEADER = "x-marketing-customer-database-key";
export const MARKETING_ACCESS_DENIED_EVENT = "marketing-access-denied";

let validatedAccessKey = "";
let validationPromise = null;

export class MarketingAccessDeniedError extends Error {
  constructor(message = "Access key not recognised.") {
    super(message);
    this.name = "MarketingAccessDeniedError";
    this.status = 401;
  }
}

function getBrowserStorage(storageName) {
  if (typeof window === "undefined") return null;
  try {
    return window[storageName] || null;
  } catch {
    return null;
  }
}

export function getStoredMarketingAccessKey() {
  const localStorage = getBrowserStorage("localStorage");
  const sessionStorage = getBrowserStorage("sessionStorage");

  try {
    const localKey = localStorage?.getItem(MARKETING_ACCESS_STORAGE_KEY) || "";
    const sessionKey = sessionStorage?.getItem(MARKETING_ACCESS_STORAGE_KEY) || "";
    return localKey || sessionKey || "";
  } catch {
    return "";
  }
}

export function saveMarketingAccessKey(apiKey) {
  const localStorage = getBrowserStorage("localStorage");
  const sessionStorage = getBrowserStorage("sessionStorage");
  const value = String(apiKey || "").trim();
  if (!value || !localStorage) return false;

  try {
    sessionStorage?.removeItem(MARKETING_ACCESS_STORAGE_KEY);
    localStorage.setItem(MARKETING_ACCESS_STORAGE_KEY, value);
    return localStorage.getItem(MARKETING_ACCESS_STORAGE_KEY) === value;
  } catch {
    return false;
  }
}

export function clearMarketingAccessKey() {
  const localStorage = getBrowserStorage("localStorage");
  const sessionStorage = getBrowserStorage("sessionStorage");
  validatedAccessKey = "";
  validationPromise = null;

  try {
    sessionStorage?.removeItem(MARKETING_ACCESS_STORAGE_KEY);
    localStorage?.removeItem(MARKETING_ACCESS_STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable in private or restricted sessions.
  }
}

export function buildMarketingAccessHeaders(headers = {}) {
  const apiKey = getStoredMarketingAccessKey();
  return {
    ...headers,
    ...(apiKey ? { [MARKETING_ACCESS_HEADER]: apiKey } : {}),
  };
}

export function isMarketingAccessDenied(error) {
  return error instanceof MarketingAccessDeniedError
    || error?.status === 401
    || /access denied|access key not recognised|unauthorized/i.test(String(error?.message || error || ""));
}

export function notifyMarketingAccessDenied(message = "Your saved access has expired or is no longer valid. Please unlock again.") {
  clearMarketingAccessKey();
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(MARKETING_ACCESS_DENIED_EVENT, { detail: { message } }));
  } catch {
    // If events are unavailable, the failed request will still surface its error.
  }
}

export async function parseMarketingJsonResponse(response, fallbackMessage, options = {}) {
  const result = await response.json().catch(() => ({}));
  const notifyAccessDenied = options.notifyAccessDenied !== false;

  if (response.status === 401) {
    const message = result.message || result.error || "Access key not recognised.";
    if (notifyAccessDenied) notifyMarketingAccessDenied();
    throw new MarketingAccessDeniedError(message);
  }

  if (!response.ok || result.ok === false) {
    const error = new Error(result.message || result.error || fallbackMessage || "Marketing request failed.");
    error.status = response.status;
    if (result.error_type) error.type = result.error_type;
    if (result.diagnostics && typeof result.diagnostics === "object") error.diagnostics = result.diagnostics;
    throw error;
  }

  return result;
}

export async function validateMarketingAccessKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new MarketingAccessDeniedError("Access key not recognised.");
  if (validatedAccessKey === key) return true;
  if (validationPromise?.key === key) return validationPromise.promise;

  const promise = (async () => {
    const response = await fetch("/api/marketing-campaigns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [MARKETING_ACCESS_HEADER]: key,
      },
      body: JSON.stringify({ action: "validateAccess" }),
    });

    await parseMarketingJsonResponse(response, "Could not validate Marketing access.", { notifyAccessDenied: false });
    validatedAccessKey = key;
    return true;
  })().finally(() => {
    if (validationPromise?.key === key) validationPromise = null;
  });

  validationPromise = { key, promise };
  return promise;
}
