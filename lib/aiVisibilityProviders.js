import { VISIBILITY_PROVIDERS } from "./aiVisibility.js";

const PROVIDER_MAP = new Map(VISIBILITY_PROVIDERS.map((provider) => [provider.key, provider]));

export function getVisibilityProviderAdapter(providerKey) {
  const provider = PROVIDER_MAP.get(providerKey);
  if (!provider) throw new Error("Unsupported visibility provider.");
  return {
    ...provider,
    automated_checks_supported: false,
    async check() {
      return {
        ok: false,
        result_status: "error",
        error_details: `${provider.label} automated visibility checks are not connected. Record verified evidence manually until a supported adapter is configured.`,
        response_metadata: {
          adapter_available: false,
          public_visibility_claimed: false,
        },
      };
    },
  };
}

export function visibilityProviderConnection(providerKey, stored = {}) {
  const adapter = getVisibilityProviderAdapter(providerKey);
  return {
    provider: providerKey,
    label: adapter.label,
    kind: adapter.kind,
    connection_status: stored.connection_status || "configuration_required",
    configuration_summary:
      stored.configuration_summary ||
      `${adapter.label} requires a supported evidence source before checks can run.`,
    automated_checks_supported: adapter.automated_checks_supported,
    last_successful_check_at: stored.last_successful_check_at || null,
    last_error_at: stored.last_error_at || null,
    last_error: stored.last_error || "",
  };
}
