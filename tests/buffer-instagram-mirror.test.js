import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  normalizeBufferAutomationConfig,
} from "../lib/bufferAutomation.js";
import {
  buildBufferCreatePostInput,
  selectVanFinanceInstagramChannel,
} from "../lib/bufferPublishing.js";
import {
  buildInstagramMirrorCaption,
  selectVanFinanceInstagramMirrors,
  shiftBufferDueAt,
} from "../lib/bufferInstagramMirror.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function imagePost({ id, channelId, dueAt, registration = "AB12CDE", status = "scheduled" }) {
  return {
    id,
    channelId,
    dueAt,
    status,
    text: `FROM £99 DEPOSIT\n\nREGISTRATION: ${registration}\n\nhttps://www.vanfinancecompany.co.uk/van-finance/${registration}`,
    assets: [{ mimeType: "image/jpeg", source: `https://images.example.com/${registration}.jpg` }],
  };
}

function reelPost({ id, channelId, dueAt, registration = "CD34EFG", status = "scheduled" }) {
  return {
    id,
    channelId,
    dueAt,
    status,
    text: `FROM £99 DEPOSIT\n\nREGISTRATION: ${registration}\n\nhttps://www.vanfinancecompany.co.uk/van-finance/${registration}`,
    assets: [{ mimeType: "video/mp4", source: `https://blob.example.com/${registration}.mp4` }],
  };
}

test("Instagram mirror is enabled by default without changing Facebook targets", () => {
  const config = normalizeBufferAutomationConfig(DEFAULT_BUFFER_AUTOMATION_CONFIG);
  assert.equal(config.vanFinanceInstagramEnabled, true);
  assert.equal(config.vanFinanceInstagramChannelId, "");
  assert.equal(config.instagramDelayMinutes, 10);
  assert.equal(config.vanFinancePostsPerDay, 10);
  assert.equal(config.vanFinanceReelsPerDay, 10);
  assert.equal(config.rent2buyPostsPerDay, 10);
  assert.equal(config.rent2buyReelsPerDay, 10);
});

test("Buffer Instagram inputs use native post and Reel metadata", () => {
  const image = buildBufferCreatePostInput({
    channelId: "instagram-channel",
    platform: "instagram",
    text: "REGISTRATION: AB12CDE",
    mediaUrl: "https://example.com/van.jpg",
    mediaKind: "image",
    draft: false,
    dueAt: "2026-08-22T12:10:00.000Z",
  });
  assert.equal(image.channelId, "instagram-channel");
  assert.equal(image.metadata.instagram.type, "post");
  assert.equal(image.metadata.instagram.shouldShareToFeed, true);
  assert.equal(image.metadata.instagram.isAiGenerated, false);
  assert.equal(image.metadata.facebook, undefined);

  const reel = buildBufferCreatePostInput({
    channelId: "instagram-channel",
    platform: "instagram",
    text: "REGISTRATION: CD34EFG",
    mediaUrl: "https://example.com/van.mp4",
    mediaKind: "video",
    draft: false,
    dueAt: "2026-08-22T13:10:00.000Z",
  });
  assert.equal(reel.metadata.instagram.type, "reel");
  assert.equal(reel.assets[0].video.url, "https://example.com/van.mp4");
});

test("Van Finance Instagram channel selection prefers the named account safely", () => {
  const selected = selectVanFinanceInstagramChannel([
    { id: "other", service: "instagram", displayName: "Other Brand", isDisconnected: false, isLocked: false },
    { id: "vfc", service: "instagram", name: "vanfinancecompany", isDisconnected: false, isLocked: false },
  ]);
  assert.equal(selected.id, "vfc");
});

test("Instagram caption keeps the advert but removes the dead vehicle URL", () => {
  const caption = buildInstagramMirrorCaption(
    "FROM £99 DEPOSIT\n\nREGISTRATION: AB12CDE\n\nFAST, SIMPLE APPLICATION\n\nhttps://www.vanfinancecompany.co.uk/van-finance/AB12CDE",
  );
  assert.match(caption, /FROM £99 DEPOSIT/);
  assert.match(caption, /REGISTRATION: AB12CDE/);
  assert.match(caption, /FAST, SIMPLE APPLICATION/);
  assert.doesNotMatch(caption, /https:\/\/www\.vanfinancecompany\.co\.uk\/van-finance\/AB12CDE/);
  assert.match(caption, /VIEW THIS VAN & APPLY: VANFINANCECOMPANY\.CO\.UK$/);
});

test("Instagram mirrors reuse Facebook media ten minutes later and do not duplicate", () => {
  const facebookChannelId = "finance-facebook";
  const facebookPosts = [
    imagePost({ id: "fb-image", channelId: facebookChannelId, dueAt: "2026-08-22T13:00:00.000Z" }),
    reelPost({ id: "fb-reel", channelId: facebookChannelId, dueAt: "2026-08-22T13:38:00.000Z" }),
  ];
  const mirrors = selectVanFinanceInstagramMirrors({
    facebookPosts,
    instagramPosts: [],
    facebookChannelId,
    delayMinutes: 10,
    now: new Date("2026-08-22T12:00:00.000Z"),
  });
  assert.equal(mirrors.length, 2);
  assert.equal(mirrors[0].dueAt, "2026-08-22T13:10:00.000Z");
  assert.equal(mirrors[0].mediaUrl, "https://images.example.com/AB12CDE.jpg");
  assert.equal(mirrors[1].dueAt, "2026-08-22T13:48:00.000Z");
  assert.equal(mirrors[1].mediaUrl, "https://blob.example.com/CD34EFG.mp4");

  const existingInstagram = [{
    ...facebookPosts[0],
    id: "ig-image",
    channelId: "instagram-channel",
    dueAt: "2026-08-22T13:10:00.000Z",
  }];
  const remaining = selectVanFinanceInstagramMirrors({
    facebookPosts,
    instagramPosts: existingInstagram,
    facebookChannelId,
    delayMinutes: 10,
    now: new Date("2026-08-22T12:00:00.000Z"),
  });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].registration, "CD34EFG");
});

test("Instagram delay helper preserves ISO scheduling", () => {
  assert.equal(
    shiftBufferDueAt("2026-08-22T13:38:00.000Z", 10),
    "2026-08-22T13:48:00.000Z",
  );
});

test("Instagram mirror runs after Facebook and Blob cleanup keeps a safety window", () => {
  const vercel = JSON.parse(source("vercel.json"));
  const schedules = new Map(vercel.crons.map((entry) => [entry.path, entry.schedule]));
  assert.equal(schedules.get("/api/buffer-facebook-automation-cron"), "5 * * * *");
  assert.equal(schedules.get("/api/buffer-instagram-mirror"), "14 * * * *");

  const status = source("api/buffer-publish-status.js");
  assert.match(status, /REEL_BLOB_MIN_SENT_AGE_MS = 30 \* 60 \* 1000/);
  assert.match(status, /Date\.now\(\) - sentAtMs < REEL_BLOB_MIN_SENT_AGE_MS/);
  assert.match(status, /await del\(url\)/);
});
