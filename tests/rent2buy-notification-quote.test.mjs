import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normaliseRent2BuyNotificationQuote,
  rent2BuyNotificationQuoteLines,
  rent2BuyNotificationQuoteFields,
} from "../lib/rent2BuyNotificationQuote.mjs";

const signedByCrm={
  registration:"FV74BBJ",quoteId:"r2bq-xx345678",
  sourceRevision:"active-2026-10-23",
  pricingMode:"special",termMonths:36,milesPerMonth:1000,
  monthlyExVat:545,monthlyIncVat:654,
  initialExVat:2000,initialIncVat:2400,
};

test("legacy notifications without selected quote stay unchanged",()=>{
 assert.equal(normaliseRent2BuyNotificationQuote(null,"FV74BBJ"),null);
 assert.equal(rent2BuyNotificationQuoteLines(null),"");
 assert.deepEqual(rent2BuyNotificationQuoteFields(null),[]);
});
test("mail displays exact selected rental, term and monthly mileage separate from usage estimate",()=>{
 const quote=normaliseRent2BuyNotificationQuote(signedByCrm,"FV74 BBJ");
 const lines=rent2BuyNotificationQuoteLines(quote);
 assert.match(lines,/Contract length: 36 months/);
 assert.match(lines,/mileage allowance: 1,000 miles per month/);
 assert.match(lines,/Monthly rental: £545.00 \+ VAT \(£654.00 inc VAT\)/);
 assert.match(lines,/Initial rental: £2,000.00 \+ VAT \(£2,400.00 inc VAT\)/);
 const row=rent2BuyNotificationQuoteFields(quote);
 assert.equal(row.length,6);
 const route=fs.readFileSync(new URL("../api/transactional-rent2buy-application.js",import.meta.url),"utf8");
 assert.match(route,/payload.selectedQuote = normaliseRent2BuyNotificationQuote/);
 assert.match(route,/Verified Selected Rental/);
 assert.match(route,/rent2BuyNotificationQuoteLines\(p.selectedQuote\)/);
 assert.match(route,/Monthly mileage: \$\{display\(p.monthlyMileage\)\}/);
});
test("notification refuses wrong vehicle, VAT mismatch and forged/incomplete selected terms",()=>{
 assert.throws(()=>normaliseRent2BuyNotificationQuote(signedByCrm,"BT25LVK"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,monthlyIncVat:500},"FV74BBJ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,initialExVat:900},"FV74BBJ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,termMonths:40},"FV74BBJ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,milesPerMonth:4500},"FV74BBJ"));
 assert.throws(()=>normaliseRent2BuyNotificationQuote({...signedByCrm,monthlyExVat:545.333},"FV74BBJ"));
});
