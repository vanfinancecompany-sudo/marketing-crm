import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normaliseRent2BuyNotificationFixedSpecial,
  rent2BuyNotificationFixedSpecialLines,
  rent2BuyNotificationFixedSpecialFields,
} from "../lib/rent2BuyNotificationFixedSpecial.mjs";

const bbj={registration:"FV74BBJ",pricingMode:"fixed_legacy_special",
  monthlyExVat:545,monthlyIncVat:654,initialExVat:2000,initialIncVat:2400,
  termMonths:48,contractualMileage:null,customisable:false};

test("BBJ internal notification is fixed £545 / £2,000 / 48 with no contractual mileage",()=>{
  const result=normaliseRent2BuyNotificationFixedSpecial(bbj,"FV74 BBJ");
  assert.deepEqual(result,bbj);
  const lines=rent2BuyNotificationFixedSpecialLines(result);
  assert.match(lines,/Fixed legacy special/);
  assert.match(lines,/48 months/);
  assert.match(lines,/Not applicable - fixed special is not customisable/);
  assert.match(lines,/£545\.00 \+ VAT \(£654\.00 inc VAT\)/);
  assert.match(lines,/£2,000\.00 \+ VAT \(£2,400\.00 inc VAT\)/);
  assert.equal(rent2BuyNotificationFixedSpecialFields(result).some(([label])=>/mileage/i.test(label)),true);
});

test("BJ74 HTL incorrect old detail amounts are rejected by email normaliser",()=>{
  const wrong={...bbj,registration:"BJ74HTL",monthlyExVat:693,monthlyIncVat:831.6,initialExVat:2079,initialIncVat:2494.8};
  assert.throws(()=>normaliseRent2BuyNotificationFixedSpecial(wrong,"BJ74HTL"),/does not match/);
  const correct={...bbj,registration:"BJ74HTL",monthlyExVat:595,monthlyIncVat:714};
  const result=normaliseRent2BuyNotificationFixedSpecial(correct,"BJ74 HTL");
  assert.equal(result.monthlyExVat,595);
  assert.equal(result.initialExVat,2000);
  assert.equal(result.termMonths,48);
});

test("fixed special cannot be relabelled customisable or attached to another registration",()=>{
  assert.throws(()=>normaliseRent2BuyNotificationFixedSpecial({...bbj,customisable:true},"FV74BBJ"),/does not match/);
  assert.throws(()=>normaliseRent2BuyNotificationFixedSpecial(bbj,"BT25LVK"),/does not match/);
  assert.equal(normaliseRent2BuyNotificationFixedSpecial(null,"FV74BBJ"),null);
});

test("transactional email keeps fixed deal separate from selected matrix quote and intended-use mileage",()=>{
  const source=fs.readFileSync(new URL("../api/transactional-rent2buy-application.js",import.meta.url),"utf8");
  assert.match(source,/payload\.fixedSpecial = normaliseRent2BuyNotificationFixedSpecial/);
  assert.match(source,/Application cannot contain both a fixed special and a customised quote/);
  assert.match(source,/Fixed Rent2Buy Special/);
  assert.match(source,/Monthly mileage/);
  assert.match(source,/rent2BuyNotificationFixedSpecialLines/);
});
