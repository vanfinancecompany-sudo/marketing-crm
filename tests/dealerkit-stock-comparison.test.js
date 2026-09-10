import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDealerKitComparison,
  classifyLocalVat,
  extractRegistration,
} from "../api/dealerkit-stock-comparison.js";

test("extracts UK registrations from Finance stock titles", () => {
  assert.equal(extractRegistration("Ford Transit Custom HT22 KJX Limited"), "HT22KJX");
  assert.equal(extractRegistration("No registration here"), "");
});

test("normalises local VAT conservatively", () => {
  assert.equal(classifyLocalVat("+ VAT"), "plus_vat");
  assert.equal(classifyLocalVat("NO VAT"), "no_vat");
  assert.equal(classifyLocalVat("VAT included"), "inc_vat");
  assert.equal(classifyLocalVat(""), "unknown");
});

test("builds read-only Finance and Rent2Buy review records without treating partial source gaps as sold", () => {
  const snapshot = {
    complete: false,
    apiReportedTotal: 3,
    vehicleCount: 3,
    checkedAt: "2026-09-10T10:00:00.000Z",
    vehicles: [
      {
        supplierStockId: "dk-1",
        registration: "HT22KJX",
        title: "Ford Transit Custom",
        vehicleType: "LCV",
        sourceStatus: "In Stock",
        status: "available",
        retailPrice: 12495,
        vatStatus: "plus_vat",
        imageCount: 24,
        primaryImage: { url: "https://images.example/ht22.jpg" },
        sourceUrl: "https://dealer.example/ht22",
      },
      {
        supplierStockId: "dk-2",
        registration: "AB23CDE",
        title: "Vauxhall Vivaro",
        vehicleType: "LCV",
        sourceStatus: "In Stock",
        status: "available",
        retailPrice: 13995,
        vatStatus: "plus_vat",
        imageCount: 8,
        primaryImage: { url: "https://images.example/ab23.jpg" },
      },
      {
        supplierStockId: "dk-3",
        registration: "XY24ZZZ",
        title: "Peugeot Boxer",
        vehicleType: "LCV",
        sourceStatus: "Reserved",
        status: "reserved",
        retailPrice: 15995,
        vatStatus: "plus_vat",
        imageCount: 12,
      },
    ],
  };

  const financeRows = [
    { title: "Ford Transit Custom HT22 KJX", price: 12995, vat: "+ VAT", weblink: "https://vfc.example/ht22" },
    { title: "Renault Trafic ZZ22YYY", price: 14995, vat: "+ VAT", weblink: "https://vfc.example/zz22" },
    { title: "Peugeot Boxer XY24 ZZZ", price: 15995, vat: "+ VAT" },
  ];
  const rentRows = [
    { registration: "XY24 ZZZ", monthly: 599, webLink: "https://r2b.example/xy24" },
  ];

  const result = buildDealerKitComparison({ snapshot, financeRows, rentRows });
  assert.equal(result.readOnly, true);
  assert.equal(result.authoritative, false);
  assert.equal(result.source.complete, false);
  assert.equal(result.finance.exactMatches, 2);
  assert.equal(result.finance.missingFromFinance, 1);
  assert.equal(result.finance.priceDifferences, 1);
  assert.equal(result.finance.sourceStatusWarnings, 1);
  assert.equal(result.finance.localNotSeen, 1);
  assert.equal(result.rent2buy.exactMatches, 1);
  assert.equal(result.rent2buy.sourceStatusWarnings, 1);

  const localGap = result.reviewRecords.find((record) => record.registration === "ZZ22YYY");
  assert.equal(localGap.reason, "local_not_seen_unverified");
  assert.doesNotMatch(JSON.stringify(result), /sold because missing|remove from wix/i);
});

test("missing source and local prices stay null instead of becoming a false zero-price comparison", () => {
  const result = buildDealerKitComparison({
    snapshot: {
      complete: true,
      apiReportedTotal: 1,
      vehicleCount: 1,
      vehicles: [{
        supplierStockId: "dk-null",
        registration: "HT22KJX",
        title: "Ford Transit Custom",
        vehicleType: "LCV",
        sourceStatus: "In Stock",
        status: "available",
        retailPrice: null,
        vatStatus: "plus_vat",
        imageCount: null,
      }],
    },
    financeRows: [{ title: "Ford Transit Custom HT22 KJX", price: null, vat: "+ VAT" }],
  });

  assert.equal(result.finance.exactMatches, 1);
  assert.equal(result.finance.priceDifferences, 0);
  assert.equal(result.reviewRecordCount, 0);
  assert.equal(result.source.apiReportedTotal, 1);
});

test("comparison endpoint is access-gated and client remains read-only", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-stock-comparison.js", import.meta.url), "utf8");
  assert.match(endpoint, /Marketing CRM access is required/);
  assert.match(endpoint, /allowPartial:\s*true/);
  assert.doesNotMatch(endpoint, /\.insert\(|\.update\(|\.delete\(|PATCH|POST\s+https:\/\/api\.dealerkit/i);
});
