import test from "node:test";
import assert from "node:assert/strict";
import {loadRent2BuyPricingSource,Rent2BuyPricingSourceUnavailable} from "../api/_rent2buy-quote-source.js";

const review={supplier_stock_id:"dk-001",registration:"ZZ25XYZ",review_status:"reviewed",
  finance_enabled:false,finance_categories:[],rent2buy_enabled:true,rent2buy_categories:[],
  excluded_image_ids:[],image_order_ids:[],reviewed_source_updated_at:"2026-10-23T10:00:00Z"};
const detail={supplierStockId:"dk-001",registration:"ZZ25XYZ",title:"Test van",
  year:2025,mileage:12000,retailPrice:12000,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T10:00:00Z"};

function db({reviews=[review],specials=[],specialError=null}={}){
 return {from:table=>({select:()=>({eq:(field,value)=>({limit:async()=>{
  if(table==="dealerkit_review_decisions"){
   assert.equal(field,"registration");assert.equal(value,"ZZ25XYZ");
   return {data:reviews,error:null};
  }
  if(table==="dealerkit_rent2buy_special_deals")
   return {data:specials,error:specialError};
  throw Error("unexpected table "+table);
 }})})})};
}
async function rejects(code,options={}){
 await assert.rejects(loadRent2BuyPricingSource("ZZ25XYZ",options),
   error=>error instanceof Rent2BuyPricingSourceUnavailable&&error.code===code);
}

test("uses existing reviewed Rent2Buy decision and DealerKit vehicle pricing inputs",async()=>{
 const result=await loadRent2BuyPricingSource("ZZ25XYZ",{
  getDb:()=>db(),getDetail:async id=>{assert.equal(id,"dk-001");return detail},
 });
 assert.equal(result.sourceRetailPrice,12000);
 assert.equal(result.vehicle.mileage,12000);
 assert.equal(result.decision.rent2buyEnabled,true);
 assert.equal(result.activeSpecial,null);
});

test("does not require or query a new stock snapshot or retail approval table",async()=>{
 const result=await loadRent2BuyPricingSource("ZZ25XYZ",{
  getDb:()=>db({specialError:{code:"PGRST205"}}),getDetail:async()=>detail,
 });
 assert.equal(result.sourceRetailPrice,12000);
});

test("review must be unique, reviewed and Rent2Buy enabled",async()=>{
 await rejects("review_not_found",{getDb:()=>db({reviews:[]}),getDetail:async()=>detail});
 await rejects("duplicate_review_records",{getDb:()=>db({reviews:[review,review]}),getDetail:async()=>detail});
 await rejects("rent2buy_not_reviewed",{getDb:()=>db({reviews:[{...review,review_status:"needs_review"}]}),getDetail:async()=>detail});
 await rejects("rent2buy_not_reviewed",{getDb:()=>db({reviews:[{...review,rent2buy_enabled:false}]}),getDetail:async()=>detail});
});

test("DealerKit identity and required price/year/mileage must match reviewed vehicle",async()=>{
 await rejects("dealerkit_vehicle_mismatch",{getDb:()=>db(),getDetail:async()=>({...detail,registration:"BT25LVK"})});
 await rejects("dealerkit_vehicle_mismatch",{getDb:()=>db(),getDetail:async()=>({...detail,supplierStockId:"other"})});
 for(const changed of [{retailPrice:null},{year:null},{mileage:null}]){
  await rejects("pricing_inputs_missing",{getDb:()=>db(),getDetail:async()=>({...detail,...changed})});
 }
});

test("known legacy special never gets a matrix quote until its override is migrated",async()=>{
 const specialReview={...review,supplier_stock_id:"dk-special",registration:"FV74BBJ"};
 const specialDetail={...detail,supplierStockId:"dk-special",registration:"FV74BBJ"};
 const specialDb={from:table=>({select:()=>({eq:()=>({limit:async()=>{
   if(table==="dealerkit_review_decisions")return {data:[specialReview],error:null};
   return {data:[],error:null};
 }})})})};
 await assert.rejects(loadRent2BuyPricingSource("FV74BBJ",{
   getDb:()=>specialDb,getDetail:async()=>specialDetail,
 }),error=>error?.code==="protected_special_not_migrated");
});
