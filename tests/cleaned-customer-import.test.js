import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImportResult,
  buildPossibleDuplicateResult,
  decideCleanedImportAction,
  emptyCleanedImportCounts,
  importResultsToCsv,
} from "../lib/cleanedCustomerImport.js";
import { cleanImportRow, mergeContactPayload } from "../lib/marketingCustomerUpsert.js";

function awaiting(overrides = {}) {
  return { id: "row-1", customer_id: "VFC-123", email: "person@example.com", email_normalized: "person@example.com", lifecycle_status: "awaiting_verification", marketing_status: "active", sources: ["legacy"], tags: [], notes: "Keep this note", ...overrides };
}

function simulate(rows, contacts) {
  const database = new Map(contacts.map((contact) => [contact.email_normalized, structuredClone(contact)]));
  const seen = new Set();
  const counts = emptyCleanedImportCounts(rows.length);
  const results = [];
  for (const row of rows) {
    const cleaned = cleanImportRow(row, "finance");
    if (!cleaned.contact) { counts.invalidRows += 1; results.push({ result: "invalid" }); continue; }
    const email = cleaned.contact.email_normalized;
    if (seen.has(email)) { counts.duplicateUploadRows += 1; results.push({ result: "duplicate_upload" }); continue; }
    seen.add(email);
    const existing = database.get(email);
    const action = decideCleanedImportAction(existing);
    counts[action.countKey] += 1;
    if (!existing) database.set(email, { ...cleaned.contact, customer_id: `NEW-${database.size + 1}` });
    else if (["promoted", "restored"].includes(action.result)) database.set(email, { ...existing, ...mergeContactPayload(existing, cleaned.contact, { matchedOn: "email", fillMissingOnly: true, incrementDuplicate: false }) });
    results.push({ result: action.result });
  }
  return { database, counts, results };
}

test("Awaiting Verification cleaned contact is promoted to Active", () => {
  assert.equal(decideCleanedImportAction(awaiting()).result, "promoted");
  const result = simulate([{ Email: " Person@Example.com " }], [awaiting()]);
  assert.equal(result.database.get("person@example.com").lifecycle_status, "active");
  assert.equal(result.counts.promotedContacts, 1);
});

test("promotion preserves the existing customer ID", () => {
  const result = simulate([{ Email: "person@example.com" }], [awaiting()]);
  assert.equal(result.database.get("person@example.com").customer_id, "VFC-123");
});

test("promotion preserves campaign, delivery, suppression, activity and notes history", () => {
  const existing = awaiting({ campaign_history: ["campaign-1"], delivery_events: ["delivered-1"], suppression_history: [{ active: false }], activity: ["note-added"] });
  const result = simulate([{ Email: "person@example.com", Notes: "Replacement note" }], [existing]).database.get("person@example.com");
  assert.deepEqual(result.campaign_history, ["campaign-1"]);
  assert.deepEqual(result.delivery_events, ["delivered-1"]);
  assert.deepEqual(result.suppression_history, [{ active: false }]);
  assert.deepEqual(result.activity, ["note-added"]);
  assert.equal(result.notes, "Keep this note");
});

test("existing Active contact is reported without being duplicated or modified", () => {
  const active = awaiting({ lifecycle_status: "active", duplicate_count: 4 });
  const result = simulate([{ Email: "person@example.com", Company: "Incoming" }], [active]);
  assert.equal(result.database.size, 1);
  assert.equal(result.database.get("person@example.com").duplicate_count, 4);
  assert.equal(result.counts.alreadyActive, 1);
});

test("new verified contact is created as Active", () => {
  const result = simulate([{ Email_Address: "new@example.com" }], []);
  assert.equal(result.database.get("new@example.com").lifecycle_status, "active");
  assert.equal(result.counts.newActiveContacts, 1);
});

test("suppressed contact remains suppressed", () => {
  const suppressed = awaiting({ lifecycle_status: "suppressed", marketing_status: "suppressed" });
  const result = simulate([{ Email: "person@example.com" }], [suppressed]);
  assert.equal(result.database.get("person@example.com").lifecycle_status, "suppressed");
  assert.equal(result.counts.suppressedContacts, 1);
});

test("duplicate normalised CSV rows are processed once", () => {
  const result = simulate([{ Email: "NEW@example.com" }, { Email: " new@example.com " }], []);
  assert.equal(result.database.size, 1);
  assert.equal(result.counts.newActiveContacts, 1);
  assert.equal(result.counts.duplicateUploadRows, 1);
});

test("invalid and missing emails are rejected clearly", () => {
  assert.match(cleanImportRow({ Email: "bad" }, "finance").reason, /invalid email/i);
  assert.match(cleanImportRow({ Phone: "07123456789" }, "finance").reason, /missing email/i);
  const result = simulate([{ Email: "bad" }, { Phone: "07123456789" }], []);
  assert.equal(result.counts.invalidRows, 2);
});

test("re-importing the same cleaned file is idempotent", () => {
  const first = simulate([{ Email: "new@example.com" }], []);
  const second = simulate([{ Email: "new@example.com" }], [...first.database.values()]);
  assert.equal(second.database.size, 1);
  assert.equal(second.counts.newActiveContacts, 0);
  assert.equal(second.counts.alreadyActive, 1);
});

test("promoted outcomes and import-results CSV are separate from rejected outcomes", () => {
  const action = decideCleanedImportAction(awaiting());
  const row = buildImportResult({ email: "PERSON@example.com", action, previousLifecycle: "awaiting_verification", customerId: "VFC-123" });
  const csv = importResultsToCsv([row]);
  assert.equal(action.countKey, "promotedContacts");
  assert.match(csv, /person@example\.com,promoted/);
  assert.match(csv, /awaiting_verification,active,VFC-123/);
});

test("168 existing Awaiting Verification contacts are promoted, not rejected as duplicates", () => {
  const contacts = Array.from({ length: 168 }, (_, index) => awaiting({ id: `row-${index}`, customer_id: `VFC-${index}`, email: `person${index}@example.com`, email_normalized: `person${index}@example.com` }));
  const rows = contacts.map((contact) => ({ Email: contact.email }));
  const result = simulate(rows, contacts);
  assert.equal(result.counts.promotedContacts, 168);
  assert.equal(result.counts.otherRejectedRows, 0);
  assert.equal(result.counts.invalidRows, 0);
});

test("possible name and postcode duplicate produces a valid audit result and creates the verified contact once", () => {
  const database = new Map([["existing@example.com", { customer_id: "VFC-77", first_name: "Sam", last_name: "Smith", postcode: "SO40 2NN", lifecycle_status: "active" }]]);
  const cleaned = cleanImportRow({ Email: "new@example.com", "First Name": "Sam", "Last Name": "Smith", Postcode: "SO40 2NN" }, "finance");
  const possible = database.get("existing@example.com");

  assert.doesNotThrow(() => buildPossibleDuplicateResult(cleaned.contact.email_normalized, possible));
  const audit = buildPossibleDuplicateResult(cleaned.contact.email_normalized, possible);
  database.set(cleaned.contact.email_normalized, { ...cleaned.contact, customer_id: "VFC-78" });

  assert.equal(database.size, 2);
  assert.equal([...database.keys()].filter((email) => email === "new@example.com").length, 1);
  assert.deepEqual(audit, {
    email: "new@example.com",
    result: "possible_duplicate",
    reason: "Same normalized name and postcode",
    previous_lifecycle_status: "active",
    new_lifecycle_status: "active",
    existing_customer_id: "VFC-77",
  });
});
