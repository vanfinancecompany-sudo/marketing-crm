import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplicationReceivedCrmEvent,
  forwardApplicationReceivedCrmEvent,
  isApplicationReceivedSendGridPayload,
} from "../lib/applicationReceivedEventForwarder.js";

function payload(overrides = {}) {
  return {
    event: "delivered",
    crm_lead_id: "lead-123",
    application_type: "rent2buy",
    application_ref: "APP-123",
    acknowledgement_send_id: "lead-123:attempt-2",
    transactional_template: "Rent2Buy Application Received",
    category: ["transactional", "application-received"],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    provider_event_id: "sendgrid:event:event-1",
    provider_message_id: "message-1.filter123",
    event_type: "delivered",
    event_at: "2026-08-12T13:30:00.000Z",
    reason: null,
    ...overrides,
  };
}

test("application acknowledgement SendGrid payload is recognised without campaign correlation", () => {
  assert.equal(isApplicationReceivedSendGridPayload(payload()), true);
  assert.equal(isApplicationReceivedSendGridPayload({ event: "delivered", email: "x@example.com" }), false);
});

test("acknowledgement event carries the exact send attempt into the CRM delivery contract", () => {
  assert.deepEqual(buildApplicationReceivedCrmEvent(payload(), event()), {
    lead_id: "lead-123",
    application_type: "rent2buy",
    application_ref: "APP-123",
    acknowledgement_send_id: "lead-123:attempt-2",
    provider: "sendgrid",
    provider_event_id: "sendgrid:event:event-1",
    provider_message_id: "message-1.filter123",
    event_type: "delivered",
    event_at: "2026-08-12T13:30:00.000Z",
    reason: "",
  });
});

test("unknown SendGrid events are not forwarded to the CRM", () => {
  assert.equal(buildApplicationReceivedCrmEvent(payload(), event({ event_type: "unknown" })), null);
});

test("CRM forwarding uses the shared server key and remains best effort", async () => {
  const calls = [];
  const ok = await forwardApplicationReceivedCrmEvent({
    payload: payload(),
    event: event(),
    endpoint: "https://crm.example.test/api/application-received-email-event",
    apiKey: "shared-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(ok.forwarded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-marketing-customer-database-key"], "shared-secret");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.event_type, "delivered");
  assert.equal(body.acknowledgement_send_id, "lead-123:attempt-2");

  const failed = await forwardApplicationReceivedCrmEvent({
    payload: payload(),
    event: event(),
    endpoint: "https://crm.example.test/api/application-received-email-event",
    apiKey: "shared-secret",
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(failed.forwarded, false);
  assert.equal(failed.skipped, false);
  assert.equal(failed.reason, "crm_http_503");
});
