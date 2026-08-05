import {
  buildFinanceCoverageEvidence,
  buildRent2BuyCoverageEvidence,
  extractUkLocation,
  isCoverageQuestion,
  normaliseCoverageSettings,
} from "../lib/productCoverageRules.js";

const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

async function fetchPostcodesIo(path, environment = process.env, fetchImplementation = fetch) {
  const baseUrl = clean(environment.POSTCODES_IO_BASE_URL, 500) || "https://api.postcodes.io";
  const timeoutMs = Math.min(10000, Math.max(500, Number(environment.COVERAGE_GEOCODING_TIMEOUT_MS) || 4000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.result || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodePostcode(postcode, environment, fetchImplementation) {
  const result = await fetchPostcodesIo(`/postcodes/${encodeURIComponent(postcode)}`, environment, fetchImplementation);
  if (!result || !Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) return null;
  return { label: result.postcode || postcode, postcode: result.postcode || postcode, latitude: Number(result.latitude), longitude: Number(result.longitude) };
}

async function geocodePlace(place, environment, fetchImplementation) {
  const results = await fetchPostcodesIo(`/places?q=${encodeURIComponent(place)}&limit=1`, environment, fetchImplementation);
  const result = Array.isArray(results) ? results[0] : null;
  if (!result || !Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) return null;
  return { label: result.name_1 || result.local_type || place, outcode: result.outcode || null, latitude: Number(result.latitude), longitude: Number(result.longitude) };
}

export async function resolveProductCoverage({ question, productContext, settings = {}, environment = process.env, fetchImplementation = fetch } = {}) {
  if (!isCoverageQuestion(question)) return null;
  if (productContext === "finance") return buildFinanceCoverageEvidence(question, settings);
  if (productContext !== "rent2buy") return null;
  const rules = normaliseCoverageSettings(settings);
  const location = extractUkLocation(question);
  if (!location) return buildRent2BuyCoverageEvidence({ location, settings: rules });
  try {
    const [base, resolved] = await Promise.all([
      geocodePostcode(rules.rent2buy_base_postcode, environment, fetchImplementation),
      location.type === "full_postcode"
        ? geocodePostcode(location.query, environment, fetchImplementation)
        : geocodePlace(location.query, environment, fetchImplementation),
    ]);
    return buildRent2BuyCoverageEvidence({ location, resolved, base, settings: rules });
  } catch (error) {
    console.warn("AI ASSISTANT COVERAGE GEOCODING FALLBACK", {
      exception_type: error?.name || typeof error,
      exception_message: clean(error?.message || error, 1000),
      detected_location: location.query,
    });
    return buildRent2BuyCoverageEvidence({ location, settings: rules, error: clean(error?.message || error, 500) });
  }
}
