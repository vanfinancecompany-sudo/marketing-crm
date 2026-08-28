import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BUFFER_SENT_POSTS_QUERY,
  bufferDestinationForChannel,
  bufferPostMediaKind,
  bufferPublishedActivityType,
  bufferPublishedItems,
  normalizeBufferRegistration,
  parseBufferSentPostsPayload,
  summarizeBufferPublishedToday,
} from "../lib/bufferPublishStatus.js";
import {
  DEFAULT_DAILY_TARGETS,
  londonDateKey,
  summarizeDailyActivity,
} from "../lib/marketingDailyOperations.js";

test("Buffer sent-post query is read-only and restricted to the two Facebook channels", () => {
  assert.match(BUFFER_SENT_POSTS_QUERY, /status:\s*\[sent\]/);
  assert.match(BUFFER_SENT_POSTS_QUERY, /6a8721fbccaf649a67e227a3/);
  assert.match(BUFFER_SENT_POSTS_QUERY, /6a8722ffccaf649a67e22bc6/);
  assert.match(BUFFER_SENT_POSTS_QUERY, /schedulingType/);
  assert.match(BUFFER_SENT_POSTS_QUERY, /FacebookPostMetadata/);
  assert.doesNotMatch(BUFFER_SENT_POSTS_QUERY, /mutation/i);
});

test("maps Buffer channels, registrations and media kinds correctly", () => {
  assert.equal(bufferDestinationForChannel("6a8721fbccaf649a67e227a3"), "Van Finance Facebook");
  assert.equal(bufferDestinationForChannel("6a8722ffccaf649a67e22bc6"), "Rent2Buy Facebook");
  assert.equal(normalizeBufferRegistration("REGISTRATION: AB12 CDE"), "AB12CDE");
  assert.equal(normalizeBufferRegistration("REGISTRATION: XGZ4865"), "XGZ4865");
  assert.equal(bufferPostMediaKind({ assets: [{ mimeType: "video/mp4" }] }), "video");
  assert.equal(bufferPostMediaKind({ assets: [{ mimeType: "image/jpeg" }] }), "image");
  assert.equal(bufferPostMediaKind({
    schedulingType: "automatic",
    metadata: { type: "story" },
    assets: [{ mimeType: "image/jpeg" }],
  }), "story");
  assert.equal(bufferPublishedActivityType("Van Finance Facebook", "story"), "van_finance_facebook_post");
  assert.equal(bufferPublishedActivityType("Rent2Buy Facebook", "story"), "rent2buy_facebook_post");
});

test("parses and summarizes Buffer sent feed posts, Stories and Reels by London day", () => {
  const sentAt = "2026-08-20T18:00:00Z";
  const posts = parseBufferSentPostsPayload({
    data: {
      posts: {
        edges: [
          { node: { id: "p1", text: "REGISTRATION: AB12CDE", sentAt, channelId: "6a8721fbccaf649a67e227a3", assets: [{ mimeType: "image/jpeg" }] } },
          { node: { id: "p2", text: "REGISTRATION: CD34EFG", sentAt, channelId: "6a8722ffccaf649a67e22bc6", assets: [{ mimeType: "video/mp4" }] } },
          { node: { id: "p3", text: "REGISTRATION: XGZ4865", sentAt, schedulingType: "automatic", metadata: { type: "story" }, channelId: "6a8722ffccaf649a67e22bc6", assets: [{ mimeType: "image/jpeg" }] } },
        ],
      },
    },
  });
  const items = bufferPublishedItems(posts);
  assert.equal(items.length, 3);
  assert.equal(items.find((item) => item.id === "p3")?.mediaKind, "story");
  assert.equal(items.find((item) => item.id === "p3")?.registration, "XGZ4865");
  const summary = summarizeBufferPublishedToday(posts, "2026-08-20", londonDateKey);
  assert.equal(summary.vanFinance.posts, 1);
  assert.equal(summary.vanFinance.reels, 0);
  assert.equal(summary.rent2buy.posts, 1);
  assert.equal(summary.rent2buy.reels, 1);
});

test("published Reel status events do not double-count Reel generation targets", () => {
  const summary = summarizeDailyActivity({
    targets: DEFAULT_DAILY_TARGETS,
    generatedReels: [{ id: "creative-1", pipeline: "rent2buy", created_at: "2026-08-20T10:00:00Z" }],
    events: [
      {
        activity_type: "rent2buy_reel",
        quantity: 1,
        metadata: { status_event: "facebook_published", registration: "AB12CDE" },
      },
    ],
  });
  assert.equal(summary.metrics.rent2buy_reel.completed, 1);
});

test("client surfaces live Buffer confirmation in all three CRM areas", async () => {
  const bridge = await readFile(new URL("../public/buffer-live-status.js", import.meta.url), "utf8");
  assert.match(bridge, /Facebook live today/);
  assert.match(bridge, /\/van-finance-facebook/);
  assert.match(bridge, /\/rent2buy-facebook/);
  assert.match(bridge, /\/daily-reels/);
  assert.match(bridge, /Buffer confirmed/);

  const service = await readFile(new URL("../services/marketingDailyOperations.js", import.meta.url), "utf8");
  assert.match(service, /syncBufferPublishStatus/);
  assert.match(service, /buffer_publish/);

  const endpoint = await readFile(new URL("../api/buffer-publish-status.js", import.meta.url), "utf8");
  assert.match(endpoint, /source:\s*"buffer_publish"/);
  assert.match(endpoint, /facebook_published/);
  assert.match(endpoint, /facebook_live:\s*true/);
  assert.match(endpoint, /item\.mediaKind === "image"/);
});
