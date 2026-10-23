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
  registration:"FV74 BBJ",
  vehicleTitle:"Nissan Primastar",
  pricingMode:"special",
  termMonths:36,
  milesPerMonth:1000,
  monthlyExVat:545,
  initialExVat:2190,
  sourceRevision:"approved-rent2buy-price-revision-12",
  issuedAt:now,
  expiresAt:now+3600000,
};

test("signer verifies exact vehicle terms, pricing and VAT for application",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  const result=verifyRent2BuyQuoteToken(token,secret,{registration:"FV74BBJ",now});
  assert.equal(result.registration,"FV74BBJ");
  assert.equal(result.pricingMode,"special");
  assert.equal(result.termMonths,36);
  assert.equal(result.milesPerMonth,1000);
  assert.equal(result.monthlyExVat,545);
  assert.equal(result.monthlyIncVat,654);
  assert.equal(result.initialExVat,2190);
  assert.equal(result.initialIncVat,2628);
  assert.equal(result.sourceRevision,quote.sourceRevision);
});

test("tampered token, wrong vehicle and incorrect secret are rejected",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  assert.equal(verifyRent2BuyQuoteToken(token+"x",secret,{registration:"FV74BBJ",now}),null);
  assert.equal(verifyRent2BuyQuoteToken(token,secret,{registration:"BT25LVK",now}),null);
  assert.equal(verifyRent2BuyQuoteToken(token,secret+"!",{registration:"FV74BBJ",now}),null);
});

test("expired quotes and quotes without an approved source revision fail closed",()=>{
  const token=signRent2BuyQuote(quote,secret,now);
  assert.equal(verifyRent2BuyQuoteToken(token,secret,{registration:"FV74BBJ",now:now+3600000}),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,sourceRevision:""},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,termMonths:99},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,milesPerMonth:4500},now),null);
  assert.equal(validateRent2BuyQuoteEnvelope({...quote,initialExVat:900},now),null);
});

test("signing requires server-side secret; no insecure fallback",()=>{
  assert.throws(()=>signRent2BuyQuote(quote,"test",now));
  assert.equal(verifyRent2BuyQuoteToken("r2bq1.x.x","",{}),null);
});
