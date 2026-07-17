import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES,
  createCurrentSendEligibilityState,
  evaluateCurrentSendEligibility,
  loadCurrentSendProcessedIdentities,
} from "../lib/marketingCurrentSendEligibility.js";

const eligibleContact = (overrides = {}) => ({
  customer_id: "VFC-1",
  email: "customer@example.com",
  email_ready: true,
  lifecycle_status: "active",
  marketing_status: "active",
  suppression: {},
  ...overrides,
});

test("shared current-send eligibility enforces lifecycle, verification, suppression and valid email", () => {
  assert.equal(evaluateCurrentSendEligibility(eligibleContact(), { state: createCurrentSendEligibilityState() }).eligible, true);
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ lifecycle_status: "awaiting_verification" }), { state: createCurrentSendEligibilityState() }).reason, "inactive");
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ lifecycle_status: "suppressed" }), { state: createCurrentSendEligibilityState() }).reason, "inactive");
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ email_ready: false }), { state: createCurrentSendEligibilityState() }).reason, "invalid_email");
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ email: "invalid" }), { state: createCurrentSendEligibilityState() }).reason, "invalid_email");
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ suppression: { email_bounced: { active: true } } }), { state: createCurrentSendEligibilityState() }).reason, "suppressed");
});

test("shared current-send eligibility rejects processed and duplicate recipients", () => {
  const processed = createCurrentSendEligibilityState({ customerIds: new Set(["VFC-1"]), emails: new Set() });
  assert.equal(evaluateCurrentSendEligibility(eligibleContact(), { state: processed }).reason, "previously_processed");
  const state = createCurrentSendEligibilityState();
  assert.equal(evaluateCurrentSendEligibility(eligibleContact(), { state }).eligible, true);
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ customer_id: "VFC-2" }), { state }).reason, "duplicate");
});

function processedRecipientSupabase(rows) {
  const calls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    in(column, statuses) { calls.push({ column, statuses }); return this; },
    async range() { return { data: rows, error: null }; },
  };
  return { supabase: { from() { return query; } }, calls };
}

test("only existing provider-submission or later statuses block a current send", async () => {
  assert.deepEqual(CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES, ["accepted", "sent", "delivered", "opened", "clicked", "submission_unknown"]);
  assert.equal(CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES.includes("failed"), false);
  assert.equal(CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES.includes("pending"), false);

  const { supabase, calls } = processedRecipientSupabase([{ customer_id: "VFC-1", email: "sent@example.com" }]);
  const processed = await loadCurrentSendProcessedIdentities(supabase, "campaign-1");
  assert.deepEqual(calls[0], { column: "status", statuses: CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES });
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ email: "sent@example.com" }), { state: createCurrentSendEligibilityState(processed) }).reason, "previously_processed");
  assert.equal(evaluateCurrentSendEligibility(eligibleContact({ customer_id: "VFC-FAILED", email: "failed@example.com" }), { state: createCurrentSendEligibilityState() }).eligible, true);
});

test("processed recipient rows are deduplicated for Campaign Progress", async () => {
  const { supabase } = processedRecipientSupabase([
    { customer_id: "VFC-1", email: "one@example.com" },
    { customer_id: "VFC-1", email: "one@example.com" },
    { customer_id: "VFC-2", email: "one@example.com" },
    { customer_id: "VFC-3", email: "three@example.com" },
  ]);
  const processed = await loadCurrentSendProcessedIdentities(supabase, "campaign-1");
  assert.equal(processed.uniqueRecipientCount, 2);
  const sendSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
  assert.match(sendSource, /const alreadyProcessed = resolved\.processed\.uniqueRecipientCount/);
  assert.doesNotMatch(sendSource, /processedResult\.count/);
  assert.match(sendSource, /const totalAudience = alreadyProcessed \+ eligibleRemaining/);
});

test("preview, progress, prepare and confirm use the shared current-send resolver", () => {
  const previewSource = fs.readFileSync(new URL("../api/marketing-template-campaigns.js", import.meta.url), "utf8");
  const sendSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
  assert.match(previewSource, /evaluateCurrentSendEligibility/);
  assert.match(previewSource, /totalMatching !== suppressed \+ skippedDuplicate \+ deliverable/);
  assert.match(sendSource, /const resolved = await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /const fullRecount = await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /async function getCampaignProgress[\s\S]*?await resolveRecipients\(supabase, campaign\)/);
  assert.match(sendSource, /resolveRecipients[\s\S]*?loadCurrentSendProcessedIdentities\(supabase, campaign\.id, assertSupabase\)/);
});

test("Suppression Centre shows the four truthful lifecycle cards", () => {
  const source = fs.readFileSync(new URL("../public/suppression-centre/index.html", import.meta.url), "utf8");
  for (const label of ["Total Stored Contacts", "Verified / Active", "Awaiting Verification", "Suppressed"]) assert.match(source, new RegExp(label.replace("/", "\\/")));
  assert.doesNotMatch(source, /\["Active Contacts", overview\.active_contacts\]/);
});

test("Campaign Builder preview stays in its column and becomes static in one-column layout", () => {
  const source = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  assert.match(source, /campaign-preview-column[^}]*position: static[^}]*z-index: auto/);
  assert.match(source, /@media \(max-width: 1040px\)[^{]*\{[^}]*\.detail-grid[^}]*grid-template-columns: 1fr/);
  assert.match(source, /#previewFrameShell[^}]*position: static/);
  assert.match(source, /#previewFrame[^}]*position: static/);
  assert.doesNotMatch(source, /campaign-preview-column[^}]*position:\s*(?:fixed|absolute|sticky)/);
  assert.match(source, /id="previewFrameShell"/);
});
