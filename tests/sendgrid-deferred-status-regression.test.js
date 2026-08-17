import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSendGridEvent,
  sendGridRecipientUpdates,
} from "../lib/emailProviders/sendgridWebhook.js";

function recipient(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    send_id: "00000000-0000-4000-8000-000000000002",
    campaign_id: "00000000-0000-4000-8000-000000000001",
    send_type: "production",
    customer_id: "CUST-1",
    email: "customer@example.com",
    status: "accepted",
    provider_message_id: "sendgrid-response-x-message-id",
    metadata: { email_provider: "sendgrid" },
    ...overrides,
  };
}

function deferredEvent(timestamp = 1784300000) {
  return normalizeSendGridEvent({
    sg_event_id: `event-deferred-${timestamp}`,
    sg_message_id: "sendgrid-webhook-sg-message-id",
    event: "deferred",
    email: "customer@example.com",
    timestamp,
    reason: "Temporary remote server deferral",
    marketing_campaign_id: "00000000-0000-4000-8000-000000000001",
    marketing_send_id: "00000000-0000-4000-8000-000000000002",
    marketing_recipient_id: "00000000-0000-4000-8000-000000000003",
    marketing_send_type: "production",
  });
}

test("SendGrid deferred events record deferral evidence without producing an invalid deferred recipient status", () => {
  const current = recipient({ status: "accepted" });
  const event = deferredEvent();
  const updates = sendGridRecipientUpdates(current, event);

  assert.equal(updates.deferred_at, event.event_at);
  assert.equal(updates.last_event_type, "deferred");
  assert.equal(updates.status, "accepted");
  assert.notEqual(updates.status, "deferred");
});

test("SendGrid deferred events preserve an existing valid sent status", () => {
  const current = recipient({ status: "sent" });
  const updates = sendGridRecipientUpdates(current, deferredEvent());

  assert.equal(updates.status, "sent");
});