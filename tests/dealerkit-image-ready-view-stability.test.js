import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const stockWatchPage = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");

test("ImageReadyCard is defined whenever the Stock Watch render path references it", () => {
  const rendersImageReadyCard = stockWatchPage.includes('record.displayStatus === "images_ready" ? <ImageReadyCard');
  if (!rendersImageReadyCard) return;

  assert.match(stockWatchPage, /function ImageReadyCard\(\{ record \}\)/);
});
