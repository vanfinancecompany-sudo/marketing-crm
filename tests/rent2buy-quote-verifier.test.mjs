import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { signRent2BuyQuote } from "../lib/rent2BuyQuoteHandoff.mjs";
import { quoteRent2BuyMatrix } from "../lib/rent2BuyFlexiblePricing.mjs";
import { rent2BuyApprovedSourceRevision } from "../lib/rent2BuyCurrentSourceQuote.mjs";
import { checkIncomingRent2BuyQuote } from "../api/_rent2buy-quote-verify-handler.mjs";

const now=Date.UTC(2026,9,23,14);
const secret="server-side-test-secret-minimum-32-characters-strong";
const env={RENT2BUY_QUOTE_VERIFIER_ENABLED:"true",RENT2BUY_QUOTE_SIGNING_SECRET:secret};
const vehicle={registration:"ZZ25XYZ",supplierStockId:"dk-zz",year:2025,
 mileage:12000,retailPrice:12000,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T10:00:00Z",
 title:"Approved test van"};
const decision={registration:"ZZ25XYZ",supplierStockId:"dk-zz",reviewStatus:"reviewed",rent2buyEnabled:true};
const source={
 vehicle,decision,stockVerifiedCurrent:true,retailVatBasisApproved:true,
 approvedRetailExVat:12000,retailApproval:{revision:1},
 commercialTermsApproved:true,approvedTermMonths:[12,18,24,30,36,42,48],activeSpecial:null,
};
const makeToken=(s=source,overrides={})=>{
 const quote=quoteRent2BuyMatrix({
  retailPrice:s.approvedRetailExVat,registrationYear:s.vehicle.year,vehicleMileage:s.vehicle.mileage,
  termMonths:48,milesPerMonth:1000
 });
 return signRent2BuyQuote({
  quoteId:"reference-20261023-001",registration:s.vehicle.registration,vehicleTitle:s.vehicle.title,
  pricingMode:quote.pricingMode,termMonths:quote.termMonths,milesPerMonth:quote.milesPerMonth,
  initialExVat:quote.initialExVat,monthlyExVat:quote.monthlyExVat,
  sourceRevision:rent2BuyApprovedSourceRevision(s),issuedAt:now,expiresAt:now+3600000,
  ...overrides,
 },secret,now);
};

test("validated signed and up-to-date quote can be read by the application servers",async()=>{
 const token=makeToken();
 const out=await checkIncomingRent2BuyQuote({token,registration:"ZZ25 XYZ"},{
  env,loadSource:async()=>source,now
 });
 assert.equal(out.ok,true);assert.equal(out.sourceRevisionVerified,true);
 assert.equal(out.quote.monthlyExVat,400);
 assert.equal(out.quote.termMonths,48);
 assert.equal(out.quote.milesPerMonth,1000);
 assert.equal(out.quote.sourceRevision,out.sourceRevision);
});

test("invalid signature, registration and expired token fail before any stock read",async()=>{
 const token=makeToken();
 let reads=0;
 const loadSource=async()=>{reads++;return source};
 for(const input of [
  {token:token+"x",registration:"ZZ25XYZ"},
  {token,registration:"FV74BBJ"},
  {token:makeToken(source,{expiresAt:now+500}),registration:"ZZ25XYZ"},
 ]){
  const result=await checkIncomingRent2BuyQuote(input,{env,loadSource,now:now+3600000});
  assert.equal(result.ok,false);
 }
 assert.equal(reads,0);
});

test("quote-verifier flag and source approval fail closed",async()=>{
 const token=makeToken();
 const off=await checkIncomingRent2BuyQuote({token,registration:"ZZ25XYZ"},{
  env:{...env,RENT2BUY_QUOTE_VERIFIER_ENABLED:"false"},loadSource:async()=>source,now
 });
 assert.equal(off.reason,"verifier_disabled");
 const missing=await checkIncomingRent2BuyQuote({token,registration:"ZZ25XYZ"},{
  env,loadSource:async()=>{throw Error("Price table missing")},now
 });
 assert.equal(missing.reason,"source_unavailable");
 const changed=await checkIncomingRent2BuyQuote({token,registration:"ZZ25XYZ"},{
  env,loadSource:async()=>({...source,approvedTermMonths:[36]}),now
 });
 assert.equal(changed.reason,"contract_term_not_approved");
});
test("verification API has no application or Wix write path and requires private auth",()=>{
 const route=fs.readFileSync(new URL("../api/rent2buy-quote-verify.js",import.meta.url),"utf8");
 assert.match(route,/RENT2BUY_QUOTE_VERIFIER_ENABLED/);
 assert.match(route,/timingSafeEqual/);
 assert.match(route,/x-rent2buy-quote-verifier-key/);
 assert.match(route,/loadApprovedRent2BuySource/);
 assert.doesNotMatch(route,/\.insert\(|\.upsert\(|wixRequest|createRent2BuyLead/);
});
