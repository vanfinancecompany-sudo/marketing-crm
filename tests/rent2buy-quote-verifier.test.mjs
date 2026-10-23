import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {signRent2BuyQuote} from "../lib/rent2BuyQuoteHandoff.mjs";
import {quoteRent2BuyMatrix} from "../lib/rent2BuyFlexiblePricing.mjs";
import {rent2BuyPricingSourceRevision} from "../lib/rent2BuyCurrentSourceQuote.mjs";
import {checkIncomingRent2BuyQuote} from "../api/_rent2buy-quote-verify-handler.mjs";

const now=Date.UTC(2026,9,23,14),secret="server-side-test-secret-minimum-32-characters-strong";
const env={RENT2BUY_QUOTE_VERIFIER_ENABLED:"true",RENT2BUY_QUOTE_SIGNING_SECRET:secret};
const source={vehicle:{registration:"ZZ25XYZ",supplierStockId:"dk-zz",title:"Test van",year:2025,mileage:12000,
  retailPrice:12000,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T10:00:00Z"},
 decision:{registration:"ZZ25XYZ",supplierStockId:"dk-zz",reviewStatus:"reviewed",rent2buyEnabled:true},
 sourceRetailPrice:12000,activeSpecial:null};

function token(overrides={}){
 const quote=quoteRent2BuyMatrix({retailPrice:source.sourceRetailPrice,registrationYear:source.vehicle.year,
  vehicleMileage:source.vehicle.mileage,termMonths:48,milesPerMonth:1000});
 return signRent2BuyQuote({quoteId:"quote-0001",registration:"ZZ25XYZ",vehicleTitle:"Test van",
  pricingMode:quote.pricingMode,termMonths:quote.termMonths,milesPerMonth:quote.milesPerMonth,
  initialExVat:quote.initialExVat,monthlyExVat:quote.monthlyExVat,
  sourceRevision:rent2BuyPricingSourceRevision(source),issuedAt:now,expiresAt:now+3600000,...overrides},secret,now);
}

test("signed quote recalculates against the existing reviewed pricing source",async()=>{
 const result=await checkIncomingRent2BuyQuote({token:token(),registration:"ZZ25 XYZ"},{env,loadSource:async()=>source,now});
 assert.equal(result.ok,true);assert.equal(result.quote.monthlyExVat,400);
 assert.equal(result.quote.termMonths,48);assert.equal(result.sourceRevisionVerified,true);
});

test("bad signature, wrong registration and expired token fail before pricing-source read",async()=>{
 let reads=0;const loadSource=async()=>{reads++;return source};
 for(const input of [
  {token:token()+"x",registration:"ZZ25XYZ"},
  {token:token(),registration:"FV74BBJ"},
  {token:token({expiresAt:now+500}),registration:"ZZ25XYZ"},
 ]){
  assert.equal((await checkIncomingRent2BuyQuote(input,{env,loadSource,now:now+3600000})).ok,false);
 }
 assert.equal(reads,0);
});

test("disabled verifier, unavailable source and changed retail fail closed",async()=>{
 assert.equal((await checkIncomingRent2BuyQuote({token:token(),registration:"ZZ25XYZ"},
   {env:{...env,RENT2BUY_QUOTE_VERIFIER_ENABLED:"false"},loadSource:async()=>source,now})).reason,"verifier_disabled");
 assert.equal((await checkIncomingRent2BuyQuote({token:token(),registration:"ZZ25XYZ"},
   {env,loadSource:async()=>{throw Error("unavailable")},now})).reason,"source_unavailable");
 assert.equal((await checkIncomingRent2BuyQuote({token:token(),registration:"ZZ25XYZ"},
   {env,loadSource:async()=>({...source,sourceRetailPrice:12500}),now})).reason,"source_revision_changed");
});

test("verification route depends on simplified pricing source, not snapshot machinery",()=>{
 const route=fs.readFileSync(new URL("../api/rent2buy-quote-verify.js",import.meta.url),"utf8");
 assert.match(route,/RENT2BUY_QUOTE_VERIFIER_ENABLED/);
 assert.match(route,/timingSafeEqual/);
 assert.match(route,/loadRent2BuyPricingSource/);
 assert.doesNotMatch(route,/quote-snapshot|stock-watch|\.insert\(|\.upsert\(|wixRequest/);
});
