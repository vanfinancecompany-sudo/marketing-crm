import test from "node:test";
import assert from "node:assert/strict";

import {
  BUFFER_FACEBOOK_CHANNELS,
  bufferChannelForDestination,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferCreatePostPayload,
  selectVanFinanceGoogleBusinessChannel,
} from "../lib/bufferPublishing.js";

test("maps both Facebook destinations to the connected Buffer channels", () => {
  assert.equal(
    bufferChannelForDestination("Van Finance Facebook"),
    "6a8721fbccaf649a67e227a3",
  );
  assert.equal(
    bufferChannelForDestination("Rent2Buy Facebook"),
    "6a8722ffccaf649a67e22bc6",
  );
  assert.equal(Object.keys(BUFFER_FACEBOOK_CHANNELS).length, 2);
});

test("maps Daily Reels products to the matching Facebook destination", () => {
  assert.equal(bufferDestinationForProduct("vanFinance"), "Van Finance Facebook");
  assert.equal(bufferDestinationForProduct("rent2buy"), "Rent2Buy Facebook");
  assert.throws(() => bufferDestinationForProduct("marketplace"));
});

test("builds a safe Facebook image draft", () => {
  const input = buildBufferCreatePostInput({
    destination: "Rent2Buy Facebook",
    text: "Test caption",
    mediaUrl: "https://static.wixstatic.com/media/test.jpg",
    mediaKind: "image",
  });

  assert.equal(input.channelId, "6a8722ffccaf649a67e22bc6");
  assert.equal(input.saveToDraft, true);
  assert.equal(input.schedulingType, "automatic");
  assert.equal(input.mode, "addToQueue");
  assert.deepEqual(input.metadata, { facebook: { type: "post" } });
  assert.deepEqual(input.assets, [
    { image: { url: "https://static.wixstatic.com/media/test.jpg" } },
  ]);
});

test("builds a three-image Facebook vehicle post in order", () => {
  const input = buildBufferCreatePostInput({
    destination: "Van Finance Facebook",
    text: "Three image vehicle post",
    mediaUrl: "https://static.wixstatic.com/media/main.jpg",
    mediaUrls: [
      "https://static.wixstatic.com/media/main.jpg",
      "https://static.wixstatic.com/media/second.jpg",
      "https://static.wixstatic.com/media/third.jpg",
      "https://static.wixstatic.com/media/fourth.jpg",
    ],
    mediaKind: "image",
    draft: false,
  });

  assert.deepEqual(input.assets, [
    { image: { url: "https://static.wixstatic.com/media/main.jpg" } },
    { image: { url: "https://static.wixstatic.com/media/second.jpg" } },
    { image: { url: "https://static.wixstatic.com/media/third.jpg" } },
  ]);
});

test("builds a safe Facebook reel draft", () => {
  const input = buildBufferCreatePostInput({
    destination: "Van Finance Facebook",
    text: "Reel caption",
    mediaUrl: "https://example.public.blob.vercel-storage.com/reel.mp4",
    mediaKind: "video",
  });

  assert.equal(input.channelId, "6a8721fbccaf649a67e227a3");
  assert.equal(input.saveToDraft, true);
  assert.deepEqual(input.metadata, { facebook: { type: "reel" } });
  assert.deepEqual(input.assets, [
    { video: { url: "https://example.public.blob.vercel-storage.com/reel.mp4" } },
  ]);
});

test("builds an explicitly queued Facebook Reel", () => {
  const input = buildBufferCreatePostInput({
    destination: "Rent2Buy Facebook",
    text: "Queued Reel",
    mediaUrl: "https://example.public.blob.vercel-storage.com/reel.mp4",
    mediaKind: "video",
    draft: false,
  });

  assert.equal(input.channelId, "6a8722ffccaf649a67e22bc6");
  assert.equal(input.saveToDraft, false);
  assert.equal(input.schedulingType, "automatic");
  assert.equal(input.mode, "addToQueue");
  assert.deepEqual(input.metadata, { facebook: { type: "reel" } });
});

test("builds a Google Business Whats New post with Learn more CTA", () => {
  const input = buildBufferCreatePostInput({
    channelId: "google-channel-1",
    platform: "googlebusiness",
    text: "VAN FINANCE COMPANY STOCK\n\nREGISTRATION: AB12CDE",
    mediaUrl: "https://example.com/van.jpg",
    mediaKind: "image",
    draft: false,
    dueAt: "2026-09-27T09:00:00.000Z",
    linkUrl: "https://www.vanfinancecompany.co.uk/van-finance/ab12cde",
  });

  assert.equal(input.channelId, "google-channel-1");
  assert.equal(input.mode, "customScheduled");
  assert.equal(input.saveToDraft, false);
  assert.deepEqual(input.assets, [{ image: { url: "https://example.com/van.jpg" } }]);
  assert.deepEqual(input.metadata, {
    google: {
      type: "whats_new",
      detailsWhatsNew: {
        button: "learn_more",
        link: "https://www.vanfinancecompany.co.uk/van-finance/ab12cde",
      },
    },
  });
});

test("selects the connected Van Finance Google Business channel safely", () => {
  const selected = selectVanFinanceGoogleBusinessChannel([
    { id: "fb", service: "facebook", name: "Van Finance Company" },
    { id: "gbp", service: "googlebusiness", name: "Van Finance Company", displayName: "Van Finance Company", isDisconnected: false, isLocked: false },
  ]);
  assert.equal(selected.id, "gbp");
});

test("rejects unsafe media URLs and unsupported destinations", () => {
  assert.throws(() => buildBufferCreatePostInput({
    destination: "Van Finance Facebook",
    text: "Caption",
    mediaUrl: "http://example.com/image.jpg",
  }), /public HTTPS URL/);

  assert.throws(() => buildBufferCreatePostInput({
    destination: "Facebook Marketplace",
    text: "Caption",
    mediaUrl: "https://example.com/image.jpg",
  }), /Unsupported Facebook destination/);
});

test("parses Buffer success and typed errors", () => {
  assert.equal(
    parseBufferCreatePostPayload({
      data: { createPost: { post: { id: "post-123", text: "hello" } } },
    }).id,
    "post-123",
  );

  assert.throws(
    () => parseBufferCreatePostPayload({
      data: { createPost: { message: "Invalid post" } },
    }),
    /Invalid post/,
  );
});
