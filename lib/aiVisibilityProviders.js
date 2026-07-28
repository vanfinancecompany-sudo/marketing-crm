import { VISIBILITY_PROVIDERS } from "./aiVisibility.js";

const PROVIDER_MAP = new Map(VISIBILITY_PROVIDERS.map((provider) => [provider.key, provider]));

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
          : `${provider.label} remains manual evidence only. Record verified evidence manually.`,
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
  const manualOnly = adapter.kind === "ai";
  return {
    provider: providerKey,
    label: adapter.label,
    kind: adapter.kind,
    connection_status: stored.connection_status || "configuration_required",
    configuration_summary:
      stored.configuration_summary ||
      (manualOnly
        ? `${adapter.label}: Manual evidence only.`
        : "Google Search Console secure server configuration is required."),
    automated_checks_supported: adapter.automated_checks_supported,
    manual_evidence_only: manualOnly,
    last_successful_check_at: stored.last_successful_check_at || null,
    last_error_at: stored.last_error_at || null,
    last_error: stored.last_error || "",
  };
}
