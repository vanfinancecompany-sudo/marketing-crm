import test from "node:test";
import assert from "node:assert/strict";
import {
  signRent2BuyQuote,
  verifyRent2BuyQuoteToken,
  validateRent2BuyQuoteEnvelope,
} from "../lib/rent2BuyQuoteHandoff.mjs";

const secret="test-secret-for-signed-rent2buy-applications-very-long";
const now=Date.UTC(2026,9,23,14,0,0);
const quote={
  quoteId:"quoted-vehicle-01",
  registration:"ZZ25XYZ",
  vehicleTitle:"Example matrix van",
  pricingMode:"matrix",
  termMonths:48,
  milesPerMonth:1000,
  monthlyExVat:400,
  initialExVat:1750,
  sourceRevision:"reviewed-pricing-revision-12",
  issuedAt:now,
  expiresAt:now+3600000,
};

test("signer verifies exact matrix vehicle terms, pricing and VAT for application",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  const result=verifyRent2BuyQuoteToken(token,secret,{registration:"ZZ25XYZ",now});
  assert.equal(result.registration,"ZZ25XYZ");
  assert.equal(result.pricingMode,"matrix");
  assert.equal(result.termMonths,48);
  assert.equal(result.milesPerMonth,1000);
  assert.equal(result.monthlyExVat,400);
  assert.equal(result.monthlyIncVat,480);
  assert.equal(result.initialExVat,1750);
  assert.equal(result.initialIncVat,2100);
});

test("tampered token, wrong vehicle and incorrect secret are rejected",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  assert.equal(verifyRent2BuyQuoteToken(token+"x",secret,{registration:"ZZ25XYZ",now}),null);
  assert.equal(verifyRent2BuyQuoteToken(token,secret,{registration:"BT25LVK",now}),null);
  assert.equal(verifyRent2BuyQuoteToken(token,secret+"!",{registration:"ZZ25XYZ",now}),null);
});

test("expired, malformed and special-mode quote envelopes fail closed",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  assert.equal(verifyRent2BuyQuoteToken(token,secret,{registration:"ZZ25XYZ",now:now+3600000}),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,sourceRevision:""},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,termMonths:99},now),null);
  for(const termMonths of [18,30,42]) assert.equal(validateRent2BuyQuoteEnvelope({...quote,termMonths},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,milesPerMonth:4500},now),null);
  for(const milesPerMonth of [1500,2500,3500]) assert.equal(validateRent2BuyQuoteEnvelope({...quote,milesPerMonth},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,initialExVat:900},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,pricingMode:"special"},now),null);
});

test("signing requires server-side secret; no insecure fallback",()=>{
  assert.throws(()=>signRent2BuyQuote(quote,"test",now));
  assert.equal(verifyRent2BuyQuoteToken("r2bq1.x.x","",{}),null);
});
