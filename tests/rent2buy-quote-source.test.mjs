import test from "node:test";
import assert from "node:assert/strict";
import {loadRent2BuyPricingSource,Rent2BuyPricingSourceUnavailable} from "../api/_rent2buy-quote-source.js";

const listing={supplierStockId:"dk-001",registration:"ZZ25XYZ",title:"Test van",year:2025,mileage:12000,retailPrice:12000,status:"available"};
const detail={...listing,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T10:00:00Z"};
const snapshot=(vehicles=[listing])=>({vehicles,checkedAt:"2026-10-23T10:00:00Z"});

async function rejects(code,options={}){
 await assert.rejects(loadRent2BuyPricingSource("ZZ25XYZ",options),
   error=>error instanceof Rent2BuyPricingSourceUnavailable&&error.code===code);
}

test("uses current DealerKit stock directly without a review approval gate",async()=>{
 const result=await loadRent2BuyPricingSource("ZZ25XYZ",{
  getSnapshot:async()=>snapshot(),
  getDetail:async id=>{assert.equal(id,"dk-001");return detail},
 });
 assert.equal(result.sourceRetailPrice,12000);
 assert.equal(result.vehicle.mileage,12000);
 assert.equal(result.sourceMode,"dealerkit_current_stock");
 assert.equal(Object.hasOwn(result,"decision"),false);
});

test("a unique current registration is required",async()=>{
 await rejects("dealerkit_vehicle_not_found",{getSnapshot:async()=>snapshot([]),getDetail:async()=>detail});
 await rejects("duplicate_dealerkit_registration",{getSnapshot:async()=>snapshot([
  listing,{...listing,supplierStockId:"dk-002"}
 ]),getDetail:async()=>detail});
});

test("DealerKit identity and required price/year/mileage must remain current",async()=>{
 await rejects("dealerkit_vehicle_mismatch",{getSnapshot:async()=>snapshot(),getDetail:async()=>({...detail,registration:"BT25LVK"})});
 await rejects("dealerkit_vehicle_mismatch",{getSnapshot:async()=>snapshot(),getDetail:async()=>({...detail,supplierStockId:"other"})});
 await rejects("dealerkit_vehicle_not_available",{getSnapshot:async()=>snapshot(),getDetail:async()=>({...detail,status:"reserved"})});
 for(const changed of [{retailPrice:null},{year:null},{mileage:null}]){
  await rejects("pricing_inputs_missing",{getSnapshot:async()=>snapshot(),getDetail:async()=>({...detail,...changed})});
 }
});

test("known fixed legacy special never enters the custom matrix quote service",async()=>{
 await assert.rejects(loadRent2BuyPricingSource("FV74BBJ",{
  getSnapshot:async()=>snapshot([{...listing,registration:"FV74BBJ"}]),
  getDetail:async()=>({...detail,registration:"FV74BBJ"}),
 }),error=>error?.code==="fixed_legacy_special_not_customisable");
});
