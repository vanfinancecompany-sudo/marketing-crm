import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const apiSource = () => fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
const transformSource = () => fs.readFileSync(new URL("../scripts/apply-rent2buy-legacy-draft-stability.mjs", import.meta.url), "utf8");

test("legacy Rent2Buy Wix Draft tasks get a longer completion window", () => {
  const source = apiSource();
  assert.match(source, /const TASK_MAX_POLLS = 30;/);
  assert.match(source, /const TASK_POLL_DELAY_MS = 1000;/);
});

test("old RENT2BUY VANS Wix Draft tasks are settled sequentially while the live mirror can run in parallel", () => {
  const source = apiSource();
  assert.match(source, /async function settleDraftMatchesSafely\(matches\)/);
  assert.match(source, /const legacySiteId = RENT2BUY_WIX_SITES\[1\]\.id;/);
  assert.match(source, /await Promise\.all\(directMatches\.map/);
  assert.match(source, /for \(const \{ match, index \} of legacyMatches\)/);
  assert.match(source, /const settled = await settleDraftMatchesSafely\(preview\.matches\);/);
  assert.doesNotMatch(source, /Promise\.allSettled\(preview\.matches\.map\(setDraftMatch\)\)/);
});

test("legacy stability change preserves the Rent2Buy safety barriers", () => {
  const source = apiSource();
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.match(source, /VAN PAGES is hard protected and can never be moved to draft/);
  assert.match(source, /WDE0308\|Draft items are not enabled/);
  assert.match(source, /SET_DRAFT_STATUS/);
});

test("build transform contains the queue-stability patch", () => {
  const source = transformSource();
  assert.match(source, /TASK_MAX_POLLS = 30/);
  assert.match(source, /settleDraftMatchesSafely/);
  assert.match(source, /legacyMatches/);
});
