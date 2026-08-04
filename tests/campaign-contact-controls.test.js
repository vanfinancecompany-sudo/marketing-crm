import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acceptedWithinRecentContactWindow,
  CONTACT_HISTORY_RECIPIENT_STATUSES,
  isGenuineProductionContactWithinWindow,
  loadCampaignContactExclusions,
  matchesCampaignContactExclusion,
  matchesMinimumFrequencyLock,
  matchesRecentContactExclusion,
  normalizeCampaignContactControls,
} from "../lib/marketingCampaignContactControls.js";

const CAMPAIGN_ONE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_TWO = "22222222-2222-4222-8222-222222222222";

test("campaign contact controls enforce a seven-day floor for new and existing saved rules", () => {
  assert.deepEqual(normalizeCampaignContactControls({}), {
    recent_contact_days: 7,
    exclude_campaign_ids: [],
  });
  assert.equal(normalizeCampaignContactControls({ recent_contact_days: 0 }).recent_contact_days, 7);
  assert.equal(normalizeCampaignContactControls({ recent_contact_days: 3 }).recent_contact_days, 7);
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
  assert.throws(() => normalizeCampaignContactControls({ recent_contact_days: 10 }), /supported recent-contact period/i);
  assert.throws(() => normalizeCampaignContactControls({ exclude_campaign_ids: ["not-a-campaign"] }), /not valid/i);
});

test("campaign contact controls allow no more than four previous campaigns", () => {
  const campaignIds = Array.from({ length: 5 }, (_, index) => `${index + 1}1111111-1111-4111-8111-111111111111`);
  assert.throws(() => normalizeCampaignContactControls({ exclude_campaign_ids: campaignIds }), /maximum of four/i);
});

test("contact history includes submitted production outcomes but not draft or failed recipients", () => {
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("accepted"));
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("delivered"));
  assert.ok(CONTACT_HISTORY_RECIPIENT_STATUSES.includes("submission_unknown"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("pending"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("failed"));
  assert.ok(!CONTACT_HISTORY_RECIPIENT_STATUSES.includes("skipped"));
});

test("rolling window excludes acceptance today and six days ago but allows exactly seven days", () => {
  const now = Date.parse("2026-08-04T12:00:00.000Z");
  assert.equal(acceptedWithinRecentContactWindow("2026-08-04T11:59:59.000Z", 7, now), true);
  assert.equal(acceptedWithinRecentContactWindow("2026-07-29T12:00:00.000Z", 7, now), true);
  assert.equal(acceptedWithinRecentContactWindow("2026-07-28T12:00:00.000Z", 7, now), false);
});

test("longer selected recent-contact restrictions remain effective", () => {
  const now = Date.parse("2026-08-04T12:00:00.000Z");
  assert.equal(acceptedWithinRecentContactWindow("2026-07-25T12:00:00.000Z", 14, now), true);
  assert.equal(acceptedWithinRecentContactWindow("2026-07-25T12:00:00.000Z", 7, now), false);
});

test("test emails and failed provider submissions do not trigger the frequency lock", () => {
  const now = Date.parse("2026-08-04T12:00:00.000Z");
  assert.equal(isGenuineProductionContactWithinWindow({ send_type: "test", first_sent_at: "2026-08-04T11:00:00.000Z" }, 7, now), false);
  assert.equal(isGenuineProductionContactWithinWindow({ send_type: "production", status: "failed", first_sent_at: null }, 7, now), false);
  assert.equal(isGenuineProductionContactWithinWindow({ send_type: "production", status: "accepted", first_sent_at: "2026-08-04T11:00:00.000Z" }, 7, now), true);
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
  const now = Date.parse("2026-08-04T12:00:00.000Z");
  const calls = [];
  const rowsByCall = [
    [{ customer_id: "vfc-1", email: "first@example.com" }],
    [{ email: "Second@Example.com", first_sent_at: "2026-08-03T12:00:00.000Z", send_type: "production" }],
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
        gt(column, value) { call.filters.push(["gt", column, value]); return query; },
        not(column, operator, value) { call.filters.push(["not", column, operator, value]); return query; },
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
  }, CAMPAIGN_TWO, (result) => result, now);

  assert.deepEqual([...exclusions.customerIds], ["VFC-1"]);
  assert.deepEqual([...exclusions.emails], ["first@example.com", "second@example.com"]);
  assert.equal(matchesRecentContactExclusion({ email: " SECOND@example.com " }, exclusions), true);
  assert.equal(matchesMinimumFrequencyLock({ email: "second@example.com" }, exclusions), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].filters.find((filter) => filter[1] === "campaign_id"), ["in", "campaign_id", [CAMPAIGN_ONE]]);
  assert.ok(calls.every((call) => call.filters.some((filter) => filter[0] === "eq" && filter[1] === "send_type" && filter[2] === "production")));
  assert.ok(calls[1].filters.some((filter) => filter[0] === "not" && filter[1] === "first_sent_at"));
  assert.ok(calls[1].filters.some((filter) => filter[0] === "gt" && filter[1] === "first_sent_at"));
});

test("campaign builder exposes both controls and never offers less than seven days", () => {
  const source = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  assert.match(source, /id="audienceRecentContactDays"/);
  assert.match(source, /Exclude recipients of previous campaigns/);
  assert.doesNotMatch(source, /value="0">No recent-contact restriction/);
  assert.doesNotMatch(source, /value="3">Last 3 days/);
  assert.match(source, /Math\.max\(7, Number\(rules\.recent_contact_days \|\| 7\)\)/);
  assert.match(source, /exclude_campaign_ids/);
  assert.match(source, /\.slice\(0, 4\)/);
  assert.match(source, /Apply &amp; Save Audience/);
  assert.match(source, /marketing:campaign-audience-saved/);
});

test("saving audience controls refreshes Campaign Progress immediately", () => {
  const source = fs.readFileSync(new URL("../public/campaigns/sending-foundation.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("marketing:campaign-audience-saved"/);
  assert.match(source, /refreshSending\(\)/);
});

test("preview, prepare and confirmed sends all resolve the historical exclusions", () => {
  const previewSource = fs.readFileSync(new URL("../api/marketing-template-campaigns.js", import.meta.url), "utf8");
  const sendSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
  assert.match(previewSource, /loadCampaignContactExclusions\(supabase, rules, campaignId/);
  assert.match(previewSource, /matchesRecentContactExclusion\(row, contactExclusions\)/);
  assert.match(previewSource, /matchesPreviousCampaignContactExclusion\(row, contactExclusions\)/);
  assert.match(sendSource, /loadCampaignContactExclusions\(supabase, rules, campaign\.id/);
  assert.match(sendSource, /const resolved = await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /const fullRecount = await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /marketing_email_send_recipients"\)\.insert/);
});

test("hard database lock uses normalized production email, accepted evidence, and ignores test or failed rows", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/031_email_template_seven_day_contact_lock.sql", import.meta.url), "utf8");
  assert.match(migration, /new\.send_type <> 'production'/);
  assert.match(migration, /lower\(trim\(existing\.email\)\) = lower\(trim\(new\.email\)\)/);
  assert.match(migration, /existing\.status = 'pending'/);
  assert.match(migration, /existing\.first_sent_at > now\(\) - interval '7 days'/);
  assert.doesNotMatch(migration, /existing\.status = 'failed'/);
  assert.match(migration, /template_campaign_foundation/);
});

test("audience and confirmation expose the required seven-day counts", () => {
  const campaignSource = fs.readFileSync(new URL("../api/marketing-template-campaigns.js", import.meta.url), "utf8");
  const sendSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
  const uiSource = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  for (const source of [campaignSource, sendSource]) {
    assert.match(source, /eligible_before_recent_contact_restriction/);
    assert.match(source, /minimum_frequency_lock_excluded/);
    assert.match(source, /final_(send|eligible)_count/);
  }
  assert.match(uiSource, /Eligible before recent-contact restriction/);
  assert.match(uiSource, /Excluded because emailed within the last 7 days/);
  assert.match(uiSource, /Final eligible audience/);
});

test("new and duplicated Email Templates require a fresh server-enforced audience", () => {
  const source = fs.readFileSync(new URL("../api/marketing-template-campaigns.js", import.meta.url), "utf8");
  const audienceNullAssignments = source.match(/audience_snapshot: null/g) || [];
  assert.ok(audienceNullAssignments.length >= 2);
  assert.match(source, /normalizeCampaignContactControls\(values/);
});
