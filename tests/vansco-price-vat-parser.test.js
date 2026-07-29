import test from "node:test";
import assert from "node:assert/strict";
import { parseDetailHtml } from "../api/_vansco-cache-utils.js";

const stockUrl = "https://www.vansco.co.uk/vehicle-details/used-ford-transit-custom-u9999/";

test("extracts a plus VAT advertised price", () => {
  const result = parseDetailHtml(stockUrl, `
    <html><head><meta property="og:title" content="Ford Transit Custom (AB24XYZ)"></head>
    <body><h1>Ford Transit Custom (AB24XYZ)</h1><div class="vehicle-price">£12,295 + VAT</div></body></html>
  `);

  assert.equal(result.advertised_price, 12295);
  assert.equal(result.vat_status, "plus_vat");
  assert.equal(result.advertised_price_text, "£12,295 + VAT");
});

test("extracts a no VAT advertised price", () => {
  const result = parseDetailHtml(stockUrl, `
    <html><head><meta property="og:title" content="Ford Transit Custom (AB24XYZ)"></head>
    <body><h1>Ford Transit Custom (AB24XYZ)</h1><div class="price">£15,995 NO VAT</div></body></html>
  `);

  assert.equal(result.advertised_price, 15995);
  assert.equal(result.vat_status, "no_vat");
  assert.equal(result.advertised_price_text, "£15,995 NO VAT");
});

test("does not mistake monthly finance for the advertised cash price", () => {
  const result = parseDetailHtml(stockUrl, `
    <html><head><meta property="og:title" content="Ford Transit Custom (AB24XYZ)"></head>
    <body><h1>Ford Transit Custom (AB24XYZ)</h1><p>Finance from £299 per month</p></body></html>
  `);

  assert.equal(result.advertised_price, null);
  assert.equal(result.vat_status, "unknown");
  assert.equal(result.advertised_price_text, "");
});
