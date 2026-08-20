import test from "node:test";
import assert from "node:assert/strict";

import {
  bufferAutomationTarget,
  bufferPostMediaKind,
  chooseOldestFacebookCandidate,
  extractBufferRegistration,
  isBufferPostReserved,
  normalizeBufferAutomationConfig,
} from "../lib/bufferAutomation.js";
import { buildBufferCreatePostInput } from "../lib/bufferPublishing.js";
import {
  automatedReelFrameSpecs,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";

test("Buffer automation defaults hard OFF with zero daily output", () => {
  const config = normalizeBufferAutomationConfig({});
  assert.equal(config.mode, "off");
  assert.equal(config.vanFinancePostsPerDay, 0);
  assert.equal(config.rent2buyPostsPerDay, 0);
  assert.equal(config.vanFinanceReelsPerDay, 0);
  assert.equal(config.rent2buyReelsPerDay, 0);
});

test("Buffer automation counts are bounded and product separated", () => {
  const config = normalizeBufferAutomationConfig({
    mode: "queue",
    vanFinancePostsPerDay: 2,
    rent2buyPostsPerDay: 3,
    vanFinanceReelsPerDay: 1,
    rent2buyReelsPerDay: 99,
  });
  assert.equal(config.mode, "queue");
  assert.equal(bufferAutomationTarget(config, "vanFinance", "image"), 2);
  assert.equal(bufferAutomationTarget(config, "rent2buy", "image"), 3);
  assert.equal(bufferAutomationTarget(config, "vanFinance", "video"), 1);
  assert.equal(bufferAutomationTarget(config, "rent2buy", "video"), 10);
});

test("queue delivery never masquerades as a draft and still uses Buffer queue scheduling", () => {
  const input = buildBufferCreatePostInput({
    destination: "Van Finance Facebook",
    text: "REGISTRATION: AB12CDE",
    mediaUrl: "https://static.wixstatic.com/media/test.jpg",
    mediaKind: "image",
    deliveryMode: "queue",
  });
  assert.equal(input.saveToDraft, false);
  assert.equal(input.mode, "addToQueue");
  assert.equal(input.schedulingType, "automatic");
});

test("draft delivery remains the default safety boundary", () => {
  const input = buildBufferCreatePostInput({
    destination: "Rent2Buy Facebook",
    text: "REGISTRATION: AB12CDE",
    mediaUrl: "https://example.public.blob.vercel-storage.com/reel.mp4",
    mediaKind: "video",
  });
  assert.equal(input.saveToDraft, true);
  assert.deepEqual(input.metadata, { facebook: { type: "reel" } });
});

test("extracts registrations and identifies reserved Buffer work", () => {
  assert.equal(extractBufferRegistration("Van\nREGISTRATION: LJ19JBT\nApply now"), "LJ19JBT");
  assert.equal(isBufferPostReserved({ status: "draft" }), true);
  assert.equal(isBufferPostReserved({ status: "scheduled" }), true);
  assert.equal(isBufferPostReserved({ status: "sent" }), false);
  assert.equal(bufferPostMediaKind({ assets: [{ mimeType: "video/mp4" }] }), "video");
  assert.equal(bufferPostMediaKind({ assets: [{ mimeType: "image/jpeg" }] }), "image");
});

test("automatic Facebook rotation prefers never posted then oldest posted", () => {
  const vehicles = [
    { registration: "AA11AAA", image: "https://example.com/a.jpg" },
    { registration: "BB22BBB", image: "https://example.com/b.jpg" },
    { registration: "CC33CCC", image: "https://example.com/c.jpg" },
  ];
  const historyRows = [
    { metadata: { registration: "AA11AAA" }, occurred_at: "2026-08-19T10:00:00Z" },
    { metadata: { registration: "BB22BBB" }, occurred_at: "2026-08-10T10:00:00Z" },
  ];
  assert.equal(
    chooseOldestFacebookCandidate({ vehicles, historyRows })?.registration,
    "CC33CCC",
  );
  assert.equal(
    chooseOldestFacebookCandidate({ vehicles, historyRows, reservedRegistrations: ["CC33CCC"] })?.registration,
    "BB22BBB",
  );
});

test("automated Reel payload retains ten frames and direct registration link", () => {
  const frames = automatedReelFrameSpecs("rent2buy", 0);
  assert.equal(frames.length, 10);
  const caption = buildAutomatedReelCaption({
    productKey: "rent2buy",
    registration: "LJ19JBT",
    title: "Citroen Berlingo Enterprise M",
  });
  assert.match(caption, /REGISTRATION: LJ19JBT/);
  assert.match(caption, /rent2buyvans\.co\.uk\/van-pages\/LJ19JBT/);
});
