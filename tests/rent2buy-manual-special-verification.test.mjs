import test from "node:test";
import assert from "node:assert/strict";
import {checkedManualSpecial,manualSpecialAuth} from "../api/rent2buy-special-verify.js";
const record={registration:"AB12CDE",enabled:true,source_stock_id:"source-123",monthly_ex_vat:"555",initial_ex_vat:"1800",term_months:36,updated_at:"2026-10-24T12:00:00.000Z"};
const vehicle={registration:"AB12CDE",supplierStockId:"source-123",status:"available",retailPrice:15000,year:2024,mileage:25000};
test("independent server approval binds live stock identity, amounts and revision",()=>{
 const s=checkedManualSpecial("AB12CDE",record,vehicle);
 assert.equal(s.pricingMode,"fixed_manual_special");assert.equal(s.monthlyExVat,555);
 assert.equal(s.monthlyIncVat,666);assert.equal(s.initialIncVat,2160);
 assert.match(s.sourceRevision,/^[0-9a-f]{40}$/);
 assert.notEqual(checkedManualSpecial("AB12CDE",{...record,monthly_ex_vat:"550"},vehicle).sourceRevision,s.sourceRevision);
});
test("unavailable, invalid or changed stock cannot approve a fixed offer",()=>{
 for(const variant of [{...vehicle,registration:"AB12CDF"},{...vehicle,supplierStockId:"different"},
 {...vehicle,status:"reserved"},{...vehicle,retailPrice:null}]){
   assert.throws(()=>checkedManualSpecial("AB12CDE",record,variant));
 }
 assert.throws(()=>checkedManualSpecial("AB12CDE",{...record,enabled:false},vehicle));
 assert.throws(()=>checkedManualSpecial("AB12CDE",{...record,initial_ex_vat:"999"},vehicle));
});
test("manual verification endpoint requires existing server-only quote credentials",()=>{
 assert.equal(manualSpecialAuth({headers:{"x-rent2buy-quote-verifier-key":"x".repeat(40)}},{RENT2BUY_QUOTE_VERIFY_KEY:"x".repeat(40)}),true);
 assert.equal(manualSpecialAuth({headers:{"x-rent2buy-quote-verifier-key":"y".repeat(40)}},{RENT2BUY_QUOTE_VERIFY_KEY:"x".repeat(40)}),false);
 assert.equal(manualSpecialAuth({headers:{}},{RENT2BUY_QUOTE_VERIFY_KEY:"x".repeat(40)}),false);
});
