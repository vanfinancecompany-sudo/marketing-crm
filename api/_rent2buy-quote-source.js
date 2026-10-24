/**
 * Authoritative Rent2Buy pricing source.
 * Every normal Rent2Buy van uses the current DealerKit vehicle retail/year/mileage.
 * Four fixed legacy specials are deliberately excluded from the Felix matrix.
 */
import { fetchDealerKitStockDetail, fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";
import {currentActiveRent2BuyManualSpecial} from "../lib/rent2BuyCurrentManualSpecial.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const CACHE_MS=60*1000;
let cachedSnapshot=null;
let cachedUntil=0;

export class Rent2BuyPricingSourceUnavailable extends Error{
  constructor(code){super("Rent2Buy pricing source unavailable.");this.name="Rent2BuyPricingSourceUnavailable";this.code=code;}
}
const reject=code=>{throw new Rent2BuyPricingSourceUnavailable(code)};

async function currentSnapshot(){
  const now=Date.now();
  if(cachedSnapshot&&cachedUntil>now)return cachedSnapshot;
  const snapshot=await fetchDealerKitStockSnapshot({allowPartial:true});
  cachedSnapshot=snapshot;
  cachedUntil=now+CACHE_MS;
  return snapshot;
}

export async function loadRent2BuyPricingSource(registration,{
  getSnapshot=currentSnapshot,
  getDetail=(id)=>fetchDealerKitStockDetail(id,{specifications:false}),
}={}){
  const target=reg(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(target))reject("invalid_registration");
  if(pendingRent2BuySpecialDeal(target))reject("fixed_legacy_special_not_customisable");
  try{if(await currentActiveRent2BuyManualSpecial(target))reject("approved_manual_special_not_customisable")}
  catch(error){if(error instanceof Rent2BuyPricingSourceUnavailable)throw error;reject("manual_special_source_unavailable")}

  let snapshot;
  try{snapshot=await getSnapshot();}
  catch{reject("dealerkit_stock_unavailable")}
  const vehicles=Array.isArray(snapshot?.vehicles)?snapshot.vehicles:[];
  const matches=vehicles.filter(vehicle=>reg(vehicle?.registration)===target);
  if(matches.length!==1)reject(matches.length>1?"duplicate_dealerkit_registration":"dealerkit_vehicle_not_found");
  const indexed=matches[0];
  if(!indexed?.supplierStockId)reject("dealerkit_vehicle_identity_missing");

  let vehicle;
  try{vehicle=await getDetail(indexed.supplierStockId);}
  catch{reject("dealerkit_vehicle_unavailable")}
  if(!vehicle||reg(vehicle.registration)!==target||
     String(vehicle.supplierStockId)!==String(indexed.supplierStockId))
    reject("dealerkit_vehicle_mismatch");
  const status=String(vehicle.status||vehicle.sourceStatus||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
  if(!["available","in_stock","due_in"].includes(status))
    reject("dealerkit_vehicle_not_available");
  if(!positive(vehicle.retailPrice)||
     vehicle.year===null||vehicle.year===undefined||vehicle.year===""||
     !Number.isFinite(Number(vehicle.year))||Number(vehicle.year)<=0||
     vehicle.mileage===null||vehicle.mileage===undefined||vehicle.mileage===""||
     !Number.isFinite(Number(vehicle.mileage))||Number(vehicle.mileage)<0)
    reject("pricing_inputs_missing");

  return {
    vehicle,
    sourceRetailPrice:Number(vehicle.retailPrice),
    sourceMode:"dealerkit_current_stock",
    sourceCheckedAt:snapshot?.checkedAt||null,
  };
}
