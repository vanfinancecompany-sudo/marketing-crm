import assert from "node:assert/strict";
import test from "node:test";
import { deterministicRent2BuyCoverageReply } from "../lib/rent2buyCoverageReply.js";
import { deterministicDeliveryReply } from "../lib/salesConversationEngine.js";

function coverage({
  result = "within_normal_area",
  certainty = "confirmed",
  distance = 15.7,
  heading = "BH23 1QH",
  detected = "BH23 1QH",
  sourceId = "coverage:rent2buy",
} = {}) {
  return {
    source: {
      source_id: sourceId,
      product: "rent2buy",
      heading,
    },
    diagnostics: {
      detected_location: detected,
      distance_miles: distance,
      base_postcode: "SO40 2NN",
      coverage_result: result,
      certainty,
    },
  };
}

test("confirmed in-range postcode reply includes calculated mileage and base postcode", () => {
  const reply = deterministicRent2BuyCoverageReply(coverage());
  assert.match(reply, /approximately 15\.7 miles in a straight line from SO40 2NN/i);
  assert.match(reply, /within our normal 100-mile Rent2Buy area/i);
});

test("confirmed outside postcode reply includes calculated mileage and outside result", () => {
  const reply = deterministicRent2BuyCoverageReply(coverage({ result: "outside_normal_area", distance: 183.2, heading: "M1 1AE", detected: "M1 1AE" }));
  assert.match(reply, /approximately 183\.2 miles in a straight line from SO40 2NN/i);
  assert.match(reply, /outside our normal 100-mile Rent2Buy area/i);
});

test("town/city reply includes indicative mileage and requests full home postcode", () => {
  const reply = deterministicRent2BuyCoverageReply(coverage({ certainty: "indicative", distance: 20.4, heading: "Bournemouth", detected: "Bournemouth" }));
  assert.match(reply, /Bournemouth is approximately 20\.4 miles in a straight line from SO40 2NN/i);
  assert.match(reply, /indicative town\/city result/i);
  assert.match(reply, /full home postcode/i);
});

test("borderline reply includes mileage and manual confirmation", () => {
  const reply = deterministicRent2BuyCoverageReply(coverage({ result: "borderline_manual_confirmation", certainty: "borderline", distance: 101.2, heading: "Borderline postcode" }));
  assert.match(reply, /approximately 101\.2 miles in a straight line from SO40 2NN/i);
  assert.match(reply, /90–110 mile borderline band/i);
  assert.match(reply, /manual confirmation/i);
});

test("invalid postcode receives correction wording without a guessed distance", () => {
  const reply = deterministicRent2BuyCoverageReply(coverage({ result: "invalid_postcode", certainty: "unresolved", distance: null, heading: "Postcode needs checking", detected: "BH23 1Q" }));
  assert.match(reply, /looks like a postcode/i);
  assert.match(reply, /can’t verify/i);
  assert.match(reply, /full home postcode/i);
  assert.doesNotMatch(reply, /approximately \d/i);
});

test("existing response override returns distance wording for Rent2Buy coverage without a delivery keyword", () => {
  const reply = deterministicDeliveryReply("rent2buy", "M1 1AE", coverage({ result: "outside_normal_area", distance: 183.2, heading: "M1 1AE", detected: "M1 1AE" }));
  assert.match(reply, /183\.2 miles/i);
  assert.match(reply, /outside/i);
});

test("Rent2Buy delivery rule remains collection-only", () => {
  const deliveryCoverage = {
    source: { source_id: "delivery:rent2buy", product: "rent2buy", heading: "Southampton collection only" },
    diagnostics: { delivery_rule: "southampton_collection_only" },
  };
  const reply = deterministicDeliveryReply("rent2buy", "Do you deliver?", deliveryCoverage);
  assert.match(reply, /collected from Southampton rather than delivered/i);
});

test("Finance delivery behaviour remains unchanged", () => {
  const reply = deterministicDeliveryReply("finance", "Do you deliver?", { diagnostics: {} });
  assert.match(reply, /free delivery/i);
  assert.match(reply, /England, Wales and Scotland/i);
});
