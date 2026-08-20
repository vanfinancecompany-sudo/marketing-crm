import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Buffer secret stays server-side and queue mode requires confirmation", async () => {
  const clientFiles = [
    "index.html",
    "public/buffer-posting-bridge.js",
    "public/daily-reels/buffer-drafts.js",
    "services/bufferPublishing.js",
  ];

  for (const file of clientFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("BUFFER_API_KEY"), false, `${file} must not expose BUFFER_API_KEY`);
    assert.equal(source.includes("Authorization: `Bearer ${token}`"), false, `${file} must not construct the Buffer bearer token`);
  }

  const apiSource = await readFile(new URL("../api/buffer-publishing.js", import.meta.url), "utf8");
  assert.match(apiSource, /process\.env\.BUFFER_API_KEY/);
  assert.match(apiSource, /Authorization: `Bearer \$\{token\}`/);
  assert.match(apiSource, /createFacebookReelQueue/);
  assert.match(apiSource, /body\.confirmQueue !== true/);
  assert.equal(apiSource.includes("shareNow"), false);
});
