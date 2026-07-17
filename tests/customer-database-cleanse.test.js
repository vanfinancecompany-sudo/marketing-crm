import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviouslyDeliveredRows,
  campaignRecipientIdentitySets,
  contactHasPermanentSuppression,
  normalizeEmailIdentity,
} from "../lib/customerDatabaseCleanse.js";
import { cleanImportRow, mergeContactPayload } from "../lib/marketingCustomerUpsert.js";
import { getCustomerDatabaseSafetyExport } from "../services/marketingContacts.js";

test("normalises campaign email identities", () => {
  assert.equal(normalizeEmailIdentity("  Person@Example.COM "), "person@example.com");
  const identities = campaignRecipientIdentitySets([
    { customer_id: "vfc-1", email: " Person@Example.COM " },
    { customer_id: "VFC-1", email: "person@example.com" },
  ]);
  assert.deepEqual([...identities.customerIds], ["VFC-1"]);
  assert.deepEqual([...identities.emails], ["person@example.com"]);
});

test("exports only unique production recipients with a confirmed eligible delivery", () => {
  const recipients = [
    { id: "recipient-1", campaign_id: "campaign-1", send_type: "production", customer_id: "VFC-1", email: "ONE@example.com", status: "delivered" },
    { id: "recipient-2", campaign_id: "campaign-2", send_type: "production", customer_id: "VFC-1", email: "one@example.com", status: "delivered" },
    { id: "recipient-3", campaign_id: "campaign-1", send_type: "test", customer_id: "VFC-2", email: "test@example.com", status: "delivered" },
  ];
  const events = [
    { id: "event-1", recipient_id: "recipient-1", campaign_id: "campaign-1", event_type: "delivered", event_at: "2026-01-01T10:00:00Z" },
    { id: "event-2", recipient_id: "recipient-2", campaign_id: "campaign-2", event_type: "delivered", event_at: "2026-02-01T10:00:00Z" },
    { id: "event-3", recipient_id: "recipient-3", campaign_id: "campaign-1", event_type: "delivered", event_at: "2026-03-01T10:00:00Z" },
  ];
  const rows = buildPreviouslyDeliveredRows({
    events,
    recipients,
    campaigns: [{ id: "campaign-1", name: "First" }, { id: "campaign-2", name: "Latest" }],
    contacts: [{ customer_id: "VFC-1", email: "one@example.com", first_name: "One", pipeline: "both", lifecycle_status: "awaiting_verification" }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    customer_id: "VFC-1",
    first_name: "One",
    last_name: "",
    email: "one@example.com",
    phone: "",
    company: "",
    postcode: "",
    customer_type: "both",
    classification: "both",
    pipeline: "both",
    delivered_date: "2026-02-01T10:00:00Z",
    campaign_name: "Latest",
    last_email_status: "delivered",
  });
});

test("excludes later hard bounces and any unsubscribe, complaint or permanent suppression", () => {
  const recipient = { id: "recipient", campaign_id: "campaign", send_type: "production", customer_id: "VFC-1", email: "one@example.com" };
  const delivery = { recipient_id: "recipient", event_type: "delivered", event_at: "2026-02-01T10:00:00Z" };
  const base = { recipients: [recipient], campaigns: [], contacts: [], events: [delivery] };
  assert.equal(buildPreviouslyDeliveredRows({ ...base, events: [delivery, { recipient_id: "recipient", event_type: "hard_bounce", event_at: "2026-02-02T10:00:00Z" }] }).length, 0);
  assert.equal(buildPreviouslyDeliveredRows({ ...base, events: [{ recipient_id: "recipient", event_type: "unsubscribed", event_at: "2026-01-01T10:00:00Z" }, delivery] }).length, 0);
  assert.equal(buildPreviouslyDeliveredRows({ ...base, events: [{ recipient_id: "recipient", event_type: "complaint", event_at: "2026-01-01T10:00:00Z" }, delivery] }).length, 0);
  assert.equal(buildPreviouslyDeliveredRows({ ...base, suppressedEmails: new Set(["one@example.com"]) }).length, 0);
  assert.equal(contactHasPermanentSuppression({ suppression: { email_bounced: { active: true } } }), true);
});

test("restoring by normalised email preserves classification unless CSV explicitly changes it", () => {
  const implicit = cleanImportRow({ Email: " Archived@Example.com ", "First Name": "Updated" }, "unknown");
  assert.equal(implicit.contact.email_normalized, "archived@example.com");
  assert.equal(implicit.pipelineExplicit, false);
  const existing = {
    customer_id: "VFC-42",
    first_name: "Original",
    email: "archived@example.com",
    email_normalized: "archived@example.com",
    pipeline: "finance",
    lifecycle_status: "awaiting_verification",
    sources: ["legacy"],
    tags: [],
  };
  const restored = mergeContactPayload(existing, implicit.contact, { matchedOn: "email", pipelineExplicit: implicit.pipelineExplicit });
  assert.equal(restored.lifecycle_status, "active");
  assert.equal(restored.pipeline, "finance");
  assert.equal(restored.first_name, "Updated");

  const explicit = cleanImportRow({ Email: "archived@example.com", Classification: "Both" }, "unknown");
  const updated = mergeContactPayload(existing, explicit.contact, { matchedOn: "email", pipelineExplicit: explicit.pipelineExplicit });
  assert.equal(updated.pipeline, "both");
});

test("invalid supplied email is rejected instead of falling back to the phone", () => {
  const result = cleanImportRow({ Email: "not-an-email", Phone: "07123456789" }, "finance");
  assert.equal(result.contact, null);
  assert.equal(result.invalidEmail, true);
});

test("assembles a paged full-database safety export with one CSV header", async (context) => {
  const originalFetch = globalThis.fetch;
  const pages = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    pages.push(body.page);
    const exportPage = body.page === 0
      ? { filename: "full.csv", count: 2, csv: "customer_id,email\nVFC-1,one@example.com", page: 0, done: false }
      : { filename: "full.csv", count: 2, csv: "VFC-2,two@example.com", page: 1, done: true };
    return new Response(JSON.stringify({ ok: true, export: exportPage }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await getCustomerDatabaseSafetyExport("exportFull");
  assert.deepEqual(pages, [0, 1]);
  assert.equal(result.csv, "customer_id,email\nVFC-1,one@example.com\nVFC-2,two@example.com");
  assert.equal(result.csv.match(/customer_id,email/g)?.length, 1);
});
