import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES } from "../lib/marketingCurrentSendEligibility.js";
import { summarizeRecipientRows } from "../api/marketing-template-campaign-send-worker.js";
import { inspectOrphanReservation } from "../api/marketing-template-campaign-send-orphan-worker.js";
import { reservationIsSafeToRecover } from "../api/marketing-template-campaign-sends-hardened.js";

test("pending campaign recipients are reserved from future campaign batches", () => {
  assert.equal(CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES.includes("pending"), true);
});

test("processed campaign history uses deterministic pagination beyond 1000 recipients", () => {
  const eligibility = fs.readFileSync(new URL("../lib/marketingCurrentSendEligibility.js", import.meta.url), "utf8");
  assert.match(eligibility, /\.select\("id,customer_id,email"\)/);
  assert.match(eligibility, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(eligibility, /\.range\(from, from \+ 999\)/);
});

test("queued campaign progress distinguishes pending, accepted, failed and unknown recipients", () => {
  const summary = summarizeRecipientRows([
    { status: "pending" },
    { status: "accepted" },
    { status: "delivered" },
    { status: "failed" },
    { status: "submission_unknown" },
    { status: "skipped_suppressed" },
  ]);
  assert.deepEqual(summary, {
    total: 6,
    pending: 1,
    accepted: 2,
    failed: 1,
    unknown: 1,
    suppressed: 1,
    finished: 5,
  });
});

test("production confirmation route queues work and never submits email inline", () => {
  const router = fs.readFileSync(new URL("../api/marketing-template-campaign-sends-router.js", import.meta.url), "utf8");
  assert.match(router, /dispatch_mode:\s*"queued_worker"/);
  assert.match(router, /status:\s*"pending"/);
  assert.doesNotMatch(router, /callEmailProvider/);
});

test("stranded reservation recovery requires a fully queued, never-attempted batch", () => {
  const send = {
    id: "send-1",
    campaign_id: "campaign-1",
    send_type: "production",
    status: "sending",
    requested_count: 2,
    metadata: {
      queue_state: "reserving",
      queued_recipient_count: 2,
      campaign_snapshot: { id: "campaign-1" },
    },
  };
  const recipients = [
    { status: "pending", provider_message_id: null, last_event_at: null, metadata: {} },
    { status: "pending", provider_message_id: null, last_event_at: null, metadata: {} },
  ];
  assert.equal(reservationIsSafeToRecover(send, recipients), true);

  assert.equal(
    reservationIsSafeToRecover(send, [
      recipients[0],
      { ...recipients[1], metadata: { provider_attempt_started_at: "2026-08-26T11:56:00.000Z" } },
    ]),
    false,
  );
  assert.equal(
    reservationIsSafeToRecover({ ...send, metadata: { ...send.metadata, queue_state: "sending" } }, recipients),
    false,
  );
});

test("orphan worker queues a complete pristine reservation and releases an incomplete pristine one", () => {
  const now = new Date("2026-08-26T13:00:00.000Z").getTime();
  const send = {
    id: "send-2",
    campaign_id: "campaign-2",
    send_type: "production",
    status: "sending",
    requested_count: 2,
    created_at: "2026-08-26T12:50:00.000Z",
    metadata: {
      queue_state: "reserving",
      campaign_snapshot: { id: "campaign-2" },
    },
  };
  const pristine = [
    { status: "pending", provider_message_id: null, provider_event_id: null, first_sent_at: null, last_event_at: null, metadata: {} },
    { status: "pending", provider_message_id: null, provider_event_id: null, first_sent_at: null, last_event_at: null, metadata: {} },
  ];

  assert.deepEqual(inspectOrphanReservation(send, pristine, now), {
    action: "queue",
    reason: "fully_reserved_pristine",
    reserved: 2,
    requested: 2,
  });
  assert.deepEqual(inspectOrphanReservation(send, pristine.slice(0, 1), now), {
    action: "release",
    reason: "incomplete_pristine_reservation",
    reserved: 1,
    requested: 2,
  });
});

test("orphan worker refuses automatic retry when provider evidence exists", () => {
  const now = new Date("2026-08-26T13:00:00.000Z").getTime();
  const send = {
    id: "send-3",
    campaign_id: "campaign-3",
    send_type: "production",
    status: "sending",
    requested_count: 1,
    created_at: "2026-08-26T12:50:00.000Z",
    metadata: {
      queue_state: "reserving",
      campaign_snapshot: { id: "campaign-3" },
    },
  };
  const decision = inspectOrphanReservation(send, [{
    status: "pending",
    provider_message_id: null,
    provider_event_id: null,
    first_sent_at: null,
    last_event_at: "2026-08-26T12:51:00.000Z",
    metadata: { provider_attempt_started_at: "2026-08-26T12:51:00.000Z" },
  }], now);
  assert.equal(decision.action, "attention");
  assert.equal(decision.reason, "provider_evidence_present");
});

test("hardened dispatcher repairs only safe queue-finalisation failures", () => {
  const hardened = fs.readFileSync(new URL("../api/marketing-template-campaign-sends-hardened.js", import.meta.url), "utf8");
  assert.match(hardened, /capture\.statusCode >= 500/);
  assert.match(hardened, /recoverSafelyReservedQueue/);
  assert.match(hardened, /queue_state:\s*"queued"/);
  assert.match(hardened, /dispatch_mode:\s*"queued_worker"/);
  assert.doesNotMatch(hardened, /callEmailProvider/);
});

test("Vercel runs orphan repair and queued sender every minute", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(
    config.rewrites.some((entry) => entry.source === "/api/marketing-template-campaign-sends" && entry.destination === "/api/marketing-template-campaign-sends-resilient"),
    true,
  );
  assert.equal(
    config.crons.some((entry) => entry.path === "/api/marketing-template-campaign-send-orphan-worker" && entry.schedule === "* * * * *"),
    true,
  );
  assert.equal(
    config.crons.some((entry) => entry.path === "/api/marketing-template-campaign-send-worker" && entry.schedule === "* * * * *"),
    true,
  );
  assert.equal(config.functions["api/marketing-template-campaign-send-orphan-worker.js"]?.maxDuration, 60);
  assert.equal(config.functions["api/marketing-template-campaign-send-worker.js"]?.maxDuration, 300);
});
