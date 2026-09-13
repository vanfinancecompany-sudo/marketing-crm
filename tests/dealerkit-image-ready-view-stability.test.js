import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const stockWatchPage = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
const finalSafetyTransform = fs.readFileSync(new URL("../scripts/apply-dealerkit-photo-ready-final-safety.mjs", import.meta.url), "utf8");

test("final photo-ready safety keeps normal galleries out of the due-in queue", () => {
  assert.match(finalSafetyTransform, /advertImageCount >= 1/);
  assert.match(finalSafetyTransform, /advertImageCount <= 2/);
  assert.match(finalSafetyTransform, /sourceImageCount >= 5/);
  assert.match(finalSafetyTransform, /sourceImageCount > advertImageCount/);

  if (stockWatchPage.includes("FINAL_DEALERKIT_PHOTO_READY_RENDER_SAFETY")) {
    assert.match(stockWatchPage, /advertImageCount >= 1/);
    assert.match(stockWatchPage, /advertImageCount <= 2/);
  }
});

test("final photo-ready rows use a dedicated actionable card instead of the transformed general WatchCard", () => {
  assert.match(finalSafetyTransform, /function PhotoReadyActionCard\(\{ record, selectedPipeline, onRecordSaved \}\)/);
  assert.match(finalSafetyTransform, /isPhotoReadyWorkflowRecord\(record\) \? <PhotoReadyActionCard/);
  assert.match(finalSafetyTransform, /Review vehicle/);
  assert.match(finalSafetyTransform, /Never show again/);
  assert.match(finalSafetyTransform, /Mark as advertised/);
  assert.match(finalSafetyTransform, /saveVanscoWatchAction/);

  if (stockWatchPage.includes("FINAL_DEALERKIT_PHOTO_READY_RENDER_SAFETY")) {
    assert.match(stockWatchPage, /function PhotoReadyActionCard\(\{ record, selectedPipeline, onRecordSaved \}\)/);
    assert.match(stockWatchPage, /isPhotoReadyWorkflowRecord\(record\) \? <PhotoReadyActionCard/);
    assert.match(stockWatchPage, /FINAL_DEALERKIT_RESERVATION_UI_SAFETY/);
  }
});
