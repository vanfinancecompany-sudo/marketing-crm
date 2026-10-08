import test from 'node:test';
import assert from 'node:assert/strict';
import {cashPriceNumber,currentMonthlyNumber,previewVfcMonthlyPrice,hpMonthlyPayment,roundMonthlyUp,VFC_PRICE_POLICY,calculateVfcAdvertisedMonthly,isVfcPricingReviewHeld,VFC_PRICING_REVIEW_HOLDS} from '../lib/vfcFinancePriceMatrix.mjs';

test('same effective-APR method as approved VFC calculator',()=>{
 assert.ok(Math.abs(hpMonthlyPayment(22995,60)-482.6827088135552)<0.000001);
 assert.equal(VFC_PRICE_POLICY.apr,9.9);
 assert.equal(previewVfcMonthlyPrice({kind:'van',price:'£22,995',vat:'+VAT',oldMonthly:'FROM £480 P/M'}).newMonthly,483);
});
test('VAT-paid-upfront van and zero-VAT-deposit car use the right financed amounts',()=>{
 const v=previewVfcMonthlyPrice({kind:'van',price:'£22,995',vat:'+VAT',oldMonthly:'FROM £480 P/M'});
 assert.equal(v.ok,true);assert.equal(v.cashPrice,27594);assert.equal(v.deposit,4599);assert.equal(v.amountFinanced,22995);assert.equal(v.change,3);
 const c=previewVfcMonthlyPrice({kind:'car',price:'£72,400',oldMonthly:'FROM £1509 P/M'});
 assert.equal(c.ok,true);assert.equal(c.deposit,0);assert.equal(c.amountFinanced,72400);assert.equal(c.newMonthly,1520);
});
test('unverified VAT, malformed or missing prices cannot enter a bulk-update proposal',()=>{
 assert.equal(cashPriceNumber('£21.995'),null);
 assert.equal(cashPriceNumber('£10.295'),null);
 assert.equal(cashPriceNumber('£22,995'),22995);
 assert.equal(previewVfcMonthlyPrice({kind:'van',price:'£22,995',vat:''}).reason,'UNVERIFIED_VAT_TREATMENT');
 assert.equal(previewVfcMonthlyPrice({kind:'car',price:'£21.995'}).reason,'INVALID_CASH_PRICE');
 assert.equal(previewVfcMonthlyPrice({kind:'rent2buy',price:'£22,995'}).reason,'UNSUPPORTED_KIND');
});
test('round up to whole pounds without affecting full-precision calculations',()=>{
 assert.equal(roundMonthlyUp(284.01),285);
 assert.equal(roundMonthlyUp(284.99),285);
 assert.equal(roundMonthlyUp(285),285);
 assert.equal(roundMonthlyUp(285.0001),286);
 assert.equal(currentMonthlyNumber('FROM £480 P/M'),480);
 assert.equal(currentMonthlyNumber('£1509'),1509);
 assert.equal(currentMonthlyNumber(''),null);
});

test('future DealerKit sales prices use the same 9.9% APR rather than legacy flat monthly',()=>{
 assert.equal(calculateVfcAdvertisedMonthly(22995),483);
 assert.equal(calculateVfcAdvertisedMonthly(12495),263);
 assert.equal(calculateVfcAdvertisedMonthly(72400),1520);
 assert.equal(calculateVfcAdvertisedMonthly('£21.995'),null);
 assert.equal(calculateVfcAdvertisedMonthly(null),null);
});
test('original disputed Wix stock is protected in future VFC publishing',()=>{
 assert.equal(VFC_PRICING_REVIEW_HOLDS.length,10);
 assert.equal(isVfcPricingReviewHeld('LM70 YPT'),true);
 assert.equal(isVfcPricingReviewHeld('FL71GZW'),true);
 assert.equal(isVfcPricingReviewHeld('BD73DXK'),false);
});
