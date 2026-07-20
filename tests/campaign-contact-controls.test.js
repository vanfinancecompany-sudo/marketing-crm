import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CONTACT_HISTORY_RECIPIENT_STATUSES,
  loadCampaignContactExclusions,
  matchesCampaignContactExclusion,
  normalizeCampaignContactControls,
} from "../lib/marketingCampaignContactControls.js";

const CAMPAIGN_ONE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_TWO = "22222222-2222-4222-8222-222222222222";

test("campaign contact controls default to no historical exclusion for existing saved rules", () => {
  assert.deepEqual(normalizeCampaignContactControls({}), {
    recent_contact_days: 0,
    exclude_campaign_ids: [],
  });
});

test("campaign contact controls accept supported days and de-duplicate campaign IDs", () => {
  assert.deepEqual(normalizeCampaignContactControls({
    recent_contact_days: "7",
    exclude_campaign_ids: [CAMPAIGN_ONE.toUpperCase(), CAMPAIGN_ONE, CAMPAIGN_TWO],
  }), {
    recent_contact_days: 7,
    exclude_campaign_ids: [CAMPAIGN_ONE, CAMPAIGN_TWO],
  });
});

test("campaign contact controls reject unsupported days and invalid campaign IDs", () => {
  assert.throws(() => normalizeCampaignContactControls({ recent_contact_days: 4 }), /supported recent-contact period/i);
  assert.throws(() => normalizeCampaignContactControls({ exclude_campaign_ids: ["not-a-campaign"] }), /not valid/i);
});

test("contact history includes submitted production outcomes but not draft or failed recipients", () => {
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("accepted"));
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("delivered"));
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("submission_unknown"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("pending"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("failed"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("skipped"));
});

test("historical exclusions match either the original customer ID or normalized email", () => {
  const exclusions = {
    customerIds: new Set(["VFC-123"]),
    emails: new Set(["known@example.com"]),
  };
  assert.equal(matchesCampaignContactExclusion({ customer_id: "vfc-123", email: "other@example.com" }, exclusions), true);
  assert.equal(matchesCampaignContactExclusion({ customer_id: "VFC-999", email: " Known@Example.com " }, exclusions), true);
  assert.equal(matchesCampaignContactExclusion({ customer_id: "VFC-999", email: "new@example.com" }, exclusions), false);
});

test("selected campaigns and recent contact history load production identities and exclude the current campaign", async () => {
  const calls = [];
  const rowsByCall = [
    [{ customer_id: "vfc-1", email: "first@example.com" }],
    [{ customer_id: "vfc-2", email: "second@example.com" }],
  ];
  const supabase = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = {
        select(value) { call.select = value; return query; },
        eq(column, value) { call.filters.push(["eq", column, value]); return query; },
        neq(column, value) { call.filters.push(["neq", column, value]); return query; },
        in(column, value) { call.filters.push(["in", column, value]); return query; },
        gte(column, value) { call.filters.push(["gte", column, value]); return query; },
        async range(from, to) {
          call.range = [from, to];
          return { data: rowsByCall[calls.indexOf(call)] || [], error: null };
        },
      };
      return query;
    },
  };

  const exclusions = await loadCampaignContactExclusions(supabase, {
    recent_contact_days: 7,
    exclude_campaign_ids: [CAMPAIGN_ONE],
  }, CAMPAIGN_TWO, (result) => result);

  assert.deepEqual([...exclusions.customerIds], ["VFC-1", "VFC-2"]);
  assert.deepEqual([...exclusions.emails], ["first@example.com", "second@example.com"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].filters.find((filter) => filter[1] === "campaign_id"), ["in", "campaign_id", [CAMPAIGN_ONE]]);
  assert.deepEqual(calls[1].filters.find((filter) => filter[0] === "neq"), ["neq", "campaign_id", CAMPAIGN_TWO]);
  assert.ok(calls.every((call) => call.filters.some((filter) => filter[0] === "eq" && filter[1] === "send_type" && filter[2] === "production")));
});

test("campaign builder exposes both controls and defaults only brand-new campaigns to seven days", () => {
  const source = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  assert.match(source, /id="audienceRecentContactDays"/);
  assert.match(source, /Exclude recipients of previous campaigns/);
  assert.match(source, /audience\?\.rules \? 0 : 7/);
  assert.match(source, /exclude_campaign_ids/);
});

test("preview, prepare and confirmed sends all resolve the historical exclusions", () => {
  const previewSource = fs.readFileSync(new URL("../api/marketing-template-campaigns.js", import.meta.url), "utf8");
  const sendSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
  assert.match(previewSource, /loadCampaignContactExclusions\(supabase, rules, campaignId/);
  assert.match(previewSource, /matchesCampaignContactExclusion\(row, contactExclusions\)/);
  assert.match(sendSource, /loadCampaignContactExclusions\(supabase, rules, campaign\.id/);
  assert.match(sendSource, /const resolved = await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /const fullRecount = await resolveRecipients\(supabase, campaign\)/);
});

