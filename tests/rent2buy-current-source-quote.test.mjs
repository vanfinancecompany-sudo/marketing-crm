import test from "node:test";
import assert from "node:assert/strict";
import {rent2BuyPricingSourceRevision,verifyRent2BuyQuoteAgainstSource} from "../lib/rent2BuyCurrentSourceQuote.mjs";
import {quoteRent2BuyMatrix} from "../lib/rent2BuyFlexiblePricing.mjs";

function source(registration="ZZ25XYZ",retail=12000){
 const id="dealerkit-"+registration;
 return {
  vehicle:{registration,supplierStockId:id,title:"Test van",year:2025,mileage:12000,
    retailPrice:retail,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T12:00:00Z"},
  sourceRetailPrice:retail,
  sourceMode:"dealerkit_current_stock",
 };
}
function quoteFor(s,options={}){
 const result=quoteRent2BuyMatrix({
  retailPrice:s.sourceRetailPrice,registrationYear:s.vehicle.year,
  vehicleMileage:s.vehicle.mileage,...options,
 });
 assert.equal(result.status,"ok");
 return {quoteId:"quote-0001",registration:s.vehicle.registration,
   sourceRevision:rent2BuyPricingSourceRevision(s),...result};
}

test("current DealerKit retail source exactly confirms a Felix matrix quote",()=>{
 const s=source(),q=quoteFor(s);
 assert.equal(q.monthlyExVat,400);
 assert.equal(q.pricingMode,"matrix");
 const result=verifyRent2BuyQuoteAgainstSource(q,s);
 assert.equal(result.ok,true);
 assert.equal(result.sourceRevisionVerified,true);
});

test("source revision changes with retail, mileage, vehicle update or source mode",()=>{
 const s=source(),revision=rent2BuyPricingSourceRevision(s);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,sourceRetailPrice:12100}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,vehicle:{...s.vehicle,mileage:15000}}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,vehicle:{...s.vehicle,sourceUpdatedAt:"2026-10-23T13:00:00Z"}}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,sourceMode:"other"}),revision);
});

test("missing current DealerKit authority or changed pricing inputs fail closed",()=>{
 const s=source(),q=quoteFor(s);
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,sourceRetailPrice:13000}).reason,"source_revision_changed");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,sourceMode:""}).reason,"dealerkit_source_unavailable");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,sourceRetailPrice:null}).reason,"retail_price_unavailable");
});

test("the four fixed legacy specials can never fall back to Felix matrix",()=>{
 const s=source("FV74BBJ",14695),q=quoteFor(s);
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s).reason,"fixed_legacy_special_not_customisable");
});

test("changed or relabelled signed amounts are rejected",()=>{
 const s=source(),q=quoteFor(s,{termMonths:36,milesPerMonth:2000,initialRentalExVat:1750});
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s).ok,true);
 assert.equal(verifyRent2BuyQuoteAgainstSource({...q,monthlyExVat:q.monthlyExVat+5},s).reason,"quoted_amount_changed");
 assert.equal(verifyRent2BuyQuoteAgainstSource({...q,pricingMode:"special"},s).reason,"quoted_amount_changed");
 assert.equal(verifyRent2BuyQuoteAgainstSource({...q,milesPerMonth:4000},s).reason,"term_not_allowed");
});
