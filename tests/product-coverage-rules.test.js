import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductCoverage } from "../api/_productCoverage.js";
import { buildCompetencePrompt } from "../lib/aiAssistantCompetence.js";
import {
  coverageConflictDetected,
  detectCoverageConflicts,
  detectRent2BuyLocationTurn,
  extractBareRent2BuyLocationCandidate,
} from "../lib/productCoverageRules.js";

const settings = {
  finance_covered_nations: ["England", "Wales", "Scotland"],
  rent2buy_base_postcode: "SO40 2NN",
  rent2buy_max_radius_miles: 100,
  coverage_borderline_tolerance_miles: 10,
  coverage_distance_method: "straight_line",
};

const locations = {
  "SO40 2NN": { postcode: "SO40 2NN", latitude: 50.918, longitude: -1.495 },
  "PO1 2AA": { postcode: "PO1 2AA", latitude: 50.8198, longitude: -1.088 },
  "BH23 1QH": { postcode: "BH23 1QH", latitude: 50.735, longitude: -1.778 },
  "M1 1AE": { postcode: "M1 1AE", latitude: 53.4808, longitude: -2.2426 },
  "BH20 6EQ": { postcode: "BH20 6EQ", latitude: 52.365, longitude: -1.495 },
};

function providerFetch(url, options = {}) {
  assert.equal(options.cache, "no-store");
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/postcodes/")) {
    const postcode = decodeURIComponent(parsed.pathname.split("/").pop()).toUpperCase();
    const result = locations[postcode] || null;
    return Promise.resolve({ ok: Boolean(result), json: async () => ({ result }) });
  }
  const query = parsed.searchParams.get("q");
  const place = query === "Manchester"
    ? { name_1: "Manchester", latitude: 53.4808, longitude: -2.2426, outcode: "M1" }
    : query === "Portsmouth"
      ? { name_1: "Portsmouth", latitude: 50.8198, longitude: -1.088, outcode: "PO1" }
      : query === "Bournemouth"
        ? { name_1: "Bournemouth", latitude: 50.7192, longitude: -1.8808, outcode: "BH1" }
        : null;
  return Promise.resolve({ ok: Boolean(place), json: async () => ({ result: place ? [place] : [] }) });
}

test("Manchester is an indicative out-of-range Rent2Buy place result", async () => {
  const result = await resolveProductCoverage({ question: "I live in Manchester. Is Rent2Buy available?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.equal(result.diagnostics.detected_location, "Manchester");
  assert.equal(result.diagnostics.certainty, "indicative");
  assert.equal(result.diagnostics.coverage_result, "outside_normal_area");
  assert.match(result.source.passage, /full home postcode/i);
});

test("Portsmouth is an indicative in-range Rent2Buy place result", async () => {
  const result = await resolveProductCoverage({ question: "I am based in Portsmouth. Do you cover my area?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.equal(result.diagnostics.detected_location, "Portsmouth");
  assert.equal(result.diagnostics.certainty, "indicative");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
});

test("bare Rent2Buy postcode is treated as a coverage request and calculated immediately", async () => {
  const result = await resolveProductCoverage({ question: "BH23 1QH", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.equal(result.diagnostics.detected_location, "BH23 1QH");
  assert.equal(result.diagnostics.certainty, "confirmed");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
  assert.ok(result.diagnostics.distance_miles > 0);
  assert.match(result.source.passage, /server-calculated straight-line distance/i);
});

test("bare Rent2Buy town or city is geocoded and calculated rather than sent to generic recovery", async () => {
  const result = await resolveProductCoverage({ question: "Bournemouth", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.equal(result.diagnostics.detected_location, "Bournemouth");
  assert.equal(result.diagnostics.certainty, "indicative");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
  assert.ok(result.diagnostics.distance_miles > 0);
});

test("location-turn detection accepts postcodes and bare places but not ordinary acknowledgements", () => {
  assert.deepEqual(detectRent2BuyLocationTurn("BH23 1QH"), { query: "BH23 1QH", type: "full_postcode" });
  assert.equal(detectRent2BuyLocationTurn("Bournemouth", "Please tell me your full home postcode.").query, "Bournemouth");
  assert.equal(extractBareRent2BuyLocationCandidate("yes please"), null);
  assert.equal(extractBareRent2BuyLocationCandidate("bad credit"), null);
});

test("full in-range and out-of-range postcodes are confirmed", async () => {
  const inside = await resolveProductCoverage({ question: "Can I use Rent2Buy from PO1 2AA?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  const outside = await resolveProductCoverage({ question: "Is M1 1AE in your Rent2Buy area?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.equal(inside.diagnostics.coverage_result, "within_normal_area");
  assert.equal(inside.diagnostics.certainty, "confirmed");
  assert.equal(outside.diagnostics.coverage_result, "outside_normal_area");
  assert.equal(outside.diagnostics.certainty, "confirmed");
});

test("90 to 110 miles is always borderline", async () => {
  const result = await resolveProductCoverage({ question: "Would BH20 6EQ qualify for Rent2Buy?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  assert.ok(result.diagnostics.distance_miles >= 90 && result.diagnostics.distance_miles <= 110);
  assert.equal(result.diagnostics.coverage_result, "borderline_manual_confirmation");
  assert.equal(result.diagnostics.certainty, "borderline");
});

test("unknown locations and provider failures return unresolved evidence without guessing", async () => {
  const unknown = await resolveProductCoverage({ question: "I live in Madeupville. Can I get Rent2Buy?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  const unavailable = await resolveProductCoverage({ question: "I live in Portsmouth. Can I get Rent2Buy?", productContext: "rent2buy", settings, fetchImplementation: async () => { throw new Error("provider unavailable"); } });
  for (const result of [unknown, unavailable]) {
    assert.equal(result.diagnostics.certainty, "unresolved");
    assert.equal(result.diagnostics.distance_miles, null);
    assert.match(result.source.passage, /ask for (?:their|the customer's) full home postcode/i);
  }
});

for (const [nation, expected] of [["England", "covered"], ["Wales", "covered"], ["Scotland", "covered"], ["Northern Ireland", "not_covered"]]) {
  test(`Finance coverage for ${nation} is deterministic`, async () => {
    let called = false;
    const result = await resolveProductCoverage({ question: `Is van finance available in ${nation}?`, productContext: "finance", settings, fetchImplementation: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(result.diagnostics.coverage_result, expected);
    assert.equal(result.diagnostics.certainty, "confirmed");
    assert.doesNotMatch(result.source.passage, /Rent2Buy/);
  });
}

test("deterministic coverage is S1, non-overridable, and conflicting knowledge is flagged", async () => {
  const coverage = await resolveProductCoverage({ question: "Is PO1 2AA in the Rent2Buy area?", productContext: "rent2buy", settings, fetchImplementation: providerFetch });
  const conflicting = [{ type: "article", source_id: "article-1", title: "Old coverage", heading: "Locations", passage: "Rent2Buy is only available within 50 miles of SO40 2NN." }];
  const conflicts = detectCoverageConflicts(coverage, conflicting, settings);
  assert.equal(conflicts.length, 1);
  assert.equal(coverageConflictDetected(false, conflicts), true);
  const prompt = buildCompetencePrompt({ question: "Is PO1 2AA in the Rent2Buy area?", sources: [coverage.source, ...conflicting], productContext: "rent2buy", settings });
  assert.match(prompt, /\[S1\] DETERMINISTIC COVERAGE RULE/);
  assert.match(prompt, /non-overridable/i);
  assert.ok(prompt.indexOf("# Non-overridable coverage conclusion") < prompt.indexOf("# Retrieved evidence"));
});
