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
test("stock card shows preselected locked specials rather than raw outdated rental",()=>{const src=fs.readFileSync(new URL("../components/VehicleCard.jsx",import.meta.url),"utf8");assert.match(src,/pendingRent2BuySpecialDeal\(displayReg\)/);assert.match(src,/aria-pressed=\{Boolean\(activeSpecial\)\}/);assert.match(src,/activeSpecial\.initialExVat/);assert.match(src,/activeSpecial\.monthlyExVat/);});

test("special deal editor uses the existing Marketing CRM access key, not an invented second secret",()=>{
 const ui=fs.readFileSync(new URL("../components/Rent2BuySpecialDealPanel.jsx",import.meta.url),"utf8");
 const api=fs.readFileSync(new URL("../api/rent2buy-special-deals.js",import.meta.url),"utf8");
 assert.match(ui,/getStoredMarketingAccessKey\(\)/);
 assert.match(ui,/MARKETING_ACCESS_HEADER/);
 assert.match(api,/MARKETING_CUSTOMER_DATABASE_API_KEY/);
 assert.doesNotMatch(api,/RENT2BUY_SPECIAL_ADMIN_KEY/);
 assert.doesNotMatch(ui,/Special-deal admin key/);
});

test("manual special email requires independent server approval and is disabled by default",()=>{
 const route=fs.readFileSync(new URL("../api/transactional-rent2buy-application.js",import.meta.url),"utf8");
 assert.match(route,/getSupabaseServiceAdmin/);assert.match(route,/RENT2BUY_MANUAL_SPECIALS_ENABLED/);
 assert.match(route,/\.eq\("enabled",true\)/);
});

test("new special activation is feature-locked and checked against current DealerKit vehicle data",()=>{
 const src=fs.readFileSync(new URL("../api/rent2buy-special-deals.js",import.meta.url),"utf8");
 assert.match(src,/RENT2BUY_MANUAL_SPECIAL_ACTIVATION_ENABLED/);assert.match(src,/fetchDealerKitStockDetail\(record.source_stock_id/);
 assert.match(src,/rent2BuyMaximumTerm/);assert.match(src,/confirmRegistration/);
});

test("numeric Wix price maintenance never touches protected or active manual special registrations",()=>{
 const code=fs.readFileSync(new URL("../api/rent2buy-monthly-price-sync.js",import.meta.url),"utf8");
 assert.match(code,/pendingRent2BuySpecialDeal/);
 assert.match(code,/rent2buy_special_deals/);
 assert.match(code,/if\(error\)throw new Error\("Cannot check active Rent2Buy special-deal exclusions/);
});

test("active new manual specials are visibly preselected on Rent2Buy stock cards",()=>{
 const page=fs.readFileSync(new URL("../pages/StockPage.jsx",import.meta.url),"utf8");
 const card=fs.readFileSync(new URL("../components/VehicleCard.jsx",import.meta.url),"utf8");
 assert.match(page,/onOffersChange=\{setSpecialOffers\}/);
 assert.match(page,/specialDeal=\{filters.pipeline/);
 assert.match(card,/activeSpecial/);
 assert.match(card,/aria-pressed=\{Boolean\(activeSpecial\)\}/);
});
