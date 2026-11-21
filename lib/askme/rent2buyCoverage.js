// Rent2Buy service-area check for Ask Me (lean engine).
//
// Uses the standalone Rent2Buy website's existing driving-distance checker
// (rent2buy-vans: lib/rent2buyDistance.js via GET /api/rent2buy-distance), so the
// routing logic, base postcode (SO40 2NN), 100-mile limit and routing provider keys
// stay in one place. The endpoint is public and read-only; no credentials are sent.

import { extractTolerantPostcode } from "../rent2buyLocationInput.js";

export const RENT2BUY_DISTANCE_URL = "https://www.rent2buyvans.co.uk/api/rent2buy-distance";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

export function resetRent2BuyCoverageCache() {
  cache.clear();
}

// Full UK postcode in the customer's latest message (any case, with or without the
// space, alone or inside a sentence). Returns { postcode, kind: "full" | "attempt" }.
export function findCustomerPostcode(message) {
  const found = extractTolerantPostcode(message);
  if (!found) return null;
  return found.type === "full_postcode" ? { postcode: found.query, kind: "full" } : { postcode: found.query, kind: "attempt" };
}

// True when the message is only the location (e.g. "BH23 1QH", "my postcode is bh231qh",
// "I live in BH23 1QH, is that covered?"), so the verified result fully answers it.
const LOCATION_ONLY_WORDS = new Set("actually address correct correction home i meant meant mine new no oops sorry typo instead wrong a am an and any are area at available based can check cover covered coverage covers do does for from hello here hi i i'm im in is it it's its live living located me my near ok okay our please postcode post code rent2buy rent service so sure that thanks thank the there this to us we what whats what's within yes you your".split(" "));
export function isLocationOnlyMessage(message, postcode) {
  const compact = clean(postcode, 20).replace(/\s+/g, "");
  const rest = clean(message, 400).toLowerCase()
    .replace(new RegExp(compact.split("").join("[\\s-]*"), "ig"), " ")
    .replace(/rent\s?2\s?buy/g, "rent2buy");
  const words = rest.match(/[a-z0-9'’]+/g) || [];
  return words.every((word) => LOCATION_ONLY_WORDS.has(word.replace(/’/g, "'")));
}

export async function checkRent2BuyDistance(postcode, { fetchImpl = fetch, environment = process.env, timeoutMs = 10000 } = {}) {
  const key = clean(postcode, 12).toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return { ...cached.result, cache_hit: true };
  const base = clean(environment.RENT2BUY_DISTANCE_URL, 300) || RENT2BUY_DISTANCE_URL;
  try {
    const response = await fetchImpl(`${base}?postcode=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true || !Number.isFinite(Number(data.miles))) {
      return { ok: false, postcode: key, status: response.status };
    }
    const result = {
      ok: true,
      postcode: clean(data.postcode, 12) || key,
      miles: Number(data.miles),
      eligible: data.eligible === true,
      max_miles: Number(data.maxMiles) || 100,
      base_postcode: clean(data.basePostcode, 12) || "SO40 2NN",
      provider: clean(data.provider, 40) || null,
    };
    cache.set(key, { at: Date.now(), result });
    return result;
  } catch (error) {
    return { ok: false, postcode: key, error: clean(error?.name || error?.message, 80) };
  }
}

export function coverageReply(result) {
  if (!result?.ok) {
    return `I couldn't check the driving distance for ${result?.postcode || "that postcode"} just now. Please make sure the postcode is correct and send it again, or the team can confirm it for you.`;
  }
  const miles = Math.max(1, Math.round(result.miles));
  if (result.eligible) {
    return `Good news! ${result.postcode} is approximately ${miles} driving miles from our Southampton collection point, so you're within our normal ${result.max_miles}-mile Rent2Buy service area. You can apply, subject to our usual eligibility and affordability checks.`;
  }
  return `Thanks for checking. ${result.postcode} is approximately ${miles} driving miles from our Southampton collection point, which is outside our normal ${result.max_miles}-mile Rent2Buy service area, so Rent2Buy isn't normally available there. The team can talk through your options if your circumstances are different.`;
}

export function invalidPostcodeReply(attempt) {
  return `${clean(attempt, 12) || "That"} doesn't look like a complete UK postcode. Please send your full postcode, for example SO40 2NN, and I'll check the driving distance straight away.`;
}

// Evidence line for the model when the postcode arrives with another question.
export function coverageEvidenceText(result) {
  if (!result?.ok) return `Service-area check: the driving distance for ${result?.postcode || "the customer's postcode"} could not be verified just now; say the team can confirm it.`;
  return `Service-area check (verified just now): ${result.postcode} is ${Math.max(1, Math.round(result.miles))} driving miles from our Southampton collection point (${result.base_postcode}); the limit is ${result.max_miles} miles, so the customer is ${result.eligible ? "WITHIN" : "OUTSIDE"} the normal Rent2Buy service area.`;
}
