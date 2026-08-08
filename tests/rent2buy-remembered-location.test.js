import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductCoverage } from "../api/_productCoverage.js";
import { detectRent2BuyLocationInput } from "../lib/rent2buyLocationInput.js";
import { deterministicRent2BuyCoverageReply } from "../lib/rent2buyCoverageReply.js";

const settings = {
  rent2buy_base_postcode: "SO40 2NN",
  rent2buy_max_radius_miles: 100,
  coverage_borderline_tolerance_miles: 10,
  coverage_distance_method: "straight_line",
};

function providerFetch(url) {
  const parsed = new URL(url);
  if (parsed.pathname.startsWith("/postcodes/")) {
    const postcode = decodeURIComponent(parsed.pathname.split("/").pop()).toUpperCase();
    const result = postcode === "SO40 2NN"
      ? { postcode: "SO40 2NN", latitude: 50.918, longitude: -1.495 }
      : null;
    return Promise.resolve({ ok: Boolean(result), json: async () => ({ result }) });
  }
  const query = parsed.searchParams.get("q");
  const place = query === "Bournemouth"
    ? { name_1: "Bournemouth", latitude: 50.7192, longitude: -1.8808, outcode: "BH1" }
    : null;
  return Promise.resolve({ ok: Boolean(place), json: async () => ({ result: place ? [place] : [] }) });
}

test("internal remembered-location wording resolves the town rather than treating the full phrase as a place", () => {
  const location = detectRent2BuyLocationInput("coverage for Bournemouth");
  assert.equal(location.query, "Bournemouth");
  assert.equal(location.type, "town_or_city");
  assert.equal(location.inferred_from, "coverage_context");
});

test("coverage for Bournemouth geocodes and returns an indicative calculated distance", async () => {
  const result = await resolveProductCoverage({
    question: "coverage for Bournemouth",
    productContext: "rent2buy",
    settings,
    fetchImplementation: providerFetch,
  });
  assert.equal(result.diagnostics.detected_location, "Bournemouth");
  assert.equal(result.diagnostics.certainty, "indicative");
  assert.equal(result.diagnostics.coverage_result, "within_normal_area");
  assert.ok(result.diagnostics.distance_miles > 0);
});

test("outside postcode reply preserves uppercase postcode labels", () => {
  const reply = deterministicRent2BuyCoverageReply({
    source: { source_id: "coverage:rent2buy", product: "rent2buy", heading: "M1 1AE" },
    diagnostics: {
      detected_location: "M1 1AE",
      distance_miles: 179,
      base_postcode: "SO40 2NN",
      coverage_result: "outside_normal_area",
      certainty: "confirmed",
    },
  }, settings);
  assert.match(reply, /Unfortunately, M1 1AE is approximately 179 miles in a straight line from SO40 2NN/i);
  assert.doesNotMatch(reply, /m1 1ae|so40 2nn/);
});
