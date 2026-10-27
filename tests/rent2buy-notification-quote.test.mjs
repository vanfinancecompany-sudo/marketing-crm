import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normaliseRent2BuyNotificationQuote,
  rent2BuyNotificationQuoteLines,
  rent2BuyNotificationQuoteFields,
} from "../lib/rent2BuyNotificationQuote.mjs";

const signedByCrm={
  registration:"ZZ25XYZ",quoteId:"r2bq-xx345678",
  sourceRevision:"reviewed-2026-10-23",
  pricingMode:"matrix",termMonths:48,milesPerMonth:1000,
  monthlyExVat:400,monthlyIncVat:480,
  initialExVat:1750,initialIncVat:2100,
};

test("legacy notifications without selected quote stay unchanged",()=>{
 assert.equal(normaliseRent2BuyNotificationQuote(null,"ZZ25XYZ"),null);
 assert.equal(rent2BuyNotificationQuoteLines(null),"");
 assert.deepEqual(rent2BuyNotificationQuoteFields(null),[]);
});
test("mail displays exact matrix rental, term and contractual mileage separately from usage estimate",()=>{
 const quote=normaliseRent2BuyNotificationQuote(signedByCrm,"ZZ25 XYZ");
 const lines=rent2BuyNotificationQuoteLines(quote);
 assert.match(lines,/Pricing: Standard matrix/);
 assert.match(lines,/Contract length: 48 months/);
 assert.match(lines,/mileage allowance: 1,000 miles per month/);
 assert.match(lines,/Monthly rental: £400.00 \+ VAT \(£480.00 inc VAT\)/);
 assert.match(lines,/Initial rental: £1,750.00 \+ VAT \(£2,100.00 inc VAT\)/);
 const row=rent2BuyNotificationQuoteFields(quote);
 assert.equal(row.length,6);
 const route=fs.readFileSync(new URL("../api/transactional-rent2buy-application.js",import.meta.url),"utf8");
 assert.match(route,/payload.selectedQuote = normaliseRent2BuyNotificationQuote/);
 assert.match(route,/Verified Selected Rental/);
 assert.match(route,/rent2BuyNotificationQuoteLines\(p.selectedQuote\)/);
 assert.match(route,/Monthly mileage: \$\{display\(p.monthlyMileage\)\}/);
});
test("notification refuses wrong vehicle, special mode, VAT mismatch and forged terms",()=>{
 assert.throws(()=>normaliseRent2BuyNotificationQuote(signedByCrm,"BT25LVK"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,pricingMode:"special"},"ZZ25XYZ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,monthlyIncVat:500},"ZZ25XYZ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,initialExVat:900},"ZZ25XYZ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,termMonths:40},"ZZ25XYZ"));
 for(const termMonths of [18,30,42]) assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,termMonths},"ZZ25XYZ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,milesPerMonth:4500},"ZZ25XYZ"));
 for(const milesPerMonth of [1500,2500,3500]) assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,milesPerMonth},"ZZ25XYZ"));
});
