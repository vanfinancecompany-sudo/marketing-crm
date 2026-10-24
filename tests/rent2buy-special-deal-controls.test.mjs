import test from "node:test";import assert from "node:assert/strict";
import {protectedOffers,validateDraft,visibleOffers,incVat} from "../lib/rent2BuySpecialDealControl.mjs";
test("four legacy specials are always selected with agreed terms",()=>{
 const a=protectedOffers();assert.equal(a.length,4);assert.ok(a.every(x=>x.enabled&&x.protected));
 assert.deepEqual(a.map(x=>[x.registration,x.monthlyExVat,x.initialExVat,x.termMonths]),[
 ["BT25LVK",595,2000,48],["FV74BBJ",545,2000,48],["FV74BEO",595,2000,48],["BJ74HTL",595,2000,48]]);
});
test("cannot overwrite protected deals",()=>{
 for(const x of protectedOffers())assert.throws(()=>validateDraft({...x,monthlyExVat:1}),/protected/);
});
test("draft must meet basic UK Rent2Buy requirements",()=>{
 assert.deepEqual(validateDraft({registration:"AB12 CDE",monthlyExVat:595,initialExVat:2000,termMonths:36}),{registration:"AB12CDE",monthlyExVat:595,initialExVat:2000,termMonths:36});
 assert.throws(()=>validateDraft({registration:"AB12CDE",monthlyExVat:0,initialExVat:2000,termMonths:36}));
 assert.throws(()=>validateDraft({registration:"AB12CDE",monthlyExVat:595,initialExVat:999,termMonths:36}));
 assert.equal(incVat(595),714);
});
test("public output includes active only and never overrides legacy four",()=>{
 const rows=[{registration:"AB12CDE",monthly_ex_vat:"550",initial_ex_vat:"1500",term_months:36,enabled:true},{registration:"CD12EFG",monthly_ex_vat:"300",initial_ex_vat:"1500",term_months:36,enabled:false},{registration:"BT25LVK",monthly_ex_vat:"100",initial_ex_vat:"1000",term_months:36,enabled:true}];
 const visible=visibleOffers(rows);assert.equal(visible.length,5);assert.equal(visible.find(x=>x.registration==="BT25LVK").monthlyExVat,595);
 assert.equal(visible.find(x=>x.registration==="CD12EFG"),undefined);
});

import fs from "node:fs";
test("stock card shows preselected locked specials rather than raw outdated rental",()=>{const src=fs.readFileSync(new URL("../components/VehicleCard.jsx",import.meta.url),"utf8");assert.match(src,/pendingRent2BuySpecialDeal\(displayReg\)/);assert.match(src,/aria-pressed=\{Boolean\(protectedSpecial\)\}/);assert.match(src,/protectedSpecial\.initialExVat/);assert.match(src,/protectedSpecial\.monthlyExVat/);});
