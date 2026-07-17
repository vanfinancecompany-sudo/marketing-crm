import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveProductionRecipientReporting } from "../lib/marketingRecipientOutcomes.js";

function recipient(id, overrides = {}) {
  return {
    id,
    send_id: "send-1",
    campaign_id: "campaign-1",
    send_type: "production",
    email: `${id}@example.com`,
    status: "accepted",
    provider_message_id: `message-${id}`,
    first_sent_at: "2026-07-17T10:00:00Z",
    ...overrides,
  };
}

function event(recipientId, eventType, eventAt, overrides = {}) {
  return {
    id: `${recipientId}-${eventType}-${eventAt}`,
    recipient_id: recipientId,
    send_id: "send-1",
    campaign_id: "campaign-1",
    event_type: eventType,
    event_at: eventAt,
    ...overrides,
  };
}

function unsubmittedRecipient(id, status) {
  return recipient(id, {
    status,
    provider_message_id: null,
    first_sent_at: null,
    created_at: "2026-07-17T09:00:00Z",
  });
}

test("pending with only created_at is not accepted", () => {
  const reporting = resolveProductionRecipientReporting([unsubmittedRecipient("pending", "pending")], []);
  assert.equal(reporting.accepted, 0);
  assert.equal(reporting.recipient_outcomes[0].status, "pending");
});

test("failed with only created_at remains a failed operational outcome", () => {
  const reporting = resolveProductionRecipientReporting([unsubmittedRecipient("failed", "failed")], []);
  assert.equal(reporting.accepted, 0);
  assert.equal(reporting.failed, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "failed");
});

test("skipped_suppressed remains a non-accepted operational outcome", () => {
  const reporting = resolveProductionRecipientReporting([unsubmittedRecipient("suppressed", "skipped_suppressed")], []);
  assert.equal(reporting.accepted, 0);
  assert.equal(reporting.skipped_suppressed, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "skipped_suppressed");
});

test("skipped_duplicate remains a non-accepted operational outcome", () => {
  const reporting = resolveProductionRecipientReporting([unsubmittedRecipient("duplicate", "skipped_duplicate")], []);
  assert.equal(reporting.accepted, 0);
  assert.equal(reporting.skipped_duplicate, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "skipped_duplicate");
});

test("submission_unknown without provider evidence is not accepted", () => {
  const reporting = resolveProductionRecipientReporting([unsubmittedRecipient("unknown", "submission_unknown")], []);
  assert.equal(reporting.accepted, 0);
  assert.equal(reporting.submission_unknown, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "submission_unknown");
});

test("first_sent_at is genuine accepted evidence", () => {
  const reporting = resolveProductionRecipientReporting([recipient("sent", { provider_message_id: null })], []);
  assert.equal(reporting.accepted, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "accepted");
});

test("provider_message_id is genuine accepted evidence", () => {
  const reporting = resolveProductionRecipientReporting([recipient("message", { status: "pending", first_sent_at: null })], []);
  assert.equal(reporting.accepted, 1);
  assert.equal(reporting.recipient_outcomes[0].status, "accepted");
});

test("deferred followed by delivered resolves to one delivered recipient", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "deferred", "2026-07-17T10:01:00Z"),
    event("one", "delivered", "2026-07-17T10:02:00Z"),
  ]);
  assert.equal(reporting.delivered, 1);
  assert.equal(reporting.deferred, 0);
  assert.equal(reporting.temporary_failures_before_delivery, 1);
});

test("soft bounce followed by delivered resolves to one delivered recipient", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "soft_bounce", "2026-07-17T10:01:00Z"),
    event("one", "delivered", "2026-07-17T10:02:00Z"),
  ]);
  assert.equal(reporting.delivered, 1);
  assert.equal(reporting.soft_bounced, 0);
  assert.equal(reporting.bounce_rate, 0);
});

test("duplicate delivered events count one recipient outcome", () => {
  const delivered = event("one", "delivered", "2026-07-17T10:02:00Z");
  const reporting = resolveProductionRecipientReporting([recipient("one")], [delivered, { ...delivered, id: "duplicate" }]);
  assert.equal(reporting.accepted, 1);
  assert.equal(reporting.delivered, 1);
  assert.equal(reporting.delivery_rate, 100);
});

test("duplicate bounce events count one recipient outcome", () => {
  const bounced = event("one", "hard_bounce", "2026-07-17T10:02:00Z");
  const reporting = resolveProductionRecipientReporting([recipient("one")], [bounced, { ...bounced, id: "duplicate" }]);
  assert.equal(reporting.hard_bounced, 1);
  assert.equal(reporting.bounce_rate, 100);
});

test("an older deferred event cannot replace a later delivered outcome", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "delivered", "2026-07-17T10:02:00Z"),
    event("one", "deferred", "2026-07-17T10:01:00Z"),
  ]);
  assert.equal(reporting.recipient_outcomes[0].status, "delivered");
  assert.equal(reporting.deferred, 0);
});

test("a lower-precedence accepted event cannot replace a soft bounce", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "soft_bounce", "2026-07-17T10:01:00Z"),
    event("one", "accepted", "2026-07-17T10:02:00Z"),
  ]);
  assert.equal(reporting.recipient_outcomes[0].status, "soft_bounced");
});

test("a true final hard bounce remains hard bounced", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "hard_bounce", "2026-07-17T10:02:00Z"),
  ]);
  assert.equal(reporting.hard_bounced, 1);
  assert.equal(reporting.delivered, 0);
});

test("a true final soft bounce with no delivery remains soft bounced", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], [
    event("one", "soft_bounce", "2026-07-17T10:02:00Z"),
  ]);
  assert.equal(reporting.soft_bounced, 1);
  assert.equal(reporting.delivered, 0);
});

test("an accepted recipient with no final event stays in the denominator", () => {
  const reporting = resolveProductionRecipientReporting([recipient("one")], []);
  assert.equal(reporting.accepted, 1);
  assert.equal(reporting.delivered, 0);
  assert.equal(reporting.recipient_outcomes[0].status, "accepted");
});

test("rates use unique final recipient outcomes and delivered engagement denominators", () => {
  const recipients = [recipient("one"), recipient("two"), recipient("three"), recipient("four")];
  const reporting = resolveProductionRecipientReporting(recipients, [
    event("one", "delivered", "2026-07-17T10:01:00Z"),
    event("one", "opened", "2026-07-17T10:02:00Z"),
    event("one", "opened", "2026-07-17T10:03:00Z"),
    event("one", "clicked", "2026-07-17T10:04:00Z"),
    event("one", "unsubscribed", "2026-07-17T10:05:00Z"),
    event("two", "delivered", "2026-07-17T10:01:00Z"),
    event("three", "soft_bounce", "2026-07-17T10:01:00Z"),
    event("four", "blocked", "2026-07-17T10:01:00Z"),
  ]);
  assert.deepEqual({
    accepted: reporting.accepted,
    delivered: reporting.delivered,
    soft: reporting.soft_bounced,
    blocked: reporting.blocked,
    deliveryRate: reporting.delivery_rate,
    bounceRate: reporting.bounce_rate,
    openRate: reporting.open_rate,
    clickRate: reporting.click_rate,
    unsubscribeRate: reporting.unsubscribe_rate,
    openEvents: reporting.open_events,
  }, {
    accepted: 4,
    delivered: 2,
    soft: 1,
    blocked: 1,
    deliveryRate: 50,
    bounceRate: 50,
    openRate: 50,
    clickRate: 50,
    unsubscribeRate: 25,
    openEvents: 2,
  });
});

test("test sends and their events are excluded from production metrics", () => {
  const reporting = resolveProductionRecipientReporting([
    recipient("production"),
    recipient("test", { send_type: "test", status: "hard_bounced" }),
  ], [
    event("production", "delivered", "2026-07-17T10:01:00Z"),
    event("test", "hard_bounce", "2026-07-17T10:01:00Z"),
  ]);
  assert.equal(reporting.accepted, 1);
  assert.equal(reporting.delivered, 1);
  assert.equal(reporting.hard_bounced, 0);
});

test("the reported 21 delivered and 18 temporary failures resolve to 21 final deliveries", () => {
  const recipients = Array.from({ length: 21 }, (_, index) => recipient(`recipient-${index + 1}`));
  const events = recipients.flatMap((row, index) => [
    ...(index < 18 ? [event(row.id, "soft_bounce", "2026-07-17T10:01:00Z")] : []),
    event(row.id, "delivered", "2026-07-17T10:02:00Z"),
  ]);
  const reporting = resolveProductionRecipientReporting(recipients, events);
  assert.deepEqual({
    accepted: reporting.accepted,
    delivered: reporting.delivered,
    soft: reporting.soft_bounced,
    hard: reporting.hard_bounced,
    blocked: reporting.blocked,
    temporaryThenDelivered: reporting.temporary_failures_before_delivery,
    deliveryRate: reporting.delivery_rate,
    bounceRate: reporting.bounce_rate,
  }, {
    accepted: 21,
    delivered: 21,
    soft: 0,
    hard: 0,
    blocked: 0,
    temporaryThenDelivered: 18,
    deliveryRate: 100,
    bounceRate: 0,
  });
});

test("dashboard and Campaign Builder reporting import the same recipient resolver", () => {
  const dashboard = fs.readFileSync(new URL("../api/marketing-dashboard.js", import.meta.url), "utf8");
  const campaign = fs.readFileSync(new URL("../api/marketing-template-campaign-reporting.js", import.meta.url), "utf8");
  for (const source of [dashboard, campaign]) {
    assert.match(source, /import \{ resolveProductionRecipientReporting \} from "\.\.\/lib\/marketingRecipientOutcomes\.js"/);
    assert.match(source, /resolveProductionRecipientReporting\(/);
  }
});
