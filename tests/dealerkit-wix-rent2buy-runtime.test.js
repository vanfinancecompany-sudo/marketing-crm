import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("post-transform Rent2Buy reserved action binds the real draft mutation function", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.match(source, /const mutate = mutateMatch \|\| setDraftMatch;/);
  assert.doesNotMatch(source, /const mutate = mutateMatch \|\| unpublishMatch;/);
  assert.match(source, /async function setDraftMatch\(match\)/);
});
