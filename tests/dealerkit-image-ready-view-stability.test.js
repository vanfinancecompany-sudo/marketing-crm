import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const priceTransform = fs.readFileSync(new URL("../scripts/apply-dealerkit-price-difference-expansion.mjs", import.meta.url), "utf8");
const stockWatchPage = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");

test("price-difference transform stops before the next Stock Watch card component", () => {
  assert.match(priceTransform, /ImageReadyCard\|WatchCard/);
  assert.doesNotMatch(
    priceTransform,
    /function PriceDifferenceCard\\\(\\\{ record \\\}\\\)[\s\S]*function WatchCard\/,
    "price-difference transform must not consume components inserted between PriceDifferenceCard and WatchCard",
  );
});

test("ImageReadyCard is defined whenever the Stock Watch render path references it", () => {
  const rendersImageReadyCard = stockWatchPage.includes('record.displayStatus === "images_ready" ? <ImageReadyCard');
  if (!rendersImageReadyCard) return;

  assert.match(stockWatchPage, /function ImageReadyCard\(\{ record \}\)/);
});
