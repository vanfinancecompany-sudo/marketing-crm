import test from "node:test";
import assert from "node:assert/strict";
import {issueApprovedRent2BuyQuote} from "../lib/rent2BuyQuoteIssue.mjs";
import {verifyRent2BuyQuoteToken} from "../lib/rent2BuyQuoteHandoff.mjs";

const now=Date.UTC(2026,9,23,16),secret="production-length-test-only-secret-not-for-live-use";
function source(registration="ZZ25XYZ",price=12000){
 const id="stock-"+registration;
 return {vehicle:{registration,supplierStockId:id,title:"Test van",year:2025,mileage:12000,
   retailPrice:price,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T09:00:00Z"},
  decision:{registration,supplierStockId:id,reviewStatus:"reviewed",rent2buyEnabled:true},
  sourceRetailPrice:price};
}

test("server signs the Felix matrix quote from existing reviewed vehicle retail",()=>{
 const s=source(),result=issueApprovedRent2BuyQuote({source:s,secret,now,reference:"normal-123"});
 assert.equal(result.ok,true);
 assert.equal(result.quote.pricingMode,"matrix");
 assert.equal(result.quote.monthlyExVat,400);
 assert.equal(result.quote.initialExVat,1750);
 const restored=verifyRent2BuyQuoteToken(result.token,secret,{now,registration:"ZZ25XYZ"});
 assert.equal(restored.monthlyExVat,400);
 assert.equal(restored.expiresAt-now,30*60*1000);
});

test("matrix enforces mileage, term and initial-rental options",()=>{
 const s=source();
 const q=issueApprovedRent2BuyQuote({source:s,secret,now,selection:{termMonths:36,milesPerMonth:2000,initialExVat:1750}});
 assert.equal(q.ok,true);assert.equal(q.quote.termMonths,36);assert.equal(q.quote.milesPerMonth,2000);
 assert.equal(issueApprovedRent2BuyQuote({source:s,secret,now,selection:{termMonths:48,milesPerMonth:4000}}).error,"term_not_allowed");
 assert.equal(issueApprovedRent2BuyQuote({source:s,secret,now,selection:{termMonths:24,milesPerMonth:1000,initialExVat:2150}}).error,"initial_rental_not_on_matrix_ladder");
});

test("fixed legacy special never falls back to matrix even if extra special-like data is attached",()=>{
 const s=source("FV74BBJ",14695);
 s.activeSpecial={id:"ignored",status:"active",monthly_ex_vat:1};
 assert.equal(issueApprovedRent2BuyQuote({source:s,secret,now}).error,"fixed_legacy_special_not_customisable");
});

test("missing signing secret or unreviewed source cannot issue a trusted quote",()=>{
 const s=source();
 assert.equal(issueApprovedRent2BuyQuote({source:s,now}).ok,false);
 assert.equal(issueApprovedRent2BuyQuote({source:{...s,decision:{...s.decision,rent2buyEnabled:false}},secret,now}).error,"rent2buy_not_reviewed");
});
