import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductCoverage } from "../api/_productCoverage.js";
import {
  detectRent2BuyLocationInput,
  extractSafeStandalonePlace,
  extractTolerantPostcode,
  normaliseUkPostcode,
} from "../lib/rent2buyLocationInput.js";

const settings = {
  rent2buy_base_postcode: "SO40 2NN",
  rent2buy_max_radius_miles: 100,
  coverage_borderline_tolerance_miles: 10,
  coverage_distance_method: "straight_line",
};

const locations = {
  "SO40 2NN": { postcode: "SO40 2NN", latitude: 50.918, longitude: -1.495 },
  "BH23 1QH": { postcode: "BH23 1QH", latitude: 50.735, longitude: -1.778 },
};

function providerFetch(url) {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/postcodes/")) {
    const postcode = decodeURIComponent(parsed.pathname.split("/").pop()).toUpperCase();
    const result = locations[postcode] || null;
    return Promise.resolve({ ok: Boolean(result), json: async () => ({ result }) });
  }
  const query = parsed.searchParams.get("q");
  const place = query === "Bournemouth"
    ? { name_1: "Bournemouth", latitude: 50.7192, longitude: -1.8808, outcode: "BH1" }
    : null;
  return Promise.resolve({ ok: Boolean(place), json: async () => ({ result: place ? [place] : [] }) });
}

test("postcode normalisation accepts missing spaces, hyphens, extra spaces and lower case", () => {
  for (const input of ["BH231QH", "BH23-1QH", "bh23 1qh", " BH23   1QH "]) {
    assert.equal(normaliseUkPostcode(input), "BH23 1QH", input);
  }
  assert.equal(extractTolerantPostcode("postcode is bh23-1qh").query, "BH23 1QH");
});

test("postcode-looking but invalid input is identified rather than treated as nonsense", () => {
  const input = extractTolerantPostcode("BH23 1Q");
  assert.equal(input.type, "postcode_attempt");
  assert.equal(input.input_kind, "invalid_postcode");
});

test("safe standalone places are accepted while common conversational phrases are rejected", () => {
  for (const place of ["Bournemouth", "New Forest", "Milton Keynes", "St Albans"]) {
    assert.equal(extractSafeStandalonePlace(place)?.type, "town_or_city", place);
  }
  for (const message of ["help pls", "can you help", "need a van", "yes please", "just looking", "tell me more"]) {
    assert.equal(extractSafeStandalonePlace(message), null, message);
  }
});

test("hyphenated postcode resolves to the normalised full postcode and calculates coverage", async () => {
  const result = await resolveProductCoverage({
    question: "BH23-1QH",
    productContext: "rent2buy",
    settings,
    fetchImplementation: providerFetch,
  });
  assert.equal(result.diagnostics.detected_location, "BH23 1QH");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
  assert.equal(result.diagnostics.certainty, "confirmed");
  assert.ok(result.diagnostics.distance_miles > 0);
});

test("invalid postcode attempt returns a specific safe correction response without geocoding or guessing", async () => {
  let calls = 0;
  const result = await resolveProductCoverage({
    question: "BH23 1Q",
    productContext: "rent2buy",
    settings,
    fetchImplementation: async () => { calls += 1; throw new Error("should not geocode"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.diagnostics.coverage_result, "invalid_postcode");
  assert.equal(result.diagnostics.distance_miles, null);
  assert.match(result.source.passage, /appears to have entered a postcode/i);
  assert.match(result.source.passage, /check and resend/i);
  assert.match(result.source.passage, /do not guess/i);
});

test("standalone Bournemouth is geocoded as an indicative coverage check", async () => {
  const detected = detectRent2BuyLocationInput("Bournemouth");
  assert.equal(detected.type, "town_or_city");
  const result = await resolveProductCoverage({
    question: "Bournemouth",
    productContext: "rent2buy",
    settings,
    fetchImplementation: providerFetch,
  });
  assert.equal(result.diagnostics.detected_location, "Bournemouth");
  assert.equal(result.diagnostics.certainty, "indicative");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
  assert.match(result.source.passage, /full home postcode/i);
});
