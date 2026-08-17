import test from "node:test";
import assert from "node:assert/strict";
import { prioritiseMarketingOpportunities, scoreMarketingOpportunity } from "../lib/marketingOpportunityPriority.js";

test("ready campaign opportunities outrank equally sized unfinished audience filters", () => {
  const ready = { title: "Dormant", customer_count: 500, recommended_channel: "email", recommended_objective: "re_engagement", campaign_creation_supported: true };
  const unfinished = { title: "Never Marketed", customer_count: 500, recommended_channel: "email", recommended_objective: "re_engagement", campaign_creation_supported: false };
  assert.ok(scoreMarketingOpportunity(ready) > scoreMarketingOpportunity(unfinished));
});

test("marketing opportunities return an explicit next action and highest priority first", () => {
  const rows = prioritiseMarketingOpportunities([
    { title: "Cleanup", customer_count: 9000, recommended_channel: "email", recommended_objective: "custom", campaign_creation_supported: false },
    { title: "Recent Imports", customer_count: 120, recommended_channel: "email", recommended_objective: "new_stock", campaign_creation_supported: true },
  ]);
  assert.equal(rows[0].title, "Recent Imports");
  assert.equal(rows[0].priority_band, "act_now");
  assert.match(rows[0].recommended_next_action, /Create a campaign/i);
  assert.equal(rows[1].priority_band, "build_next");
});
