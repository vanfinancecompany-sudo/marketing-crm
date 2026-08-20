import test from "node:test";
import assert from "node:assert/strict";

import {
  BUFFER_FACEBOOK_CHANNELS,
  bufferChannelForDestination,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferCreatePostPayload,
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
