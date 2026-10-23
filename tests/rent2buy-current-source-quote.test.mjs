import test from "node:test";
import assert from "node:assert/strict";
import {
  rent2BuyApprovedSourceRevision,
  verifyRent2BuyQuoteAgainstSource,
} from "../lib/rent2BuyCurrentSourceQuote.mjs";
import { quoteRent2BuyMatrix, rent2BuyInitialRentalLadder } from "../lib/rent2BuyFlexiblePricing.mjs";

function source(reg="ZZ25XYZ",retail=12000){
  const id="dealerkit-stock-"+reg;
  return {
    vehicle:{supplierStockId:id,registration:reg,sourceUpdatedAt:"2026-10-23T12:00:00Z",year:2025,mileage:12000,retailPrice:retail,vatStatus:"plus_vat"},
    decision:{supplierStockId:id,registration:reg,rent2buyEnabled:true,reviewStatus:"reviewed"},
    approvedRetailExVat:retail,retailVatBasisApproved:true,stockVerifiedCurrent:true,activeSpecial:null,
  };
}
function quoteFor(s,options={}){
 const result=quoteRent2BuyMatrix({retailPrice:s.approvedRetailExVat,registrationYear:s.vehicle.year,vehicleMileage:s.vehicle.mileage,...options});
 assert.equal(result.status,"ok");
 return {quoteId:"q-vehicle-20261023",registration:s.vehicle.registration,
    sourceRevision:rent2BuyApprovedSourceRevision(s),...result};
}

test("current authorised source exactly confirms a standard matrix quote",()=>{
 const s=source();const q=quoteFor(s);
 assert.equal(q.monthlyExVat,400);
 const result=verifyRent2BuyQuoteAgainstSource(q,s);
 assert.equal(result.ok,true);
 assert.equal(result.current,true);
 assert.equal(result.sourceRevisionVerified,true);
});

test("source revision responds to age, odometer, retail and review decisions",()=>{
 const s=source();const revision=rent2BuyApprovedSourceRevision(s);
 assert.notEqual(rent2BuyApprovedSourceRevision({...s,vehicle:{...s.vehicle,retailPrice:12100}}),revision);
 assert.notEqual(rent2BuyApprovedSourceRevision({...s,vehicle:{...s.vehicle,mileage:15000}}),revision);
 assert.notEqual(rent2BuyApprovedSourceRevision({...s,decision:{...s.decision,rent2buyEnabled:false}}),revision);
});

test("previous approved quote fails after source retail price or availability changes",()=>{
 const s=source(),q=quoteFor(s);
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,vehicle:{...s.vehicle,retailPrice:13000}}).reason,"source_revision_changed");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,stockVerifiedCurrent:false}).reason,"unverified_stock_or_review");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,{...s,retailVatBasisApproved:false}).reason,"retail_vat_basis_unverified");
});

test("all four protected manual Wix specials remain held pending complete active deal",()=>{
 const s=source("FV74BBJ",14695);
 const q={...quoteFor(s),registration:"FV74BBJ"};
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s).reason,"manual_special_migration_hold");
});

test("exact reviewed active special is verified, changed term returns to matrix",()=>{
 const s=source("FV74BBJ",14695);
 s.vehicle.year=2024;s.vehicle.mileage=46251;
 s.activeSpecial={
  id:"special-1",revision:3,status:"active",supplier_stock_id:s.vehicle.supplierStockId,
  registration:"FV74BBJ",monthly_ex_vat:545,initial_ex_vat:2000,term_months:36,
  miles_per_month:1000,expires_at:null
 };
 const q=quoteFor(s,{termMonths:36,milesPerMonth:1000,initialRentalExVat:2000,
  specialDeal:{enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000}});
 assert.equal(q.pricingMode,"special");
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s).ok,true);
 const matrixInitial=rent2BuyInitialRentalLadder(14695)[0];
 const amended=quoteFor(s,{termMonths:24,milesPerMonth:1000,initialRentalExVat:matrixInitial,
  specialDeal:{enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000}});
 assert.equal(amended.pricingMode,"matrix");
 assert.equal(verifyRent2BuyQuoteAgainstSource(amended,s).ok,true);
});

test("expiry and wrong price are never signed off as current",()=>{
 const s=source("FV74BBJ",14695);
 s.activeSpecial={
  id:"special-1",revision:2,status:"active",supplier_stock_id:s.vehicle.supplierStockId,
  registration:"FV74BBJ",monthly_ex_vat:545,initial_ex_vat:2000,term_months:36,
  miles_per_month:1000,expires_at:"2026-10-22T23:59:59Z"
 };
 const q=quoteFor(s,{termMonths:36,milesPerMonth:1000,initialRentalExVat:2000,specialDeal:{
  enabled:true,monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000
 }});
 assert.equal(verifyRent2BuyQuoteAgainstSource(q,s,{now:Date.UTC(2026,9,23)}).reason,"special_deal_not_active");
 s.activeSpecial.expires_at=null;
 const wrong={...q,sourceRevision:rent2BuyApprovedSourceRevision(s),monthlyExVat:500};
 assert.equal(verifyRent2BuyQuoteAgainstSource(wrong,s).reason,"quoted_amount_changed");
});
