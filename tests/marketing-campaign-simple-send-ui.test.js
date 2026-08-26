import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  summarizeRecipientStatuses,
  summarizeSendProgress,
} from "../api/marketing-template-campaign-send-progress.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function source(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("send progress uses durable worker counters", () => {
  const progress = summarizeSendProgress({
    id: "send-1",
    campaign_id: "campaign-1",
    status: "sending",
    requested_count: 500,
    sent_count: 118,
    failed_count: 1,
    metadata: {
      queue_state: "sending",
      processed_count: 120,
      pending_count: 380,
      skipped_suppressed_count: 1,
      submission_unknown_count: 0,
    },
  });

  assert.equal(progress.requested, 500);
  assert.equal(progress.processed, 120);
  assert.equal(progress.pending, 380);
  assert.equal(progress.accepted, 118);
  assert.equal(progress.progress_percent, 24);
  assert.equal(progress.phase, "sending");
});

test("live recipient states advance the progress bar before the parent row refreshes", () => {
  const live = summarizeRecipientStatuses([
    { status: "accepted" },
    { status: "delivered" },
    { status: "skipped_suppressed" },
    { status: "failed" },
    { status: "pending" },
  ]);
  const progress = summarizeSendProgress({
    id: "send-2",
    campaign_id: "campaign-1",
    status: "sending",
    requested_count: 5,
    sent_count: 0,
    failed_count: 0,
    metadata: { queue_state: "sending", processed_count: 0, pending_count: 5 },
  }, live);

  assert.equal(progress.processed, 4);
  assert.equal(progress.pending, 1);
  assert.equal(progress.accepted, 2);
  assert.equal(progress.failed, 1);
  assert.equal(progress.suppressed, 1);
  assert.equal(progress.progress_percent, 80);
});

test("one-click send automatically prepares then confirms the same batch", () => {
  const ui = source("public/campaigns/simple-send-flow.js");
  assert.match(ui, /prepareProductionSend/);
  assert.match(ui, /confirmProductionSend/);
  assert.match(ui, /confirmation_phrase:\s*preparation\.confirmation_phrase/);
  assert.match(ui, /simpleSendBatchButton/);
  assert.match(ui, /simpleBatchProgress/);
  assert.match(ui, /marketing-template-campaign-send-progress/);
  assert.match(ui, /oldPrepare\.hidden = true/);
  assert.match(ui, /oldConfirm\.hidden = true/);
  assert.match(ui, /oldCancel\.hidden = true/);
});

test("campaign page loader enables the simple send experience after the legacy foundation loads", () => {
  const loader = source("public/campaigns/campaign-send-payload.js");
  assert.match(loader, /simple-send-flow\.js/);
  assert.match(loader, /DOMContentLoaded/);
});
