import test from "node:test";
import assert from "node:assert/strict";
import {rent2BuyPricingSourceRevision,verifyRent2BuyQuoteAgainstSource} from "../lib/rent2BuyCurrentSourceQuote.mjs";
import {quoteRent2BuyMatrix,rent2BuyInitialRentalLadder} from "../lib/rent2BuyFlexiblePricing.mjs";

function source(registration="ZZ25XYZ",retail=12000){
 const id="dealerkit-"+registration;
 return {
  vehicle:{registration,supplierStockId:id,title:"Test van",year:2025,mileage:12000,
    retailPrice:retail,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T12:00:00Z"},
  decision:{registration,supplierStockId:id,reviewStatus:"reviewed",rent2buyEnabled:true},
  sourceRetailPrice:retail,activeSpecial:null,
 };
}
function quoteFor(s,options={}){
 const result=quoteRent2BuyMatrix({
  retailPrice:s.sourceRetailPrice,registrationYear:s.vehicle.year,
  vehicleMileage:s.vehicle.mileage,...options,
 });
 assert.equal(result.status,"ok");
 return {quoteId:"q-001",registration:s.vehicle.registration,
   sourceRevision:rent2BuyPricingSourceRevision(s),...result};
}

test("reviewed DealerKit retail source exactly confirms a matrix quote",()=>{
 const s=source(),q=quoteFor(s);
 assert.equal(q.monthlyExVat,400);
 const result=verifyRent2BuyQuoteAgainstSource(q,s);
 assert.equal(result.ok,true);
 assert.equal(result.sourceRevisionVerified,true);
});

test("source revision changes with retail, mileage, vehicle update or Rent2Buy review",()=>{
 const s=source(),revision=rent2BuyPricingSourceRevision(s);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,sourceRetailPrice:12100}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,vehicle:{...s.vehicle,mileage:15000}}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,vehicle:{...s.vehicle,sourceUpdatedAt:"2026-10-23T13:00:00Z"}}),revision);
 assert.notEqual(rent2BuyPricingSourceRevision({...s,decision:{...s.decision,rent2buyEnabled:false}}),revision);
});

test("unreviewed or changed pricing inputs fail without any stock snapshot subsystem",()=>{
 const s=source(),q=quoteFor(s);
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,sourceRetailPrice:13000}).reason,"source_revision_changed");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,decision:{...s.decision,rent2buyEnabled:false}}).reason,"rent2buy_not_reviewed");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,sourceRetailPrice:null}).reason,"retail_price_unavailable");
});

test("four protected legacy specials cannot fall back to matrix before migration",()=>{
 const s=source("FV74BBJ",14695),q=quoteFor(s);
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s).reason,"manual_special_migration_hold");
});

test("exact active special works; changing its settings returns to ordinary matrix",()=>{
 const s=source("FV74BBJ",14695);
 s.vehicle.year=2024;s.vehicle.mileage=46251;
 s.activeSpecial={id:"special-1",revision:3,status:"active",registration:"FV74BBJ",
   supplier_stock_id:s.vehicle.supplierStockId,monthly_ex_vat:545,initial_ex_vat:2000,
   term_months:36,miles_per_month:1000,expires_at:null};
 const special=quoteFor(s,{termMonths:36,milesPerMonth:1000,initialRentalExVat:2000,
   specialDeal:{enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000}});
 assert.equal(special.pricingMode,"special");
 assert.equal(verifyRent2BuyQuoteAgainstSource(special,s).ok,true);
 const initial=rent2BuyInitialRentalLadder(14695)[0];
 const matrix=quoteFor(s,{termMonths:24,milesPerMonth:1000,initialRentalExVat:initial,
   specialDeal:{enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000}});
 assert.equal(matrix.pricingMode,"matrix");
 assert.equal(verifyRent2BuyQuoteAgainstSource(matrix,s).ok,true);
});

test("expired special and changed signed amount are rejected",()=>{
 const s=source("FV74BBJ",14695);
 s.activeSpecial={id:"special-1",revision:2,status:"active",registration:"FV74BBJ",
   supplier_stock_id:s.vehicle.supplierStockId,monthly_ex_vat:545,initial_ex_vat:2000,
   term_months:36,miles_per_month:1000,expires_at:"2026-10-22T23:59:59Z"};
 const q=quoteFor(s,{termMonths:36,milesPerMonth:1000,initialRentalExVat:2000,
   specialDeal:{enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000}});
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s,{now:Date.UTC(2026,9,23)}).reason,"special_deal_not_active");
 s.activeSpecial.expires_at=null;
 const wrong={...q,sourceRevision:rent2BuyPricingSourceRevision(s),monthlyExVat:500};
 assert.equal(verifyRent2BuyQuoteAgainstSource(wrong,s).reason,"quoted_amount_changed");
});
