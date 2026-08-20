import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ten-Reel proof is Rent2Buy-only, bounded and explicitly queued", async () => {
  const client = await readFile(new URL("../public/daily-reels/buffer-drafts.js", import.meta.url), "utf8");
  const candidates = await readFile(new URL("../api/buffer-reel-test-candidate.js", import.meta.url), "utf8");

  assert.match(client, /R2B_BATCH_SIZE = 10/);
  assert.match(client, /productKey: "rent2buy"/);
  assert.match(client, /createFacebookReelQueue/);
  assert.match(client, /confirmQueue: true/);
  assert.match(client, /window\.confirm/);
  assert.equal(client.includes("createFacebookImageQueue"), false);
  assert.equal(client.includes("shareNow"), false);

  assert.match(candidates, /MAX_BATCH = 10/);
  assert.match(candidates, /Math\.min\(MAX_BATCH, requestedLimit\)/);
  assert.match(candidates, /seen\.has\(item\.registration\)/);
});
