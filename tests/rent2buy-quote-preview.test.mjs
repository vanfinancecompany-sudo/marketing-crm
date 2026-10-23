import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {approvedRent2BuySelectorChoices} from "../lib/rent2BuyQuoteChoices.mjs";
import {issueApprovedRent2BuyQuote} from "../lib/rent2BuyQuoteIssue.mjs";
import {verifyRent2BuyQuoteToken} from "../lib/rent2BuyQuoteHandoff.mjs";

const now=Date.UTC(2026,9,23,15),secret="long-test-signing-secret-available-on-server-only-012345";
function source(registration="ZZ25XYZ",price=12000){
 const id="dealerkit-"+registration;
 return {vehicle:{registration,supplierStockId:id,title:"Approved example van",year:2025,mileage:12000,
   retailPrice:price,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T13:00:00Z"},
  decision:{registration,supplierStockId:id,reviewStatus:"reviewed",rent2buyEnabled:true},
  sourceRetailPrice:price,activeSpecial:null};
}

test("selector exposes Felix-valid terms/mileage and initial options with no client monthly price",()=>{
 const x=approvedRent2BuySelectorChoices(source());
 assert.equal(x.ok,true);assert.equal(x.registration,"ZZ25XYZ");
 assert.deepEqual(x.allowedMileageTerms.find(t=>t.milesPerMonth===1000).termMonths,[12,18,24,30,36,42,48]);
 assert.deepEqual(x.allowedMileageTerms.find(t=>t.milesPerMonth===4000).termMonths,[12,18,24]);
 assert.deepEqual(x.initialRentalOptionsExVat,[1750,2630,3500,4380]);
 assert.equal(Object.hasOwn(x,"monthlyExVat"),false);
});

test("protected legacy Wix special has no standard-matrix fallback",()=>{
 const x=approvedRent2BuySelectorChoices(source("FV74BBJ",14695));
 assert.equal(x.ok,false);assert.equal(x.error,"fixed_legacy_special_not_customisable");
});

test("exact migrated special is shown and signed",()=>{
 const s=source("ZZ25XYZ",14695);s.vehicle.year=2024;s.vehicle.mileage=40000;
 s.activeSpecial={id:"special-1",status:"active",registration:"ZZ25XYZ",
  supplier_stock_id:s.vehicle.supplierStockId,revision:2,term_months:36,miles_per_month:1000,
  initial_ex_vat:2000,monthly_ex_vat:545};
 const choices=approvedRent2BuySelectorChoices(s);
 assert.equal(choices.ok,true);assert.equal(choices.special.monthlyExVat,545);
 const quote=issueApprovedRent2BuyQuote({source:s,secret,now,reference:"special-001"});
 assert.equal(quote.ok,true);assert.equal(quote.quote.monthlyExVat,545);
 assert.equal(verifyRent2BuyQuoteToken(quote.token,secret,{registration:"ZZ25XYZ",now}).monthlyExVat,545);
});

test("preview route uses simplified pricing source and has no Wix/stock-monitor writes",()=>{
 const route=fs.readFileSync(new URL("../api/rent2buy-quote-preview.js",import.meta.url),"utf8");
 assert.match(route,/VERCEL_ENV!=="preview"/);
 assert.match(route,/RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED!=="true"/);
 assert.match(route,/x-rent2buy-quote-verifier-key/);
 assert.match(route,/loadRent2BuyPricingSource\(data\.registration\)/);
 assert.match(route,/issueApprovedRent2BuyQuote\(/);
 assert.doesNotMatch(route,/stock-watch|snapshot|wixRequest|wixPatch|createRent2BuyLead|\.upsert\(|\.update\(/);
});
