import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getVfcPricingReviewHold } from "../lib/vfcPricingReviewHolds.mjs";

const root = new URL("../", import.meta.url);

test("historical car holds explain the real underlying Wix mismatch instead of just reporting a price gap", () => {
  const mercedes = getVfcPricingReviewHold("JM10 ASM");
  assert.match(mercedes.issue, /monthly payments disagreed/i);
  assert.match(mercedes.evidence, /£292\/month; detail was £307\/month/);
  const ford = getVfcPricingReviewHold("LM70 YPT");
  assert.match(ford.issue, /cash prices disagreed/i);
  assert.match(ford.evidence, /£16,495; detail was £16,995/);
  assert.equal(getVfcPricingReviewHold("AB24 CDE"), null);
});

test("unexplained historical holds are described as unverified, never assigned a fabricated root cause", () => {
  const unknown = getVfcPricingReviewHold("FL71 GZW");
  assert.match(unknown.evidence, /not recorded/i);
  assert.match(unknown.check, /VAT basis/i);
});

test("price preview explains historical holds and rechecks exact Wix rows", async () => {
  const src = await readFile(new URL("api/dealerkit-published-price.js", root), "utf8");
  assert.match(src, /review_hold: getVfcPricingReviewHold\(vehicle\.registration\)/);
  assert.match(src, /verifyHeldPriceReview\(body, vehicle, preview\)/);
  assert.match(src, /approval\?\.confirmed !== true/);
  assert.match(src, /approval\?\.decision !== "use_fresh_dealerkit_price"/);
  assert.match(src, /vehicle\.sourceMode !== "fresh_dealerkit"/);
  assert.match(src, /CARFINANCE", "CARPAGES/);
  assert.match(src, /VANFINANCE-ALLVANS", "VANFINANCEPAGES/);
  assert.match(src, /confirmationMatchesPreview\(body\.confirmation, preview\)/);
  assert.doesNotMatch(src, /isVfcPricingReviewHeld\(vehicle\.registration\)\) throw new ApiError/);
});

test("UI displays individual current and proposed Wix prices and requires explicit approval for historical holds", async () => {
  const client = await readFile(new URL("utils/vanscoWixPriceHelper.js", root), "utf8");
  assert.match(client, /Current Wix:/);
  assert.match(client, /Proposed:/);
  assert.match(client, /getVfcPricingReviewHold\(details\.registration\)/);
  assert.match(client, /holdCheckbox\.type = "checkbox"/);
  assert.match(client, /cleanRegistration\(holdRegistration\?\.value\) === preview\.registration/);
  assert.match(client, /decision: "use_fresh_dealerkit_price"/);
  assert.match(client, /holdReview/);
});
