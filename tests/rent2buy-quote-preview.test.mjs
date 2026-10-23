import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { approvedRent2BuySelectorChoices } from "../lib/rent2BuyQuoteChoices.mjs";
import { issueApprovedRent2BuyQuote } from "../lib/rent2BuyQuoteIssue.mjs";
import { verifyRent2BuyQuoteToken } from "../lib/rent2BuyQuoteHandoff.mjs";

const now=Date.UTC(2026,9,23,15,0,0);
const secret="long-test-signing-secret-available-on-server-only-012345";
function source(registration="ZZ25XYZ"){
  const stockId="dealerkit-"+registration;
  return {
    vehicle:{registration,supplierStockId:stockId,title:"Approved example van",
      year:2025,mileage:12000,retailPrice:12000,vatStatus:"plus_vat",
      sourceUpdatedAt:"2026-10-23T13:00:00Z"},
    decision:{registration,supplierStockId:stockId,reviewStatus:"reviewed",rent2buyEnabled:true},
    stockVerifiedCurrent:true,retailVatBasisApproved:true,commercialTermsApproved:true,
    retailApproval:{revision:8},
    approvedRetailExVat:12000,approvedTermMonths:[12,18,24,30,36,42,48],
    activeSpecial:null,
  };
}
test("selector exposes vehicle-approved terms for each mileage band, with no invented price",()=>{
  const x=approvedRent2BuySelectorChoices(source());
  assert.equal(x.ok,true);
  assert.equal(x.registration,"ZZ25XYZ");
  assert.deepEqual(x.allowedMileageTerms.find(t=>t.milesPerMonth===1000).termMonths,
    [12,18,24,30,36,42,48]);
  assert.deepEqual(x.allowedMileageTerms.find(t=>t.milesPerMonth===4000).termMonths,
    [12,18,24]);
  assert.deepEqual(x.initialRentalOptionsExVat,[1750,2630,3500,4380]);
  assert.equal(Object.hasOwn(x,"monthlyExVat"),false);
});
test("choices honour commercial restrictions and refuse unreviewed pricing",()=>{
  const s=source();s.approvedTermMonths=[12,24,36];
  const result=approvedRent2BuySelectorChoices(s);
  assert.deepEqual(result.allowedMileageTerms[0].termMonths,[12,24,36]);
  assert.equal(approvedRent2BuySelectorChoices({...s,retailVatBasisApproved:false}).ok,false);
  assert.equal(approvedRent2BuySelectorChoices({...s,stockVerifiedCurrent:false}).ok,false);
});
test("existing Wix specials never silently revert to standard matrix options",()=>{
  const result=approvedRent2BuySelectorChoices(source("FV74BBJ"));
  assert.equal(result.ok,false);
  assert.equal(result.error,"protected_special_not_imported");
});
test("an exactly approved promotion is a single anchored configuration",()=>{
  const s=source("FV74BBJ");
  s.vehicle.year=2024;s.vehicle.mileage=40000;s.vehicle.retailPrice=14695;
  s.approvedRetailExVat=14695;
  s.activeSpecial={id:"special-1",status:"active",registration:"FV74BBJ",
    supplier_stock_id:s.vehicle.supplierStockId,revision:2,
    term_months:36,miles_per_month:1000,initial_ex_vat:2000,monthly_ex_vat:545};
  const choices=approvedRent2BuySelectorChoices(s);
  assert.equal(choices.ok,true);
  assert.equal(choices.special.monthlyExVat,545);
  assert.equal(choices.special.termMonths,36);
  assert.equal(choices.special.milesPerMonth,1000);
  const quote=issueApprovedRent2BuyQuote({source:s,secret,now,reference:"special-issued-001"});
  assert.equal(quote.ok,true);
  assert.equal(quote.quote.pricingMode,"special");
  assert.equal(quote.quote.monthlyExVat,545);
  const verified=verifyRent2BuyQuoteToken(quote.token,secret,{registration:"FV74BBJ",now});
  assert.equal(verified.monthlyExVat,545);
});
test("preview issuance route must require server key, preview deployment and feature flag",()=>{
  const route=fs.readFileSync(new URL("../api/rent2buy-quote-preview.js",import.meta.url),"utf8");
  assert.match(route,/process\.env\.VERCEL_ENV!=="preview"/);
  assert.match(route,/RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED!=="true"/);
  assert.match(route,/x-rent2buy-quote-verifier-key/);
  assert.match(route,/loadApprovedRent2BuySource\(data\.registration\)/);
  assert.match(route,/issueApprovedRent2BuyQuote\(/);
  assert.match(route,/approvedRent2BuySelectorChoices\(source\)/);
  assert.doesNotMatch(route,/wixRequest|wixPatch|createRent2BuyLead|\.upsert\(|\.update\(/);
});
