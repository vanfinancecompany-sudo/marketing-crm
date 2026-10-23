import test from "node:test";
import assert from "node:assert/strict";
import { issueApprovedRent2BuyQuote } from "../lib/rent2BuyQuoteIssue.mjs";
import { verifyRent2BuyQuoteToken } from "../lib/rent2BuyQuoteHandoff.mjs";
const now=Date.UTC(2026,9,23,16);
const secret="production-length-test-only-secret-not-for-live-use";
function source(registration="ZZ25XYZ",price=12000){
 const stockId="stock-"+registration;
 return {
  vehicle:{registration,supplierStockId:stockId,title:"Approved test van",year:2025,mileage:12000,
   retailPrice:price,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T09:00:00Z"},
  decision:{registration,supplierStockId:stockId,reviewStatus:"reviewed",rent2buyEnabled:true},
  retailApproval:{revision:5},retailVatBasisApproved:true,commercialTermsApproved:true,
  approvedTermMonths:[12,18,24,30,36,42,48],stockVerifiedCurrent:true,
  approvedRetailExVat:price,activeSpecial:null,
 };
}
test("issuer signs only a matrix quote which its source verifier independently approves",()=>{
 const s=source();
 const result=issueApprovedRent2BuyQuote({source:s,secret,now,reference:"normal-000123"});
 assert.equal(result.ok,true);
 assert.equal(result.quote.monthlyExVat,400);
 assert.equal(result.quote.initialExVat,1750);
 const restored=verifyRent2BuyQuoteToken(result.token,secret,{now,registration:s.vehicle.registration});
 assert.equal(restored.monthlyExVat,400);
 assert.equal(restored.initialExVat,1750);
 assert.equal(restored.expiresAt-now,30*60*1000);
 assert.equal(restored.quoteId,"r2b-normal-000123");
});
test("customer-selected mileage and term must be within approved commercial options",()=>{
 const s=source();
 const q=issueApprovedRent2BuyQuote({source:s,secret,now,
  selection:{termMonths:36,milesPerMonth:2000,initialExVat:1750}});
 assert.equal(q.ok,true);
 assert.equal(q.quote.termMonths,36);
 assert.equal(q.quote.milesPerMonth,2000);
 assert.equal(issueApprovedRent2BuyQuote({source:{...s,approvedTermMonths:[48]},secret,now,
  selection:{termMonths:36,milesPerMonth:2000,initialExVat:1750}}).error,"contract_term_not_approved");
 assert.equal(issueApprovedRent2BuyQuote({source:s,secret,now,
  selection:{termMonths:48,milesPerMonth:4000}}).error,"term_not_allowed");
});
test("unmigrated existing special never gets matrix price automatically",()=>{
 const s=source("FV74BBJ",14695);
 const result=issueApprovedRent2BuyQuote({source:s,secret,now});
 assert.equal(result.error,"manual_special_migration_hold");
});
test("exact special is signed, changing contract uses standard matrix",()=>{
 const s=source("FV74BBJ",14695);
 s.activeSpecial={id:"sp-123",status:"active",revision:2,registration:"FV74BBJ",
  supplier_stock_id:s.vehicle.supplierStockId,monthly_ex_vat:545,initial_ex_vat:2000,
  term_months:36,miles_per_month:1000,expires_at:null};
 const deal=issueApprovedRent2BuyQuote({source:s,secret,now});
 assert.equal(deal.ok,true);
 assert.equal(deal.quote.monthlyExVat,545);
 assert.equal(deal.quote.pricingMode,"special");
 const changed=issueApprovedRent2BuyQuote({source:s,secret,now,selection:{
  termMonths:24,milesPerMonth:1000,initialExVat:2150
 }});
 assert.equal(changed.ok,false); // not an approved matrix initial-rental ladder step
 const ladder=source("ZZ25XYZ");
 const regular=issueApprovedRent2BuyQuote({source:s,secret,now,selection:{
  termMonths:24,milesPerMonth:1000,initialExVat:2150
 }});
 assert.equal(regular.error,"initial_rental_not_on_matrix_ladder");
});
test("outdated source, missing secret and unreviewed stock cannot create a token",()=>{
 const s=source();
 assert.equal(issueApprovedRent2BuyQuote({source:s,now}).ok,false);
 assert.equal(issueApprovedRent2BuyQuote({source:{...s,stockVerifiedCurrent:false},secret,now}).error,"unverified_stock_or_review");
 assert.equal(issueApprovedRent2BuyQuote({source:{...s,retailVatBasisApproved:false},secret,now}).error,"retail_vat_basis_unverified");
});
