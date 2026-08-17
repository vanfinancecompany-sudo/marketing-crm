export const MARKETING_ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
export const MARKETING_ACCESS_HEADER = "x-marketing-customer-database-key";
export const MARKETING_ACCESS_DENIED_EVENT = "marketing-access-denied";
export const MARKETING_CENTRE_NO_LOCK_KEY = "__marketing_centre_no_lock__";
export const KNOWLEDGE_HUB_NO_LOCK_KEY = "__knowledge_hub_no_lock__";

const KNOWLEDGE_HUB_API_REWRITES = Object.freeze({
  "/api/marketing-knowledge-hub": "/api/knowledge-hub-ui",
  "/api/knowledge-hub-duplicates": "/api/knowledge-hub-ui-duplicates",
  "/api/knowledge-hub-seo-fields": "/api/knowledge-hub-ui-seo-fields",
  "/api/marketing-knowledge-safety-approval": "/api/knowledge-hub-ui-safety-approval",
  "/api/marketing-rent2buy-business-rule": "/api/knowledge-hub-ui-rent2buy-rule",
  "/api/marketing-editorial-engine": "/api/knowledge-hub-ui-editorial-engine",
  "/api/marketing-internal-link-validate": "/api/knowledge-hub-ui-internal-link-validate",
  "/api/marketing-editorial-automation": "/api/knowledge-hub-ui-editorial-automation",
  "/api/marketing-knowledge-corrections": "/api/knowledge-hub-ui-corrections",
  "/api/marketing-wix-publishing": "/api/knowledge-hub-ui-wix-publishing",
  "/api/marketing-internal-link-reset": "/api/knowledge-hub-ui-internal-link-reset",
  "/api/marketing-website-index-discovery": "/api/knowledge-hub-ui-website-index-discovery",
  "/api/knowledge-topic-workspace": "/api/knowledge-hub-ui-topic-workspace",
});

let validatedAccessKey = "";
let validationPromise = null;
let knowledgeHubFetchInstalled = false;

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

function normalizedPathname() {
  if (typeof window === "undefined") return "/";
  return String(window.location?.pathname || "").replace(/\/+$/, "") || "/";
}

export function isMarketingCentreRoute() {
  return normalizedPathname() === "/marketing-centre";
}

export function isKnowledgeHubRoute() {
  return normalizedPathname() === "/knowledge-hub";
}

export function isNoLockMarketingToolRoute() {
  return isMarketingCentreRoute() || isKnowledgeHubRoute();
}

export function knowledgeHubApiRoute(protectedRoute, noLockRoute) {
  return isKnowledgeHubRoute() ? noLockRoute : protectedRoute;
}

export function rewriteKnowledgeHubApiUrl(input) {
  if (!isKnowledgeHubRoute() || typeof input !== "string") return input;
  const [path, suffix = ""] = input.split(/(?=[?#])/u, 2);
  const rewritten = KNOWLEDGE_HUB_API_REWRITES[path];
  return rewritten ? `${rewritten}${suffix}` : input;
}

export function installKnowledgeHubNoLockFetch() {
  if (knowledgeHubFetchInstalled || typeof globalThis?.fetch !== "function") return false;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => originalFetch(rewriteKnowledgeHubApiUrl(input), init);
  knowledgeHubFetchInstalled = true;
  return true;
}

export function getStoredMarketingAccessKey() {
  if (isMarketingCentreRoute()) return MARKETING_CENTRE_NO_LOCK_KEY;
  if (isKnowledgeHubRoute()) {
    installKnowledgeHubNoLockFetch();
    return KNOWLEDGE_HUB_NO_LOCK_KEY;
  }

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
  if (!value) return false;

  if (value === MARKETING_CENTRE_NO_LOCK_KEY && isMarketingCentreRoute()) return true;
  if (value === KNOWLEDGE_HUB_NO_LOCK_KEY && isKnowledgeHubRoute()) return true;
  if (!localStorage) return false;

  try {
    sessionStorage?.removeItem(MARKETING_ACCESS_STORAGE_KEY);
    localStorage.setItem(MARKETING_ACCESS_STORAGE_KEY, value);
    return localStorage.getItem(MARKETING_ACCESS_STORAGE_KEY) === value;
  } catch {
    return false;
  }
}

export function clearMarketingAccessKey() {
  validatedAccessKey = "";
  validationPromise = null;

  if (isNoLockMarketingToolRoute()) {
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(() => window.location?.reload?.(), 0);
    }
    return;
  }

  const localStorage = getBrowserStorage("localStorage");
  const sessionStorage = getBrowserStorage("sessionStorage");

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
  if (isNoLockMarketingToolRoute()) return;

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
  if (key === MARKETING_CENTRE_NO_LOCK_KEY && isMarketingCentreRoute()) {
    validatedAccessKey = key;
    return true;
  }
  if (key === KNOWLEDGE_HUB_NO_LOCK_KEY && isKnowledgeHubRoute()) {
    installKnowledgeHubNoLockFetch();
    validatedAccessKey = key;
    return true;
  }
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
