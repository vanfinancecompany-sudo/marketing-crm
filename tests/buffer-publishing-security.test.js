import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Buffer secrets stay server-side and queue mode requires confirmation", async () => {
  const clientFiles = [
    "index.html",
    "public/buffer-posting-bridge.js",
    "public/daily-reels/buffer-drafts.js",
    "services/bufferPublishing.js",
  ];

  for (const file of clientFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("BUFFER_API_KEY"), false, `${file} must not expose BUFFER_API_KEY`);
    assert.equal(source.includes("BUFFER_OAUTH_CLIENT_SECRET"), false, `${file} must not expose the Buffer OAuth client secret`);
    assert.equal(source.includes("Authorization: `Bearer ${token}`"), false, `${file} must not construct the Buffer bearer token`);
  }

  const apiSource = await readFile(new URL("../api/buffer-publishing.js", import.meta.url), "utf8");
  const guardSource = await readFile(new URL("../lib/bufferRuntimeGuard.js", import.meta.url), "utf8");
  const oauthSource = await readFile(new URL("../lib/bufferOAuth.js", import.meta.url), "utf8");
  assert.match(apiSource, /process\.env\.BUFFER_API_KEY/);
  assert.match(apiSource, /guardedBufferGraphql/);
  assert.match(guardSource, /resolveBufferCredential/);
  assert.match(guardSource, /Authorization: `Bearer \$\{credential\.token\}`/);
  assert.match(oauthSource, /process\.env\.BUFFER_OAUTH_CLIENT_SECRET/);
  assert.match(oauthSource, /aes-256-gcm/);
  assert.match(apiSource, /createFacebookReelQueue/);
  assert.match(apiSource, /body\.confirmQueue !== true/);
  assert.equal(apiSource.includes("shareNow"), false);
});
