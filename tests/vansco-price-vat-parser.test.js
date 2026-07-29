import test from "node:test";
import assert from "node:assert/strict";
import { extractAdvertisedPriceAndVat } from "../api/_vansco-price-parser.js";

test("extracts a plus VAT advertised price", () => {
  const result = extractAdvertisedPriceAndVat(`
    <html><body><div class="vehicle-price">£12,295 + VAT</div></body></html>
  `);

  assert.equal(result.advertised_price, 12295);
  assert.equal(result.vat_status, "plus_vat");
  assert.equal(result.advertised_price_text, "£12,295 + VAT");
});

test("extracts a no VAT advertised price", () => {
  const result = extractAdvertisedPriceAndVat(`
    <html><body><div class="price">£15,995 NO VAT</div></body></html>
  `);

  assert.equal(result.advertised_price, 15995);
  assert.equal(result.vat_status, "no_vat");
  assert.equal(result.advertised_price_text, "£15,995 NO VAT");
});

test("extracts a VAT included advertised price", () => {
  const result = extractAdvertisedPriceAndVat(`
    <html><body><strong id="selling-price">£17,495 VAT included</strong></body></html>
  `);

  assert.equal(result.advertised_price, 17495);
  assert.equal(result.vat_status, "vat_included");
  assert.equal(result.advertised_price_text, "£17,495 VAT included");
});

test("uses structured offer price when available", () => {
  const result = extractAdvertisedPriceAndVat(`
    <script type="application/ld+json">
      {"@type":"Vehicle","description":"Price plus VAT","offers":{"price":"18995","priceCurrency":"GBP","description":"+ VAT"}}
    </script>
  `);

  assert.equal(result.advertised_price, 18995);
  assert.equal(result.vat_status, "plus_vat");
});

test("does not mistake monthly finance for the advertised cash price", () => {
  const result = extractAdvertisedPriceAndVat(`
    <html><body><p>Finance from £299 per month</p></body></html>
  `);

  assert.equal(result.advertised_price, null);
  assert.equal(result.vat_status, "unknown");
  assert.equal(result.advertised_price_text, "");
});

test("does not mistake a deposit for the advertised cash price", () => {
  const result = extractAdvertisedPriceAndVat(`
    <html><body><div class="price">Deposit £999 + VAT</div></body></html>
  `);

  assert.equal(result.advertised_price, null);
  assert.equal(result.vat_status, "unknown");
});
