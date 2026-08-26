import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES } from "../lib/marketingCurrentSendEligibility.js";
import { summarizeRecipientRows } from "../api/marketing-template-campaign-send-worker.js";
import { reservationIsSafeToRecover } from "../api/marketing-template-campaign-sends-hardened.js";

test("pending campaign recipients are reserved from future campaign batches", () => {
  assert.equal(CURRENT_SEND_PROCESSED_RECIPIENT_STATUSES.includes("pending"), true);
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

test("hardened dispatcher repairs only safe queue-finalisation failures", () => {
  const hardened = fs.readFileSync(new URL("../api/marketing-template-campaign-sends-hardened.js", import.meta.url), "utf8");
  assert.match(hardened, /capture\.statusCode >= 500/);
  assert.match(hardened, /recoverSafelyReservedQueue/);
  assert.match(hardened, /queue_state:\s*"queued"/);
  assert.match(hardened, /dispatch_mode:\s*"queued_worker"/);
  assert.doesNotMatch(hardened, /callEmailProvider/);
});

test("Vercel routes campaign sends through the hardened queue dispatcher and runs the worker every minute", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(
    config.rewrites.some((entry) => entry.source === "/api/marketing-template-campaign-sends" && entry.destination === "/api/marketing-template-campaign-sends-hardened"),
    true,
  );
  assert.equal(
    config.crons.some((entry) => entry.path === "/api/marketing-template-campaign-send-worker" && entry.schedule === "* * * * *"),
    true,
  );
  assert.equal(config.functions["api/marketing-template-campaign-send-worker.js"]?.maxDuration, 300);
});
