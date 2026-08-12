import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeApplicationReceivedPayload } from "../lib/applicationReceivedEmail.js";

test("transactional acknowledgement normalization preserves the Main CRM send attempt ID", () => {
  const payload = normalizeApplicationReceivedPayload({
    lead_id: "lead-1",
    application_type: "rent2buy",
    acknowledgement_send_id: "lead-1:attempt-2",
    customer_email: "customer@example.com",
  });
  assert.equal(payload.acknowledgementSendId, "lead-1:attempt-2");
});

test("SendGrid custom args carry the acknowledgement send attempt into signed webhook events", () => {
  const source = fs.readFileSync(new URL("../api/transactional-application-received.js", import.meta.url), "utf8");
  assert.match(source, /acknowledgement_send_id:\s*payload\.acknowledgementSendId/);
  assert.match(source, /crm_lead_id:\s*payload\.leadId/);
  assert.match(source, /categories:\s*\["transactional", "application-received"\]/);
});
