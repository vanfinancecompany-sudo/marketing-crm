import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  normalizeSendGridEvent,
  processSendGridEvent,
  readRawRequestBody,
  verifySendGridRecipientHints,
  verifySendGridSignature,
} from "../lib/emailProviders/sendgridWebhook.js";

function rawPublicKey(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]).toString("base64");
}

function signedWebhook(payload) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = "1784300000";
  const signature = crypto.sign("sha256", Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("base64");
  return { rawBody, timestamp, signature, verificationKey: rawPublicKey(publicKey) };
}

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

function eventPayload(event, overrides = {}) {
  return {
    sg_event_id: `event-${event}`,
    sg_message_id: "sendgrid-webhook-sg-message-id",
    event,
    email: "customer@example.com",
    timestamp: 1784300000,
    marketing_campaign_id: "00000000-0000-4000-8000-000000000001",
    marketing_send_id: "00000000-0000-4000-8000-000000000002",
    marketing_recipient_id: "00000000-0000-4000-8000-000000000003",
    marketing_send_type: "production",
    ...overrides,
  };
}

function repositoryFor(matchedRecipient) {
  const state = { eventIds: new Set(), updates: [], suppressions: [], suppressionKeys: new Set() };
  return {
    state,
    async findRecipient(event) {
      return verifySendGridRecipientHints(matchedRecipient, event.hints) ? matchedRecipient : null;
    },
    async insertEvent(event) {
      if (state.eventIds.has(event.provider_event_id)) return { duplicate: true };
      state.eventIds.add(event.provider_event_id);
      return { duplicate: false };
    },
    async updateRecipient(id, updates) { state.updates.push({ id, updates }); },
    async applySuppression(row, event, suppression) {
      const key = `${row.email}:${suppression.type}`;
      if (state.suppressionKeys.has(key)) return;
      state.suppressionKeys.add(key);
      state.suppressions.push({ row, event, suppression });
    },
  };
}

test("SendGrid signature verification uses the exact raw request bytes", () => {
  const signed = signedWebhook([eventPayload("delivered")]);
  assert.equal(verifySendGridSignature(signed), true);
  assert.equal(verifySendGridSignature({ ...signed, rawBody: Buffer.concat([signed.rawBody, Buffer.from(" ")]) }), false);
});

test("raw request stream is consumed before Vercel's parsed body getter", async () => {
  let parsedBodyAccessed = false;
  const request = {
    readableEnded: false,
    get body() {
      parsedBodyAccessed = true;
      throw new Error("Parsed body must not be accessed.");
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('[{"event":"delivered"}]');
    },
  };
  const rawBody = await readRawRequestBody(request);
  assert.equal(rawBody.toString("utf8"), '[{"event":"delivered"}]');
  assert.equal(parsedBodyAccessed, false);
});

test("all required SendGrid event names map to existing reporting statuses", () => {
  const mappings = new Map([
    ["delivered", "delivered"],
    ["bounce", "hard_bounce"],
    ["dropped", "invalid_email"],
    ["deferred", "deferred"],
    ["spamreport", "complaint"],
    ["unsubscribe", "unsubscribed"],
    ["open", "opened"],
    ["click", "clicked"],
  ]);
  for (const [providerEvent, expected] of mappings) {
    const extra = providerEvent === "bounce"
      ? { type: "bounce", status: "5.1.1" }
      : providerEvent === "dropped"
        ? { reason: "Invalid recipient address" }
        : {};
    assert.equal(normalizeSendGridEvent(eventPayload(providerEvent, extra)).event_type, expected);
  }
});

test("non-address SendGrid drops do not create permanent invalid-email status", () => {
  const event = normalizeSendGridEvent(eventPayload("dropped", { reason: "Invalid SMTPAPI header" }));
  assert.equal(event.event_type, "blocked");
});

test("duplicate SendGrid webhook delivery is idempotent", async () => {
  const repository = repositoryFor(recipient());
  const event = normalizeSendGridEvent(eventPayload("delivered"));
  const first = await processSendGridEvent(repository, event);
  const second = await processSendGridEvent(repository, event);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(repository.state.eventIds.size, 1);
  assert.equal(repository.state.updates.length, 2);
  assert.equal(repository.state.suppressions.length, 0);
});

test("duplicate permanent events repair side effects without duplicating suppression identity", async () => {
  const repository = repositoryFor(recipient());
  const event = normalizeSendGridEvent(eventPayload("unsubscribe"));
  await processSendGridEvent(repository, event);
  await processSendGridEvent(repository, event);
  assert.equal(repository.state.eventIds.size, 1);
  assert.equal(repository.state.suppressions.length, 1);
});

test("signed custom IDs correlate even though X-Message-ID and sg_message_id differ", async () => {
  const matchedRecipient = recipient();
  const event = normalizeSendGridEvent(eventPayload("delivered"));
  assert.notEqual(matchedRecipient.provider_message_id, event.provider_message_id);
  assert.equal(verifySendGridRecipientHints(matchedRecipient, event.hints), true);
});

test("hard bounce creates a permanent email-bounce suppression for production recipients", async () => {
  const repository = repositoryFor(recipient());
  const event = normalizeSendGridEvent(eventPayload("bounce", { type: "bounce", status: "5.1.1", reason: "Mailbox not found" }));
  const result = await processSendGridEvent(repository, event);
  assert.equal(result.suppressed, true);
  assert.equal(repository.state.updates[0].updates.status, "hard_bounced");
  assert.equal(repository.state.suppressions[0].suppression.type, "email_bounced");
});

test("unsubscribe creates a permanent unsubscribe suppression for production recipients", async () => {
  const repository = repositoryFor(recipient());
  const event = normalizeSendGridEvent(eventPayload("unsubscribe"));
  await processSendGridEvent(repository, event);
  assert.equal(repository.state.updates[0].updates.status, "unsubscribed");
  assert.equal(repository.state.suppressions[0].suppression.type, "email_unsubscribed");
});

test("test-send webhook events never create production suppressions", async () => {
  const testRecipient = recipient({ send_type: "test", customer_id: null });
  const repository = repositoryFor(testRecipient);
  const event = normalizeSendGridEvent(eventPayload("bounce", {
    type: "bounce",
    status: "5.1.1",
    reason: "Mailbox not found",
    marketing_send_type: "test",
  }));
  const result = await processSendGridEvent(repository, event);
  assert.equal(result.correlated, true);
  assert.equal(result.suppressed, false);
  assert.equal(repository.state.suppressions.length, 0);
});

test("conflicting recipient hints remain uncorrelated and cannot suppress another customer", async () => {
  const repository = repositoryFor(recipient());
  const event = normalizeSendGridEvent(eventPayload("bounce", {
    type: "bounce",
    status: "5.1.1",
    email: "different@example.com",
  }));
  const result = await processSendGridEvent(repository, event);
  assert.equal(result.correlated, false);
  assert.equal(result.suppressed, false);
  assert.equal(repository.state.updates.length, 0);
  assert.equal(repository.state.suppressions.length, 0);
});

test("dropped invalid addresses map to permanent bounce protection", () => {
  const event = normalizeSendGridEvent(eventPayload("dropped", { reason: "Invalid recipient address" }));
  assert.equal(event.event_type, "invalid_email");
});
