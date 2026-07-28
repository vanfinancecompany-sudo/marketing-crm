import { VISIBILITY_PROVIDERS } from "./aiVisibility.js";

const PROVIDER_MAP = new Map(VISIBILITY_PROVIDERS.map((provider) => [provider.key, provider]));

export const MANUAL_AI_PROVIDER_URLS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/",
  perplexity: "https://www.perplexity.ai/",
  google_ai_overviews: "https://www.google.com/",
});

export const MANUAL_PROVIDER_EXPLANATION =
  "No supported automated public-visibility check is available for this provider. Run a manual search and record verified evidence.";

export function isManualVisibilityProvider(providerKey) {
  return Object.hasOwn(MANUAL_AI_PROVIDER_URLS, providerKey);
}

export function suggestedVisibilityQuery(articleTitle = "") {
  const title = String(articleTitle || "")
    .trim()
    .replace(/^can i get/i, "Can I get")
    .replace(/county court judgment/gi, "CCJ")
    .replace(/\bvan finance company\b/gi, "van finance")
    .replace(/\s+/g, " ");
  if (!title) return "What should a UK customer know about van finance?";
  const question = /[?]$/.test(title) ? title : `${title}?`;
  return /\bUK\b/i.test(question) ? question : question.replace(/[?]$/, " in the UK?");
}

export function manualProviderStatus(latestResult) {
  if (!latestResult) return "Manual check required";
  if (latestResult.result_status === "detected" || latestResult.result_status === "mentioned" || latestResult.result_status === "cited") {
    return "Checked — detected";
  }
  if (latestResult.result_status === "not_detected") return "Checked — not detected";
  if (latestResult.result_status === "inconclusive") return "Checked — inconclusive";
  return "Manual check required";
}

export function getVisibilityProviderAdapter(providerKey) {
  const provider = PROVIDER_MAP.get(providerKey);
  if (!provider) throw new Error("Unsupported visibility provider.");
  const google = providerKey === "google_search_console";
  return {
    ...provider,
    automated_checks_supported: google,
    async check() {
      return {
        ok: false,
        result_status: "error",
        error_details: google
          ? "Use the connected Google Search Console page or bulk check action."
          : MANUAL_PROVIDER_EXPLANATION,
        response_metadata: {
          adapter_available: google,
          public_visibility_claimed: false,
        },
      };
    },
  };
}

export function visibilityProviderConnection(providerKey, stored = {}) {
  const adapter = getVisibilityProviderAdapter(providerKey);
  const manualOnly = isManualVisibilityProvider(providerKey);
  return {
    provider: providerKey,
    label: adapter.label,
    kind: adapter.kind,
    connection_status: manualOnly ? "manual_check_required" : stored.connection_status || "configuration_required",
    configuration_summary: manualOnly
      ? MANUAL_PROVIDER_EXPLANATION
      : stored.configuration_summary || "Google Search Console secure server configuration is required.",
    automated_checks_supported: adapter.automated_checks_supported,
    manual_evidence_only: manualOnly,
    provider_url: manualOnly ? MANUAL_AI_PROVIDER_URLS[providerKey] : "",
    last_successful_check_at: stored.last_successful_check_at || null,
    last_error_at: manualOnly ? null : stored.last_error_at || null,
    last_error: manualOnly ? "" : stored.last_error || "",
  };
}
