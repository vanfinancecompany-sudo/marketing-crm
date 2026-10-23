import test from "node:test";
import assert from "node:assert/strict";
import {
 buildApprovedRent2BuySource,
 loadApprovedRent2BuySource,
 Rent2BuySourceUnavailable,
} from "../api/_rent2buy-quote-source.js";

const changedAt="2026-10-23T08:00:00.000Z";
const vehicle={
 registration:"ZZ25XYZ",supplierStockId:"dealerkit-zz25",
 status:"available",sourceStatus:"In stock",year:2025,
 mileage:12000,retailPrice:12000,vatStatus:"plus_vat",sourceUpdatedAt:changedAt,
};
const snapshot={diagnostics:{complete:true},refresh:{status:"complete"},
 vehicles:[vehicle],checkedAt:"2026-10-23T09:00:00.000Z"};
const reviewDecision={persisted:true,registration:"ZZ25XYZ",supplierStockId:"dealerkit-zz25",
 reviewedSourceUpdatedAt:changedAt,rent2buyEnabled:true,reviewStatus:"reviewed"};
const retailApproval={
 supplier_stock_id:"dealerkit-zz25",registration:"ZZ25XYZ",status:"approved",
 source_retail_amount:12000,source_vat_status:"plus_vat",source_updated_at:changedAt,
 approved_retail_ex_vat:12000,allowed_terms:[12,18,24,30,36,42,48],
 approved_at:"2026-10-23T10:00:00Z",approved_by:"sales-reviewer",revision:2,
};
const fixture=()=>({registration:"ZZ25XYZ",snapshot,detail:vehicle,reviewDecision,retailApproval});

function throwsCode(fn,code) {
 assert.throws(fn,err=>err instanceof Rent2BuySourceUnavailable&&err.code===code);
}

test("only matching complete in-stock source plus signed-off price and terms passes",()=>{
 const approved=buildApprovedRent2BuySource(fixture());
 assert.equal(approved.stockVerifiedCurrent,true);
 assert.equal(approved.retailVatBasisApproved,true);
 assert.equal(approved.commercialTermsApproved,true);
 assert.equal(approved.approvedRetailExVat,12000);
 assert.deepEqual(approved.approvedTermMonths,[12,18,24,30,36,42,48]);
});
test("partial stock snapshots and duplicate registrations fail closed",()=>{
 throwsCode(()=>buildApprovedRent2BuySource({...fixture(),snapshot:{...snapshot,diagnostics:{complete:false}}}),"incomplete_stock_snapshot");
 throwsCode(()=>buildApprovedRent2BuySource({...fixture(),snapshot:{...snapshot,vehicles:[vehicle,{...vehicle,supplierStockId:"reused-stock-id"}]}}),"missing_or_duplicate_stock");
});
test("sold/reserved or changed stock details cannot be quoted",()=>{
 for(const status of ["reserved","sold","awaiting_delivery","unknown"]){
  throwsCode(()=>buildApprovedRent2BuySource({...fixture(),detail:{...vehicle,status}}),"vehicle_not_available");
 }
 throwsCode(()=>buildApprovedRent2BuySource({...fixture(),detail:{...vehicle,mileage:13000}}),"stock_snapshot_detail_mismatch");
 throwsCode(()=>buildApprovedRent2BuySource({...fixture(),detail:{...vehicle,retailPrice:12500}}),"stock_snapshot_detail_mismatch");
 throwsCode(()=>buildApprovedRent2BuySource({...fixture(),detail:{...vehicle,supplierStockId:"different"}}),"stock_snapshot_detail_mismatch");
});
test("unreviewed or stale DealerKit review cannot price a vehicle",()=>{
 for(const change of [
  {persisted:false},{reviewStatus:"needs_review"},{rent2buyEnabled:false},{reviewedSourceUpdatedAt:"2026-10-22T08:00:00.000Z"}
 ])throwsCode(()=>buildApprovedRent2BuySource({...fixture(),reviewDecision:{...reviewDecision,...change}}),"review_not_current");
});
test("approved EX VAT basis must match same stock, VAT, updated version and approved terms",()=>{
 for(const change of [
  {status:"draft"},{source_retail_amount:11900},{approved_retail_ex_vat:null},
  {source_vat_status:"inc_vat"},{source_updated_at:"2026-10-22"},
  {allowed_terms:[]},{allowed_terms:[36,40]},{approved_by:null},
 ]){
  throwsCode(()=>buildApprovedRent2BuySource({...fixture(),retailApproval:{...retailApproval,...change}}),"retail_or_contract_terms_not_approved");
 }
});
test("missing approval table fails, never silently infers retail EX VAT",async()=>{
 const fakeDb={
  from:table=>({
   select:()=>({eq:()=>({limit:async()=>{
    if(table==="dealerkit_rent2buy_retail_approvals")return {data:null,error:{code:"PGRST205"}};
    return {data:[],error:null};
   }})})
  })
 };
 await assert.rejects(loadApprovedRent2BuySource("ZZ25XYZ",{
  getSnapshot:async()=>snapshot,getDetail:async()=>vehicle,
  getDb:()=>fakeDb,getReview:async()=>reviewDecision,
 }),err=>err?.code==="unavailable_pricing_table");
});
test("source adapter does not depend on live Wix price or mutate stock publishing",()=>{
 const src=buildApprovedRent2BuySource(fixture());
 assert.equal(src.activeSpecial,null);
 assert.ok(src.verifiedAt);
});
