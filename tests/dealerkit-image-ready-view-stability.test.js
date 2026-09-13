import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const transform = fs.readFileSync(new URL("../scripts/apply-dealerkit-image-ready-view-stability.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("DealerKit photo-ready view limits initial rendering and lazy-loads images", () => {
  assert.match(transform, /const IMAGE_READY_RENDER_BATCH = 18/);
  assert.match(transform, /loading="lazy" decoding="async" fetchPriority="low"/);
  assert.match(transform, /filteredRecords\.slice\(0, visibleCount\)/);
  assert.match(transform, /Show 18 more photo-ready vehicles/);
});

test("production build applies the DealerKit photo-ready view stability transform", () => {
  assert.match(packageJson.scripts.build, /apply-dealerkit-image-ready-view-stability\.mjs/);
});
