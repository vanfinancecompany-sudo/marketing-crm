/**
 * Minimal Rent2Buy pricing source.
 * Reuses the EXISTING reviewed DealerKit vehicle retail/year/mileage only.
 * Four fixed legacy specials are deliberately excluded from the matrix.
 */
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { DEALERKIT_REVIEW_TABLE, rowToDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
export class Rent2BuyPricingSourceUnavailable extends Error{
  constructor(code){super("Rent2Buy pricing source unavailable.");this.name="Rent2BuyPricingSourceUnavailable";this.code=code;}
}
const reject=code=>{throw new Rent2BuyPricingSourceUnavailable(code)};

async function loadReviewedRent2BuyByRegistration(db,registration){
  const {data,error}=await db.from(DEALERKIT_REVIEW_TABLE).select("*")
    .eq("registration",registration).limit(2);
  if(error||!Array.isArray(data))reject("review_lookup_unavailable");
  if(data.length!==1)reject(data.length>1?"duplicate_review_records":"review_not_found");
  const decision=rowToDealerKitReviewDecision(data[0]);
  if(decision.reviewStatus!=="reviewed"||decision.rent2buyEnabled!==true||
     reg(decision.registration)!==registration||!decision.supplierStockId)
    reject("rent2buy_not_reviewed");
  return decision;
}

export async function loadRent2BuyPricingSource(registration,{
  getDb=getSupabaseServiceAdmin,
  getDetail=(id)=>fetchDealerKitStockDetail(id,{specifications:false}),
}={}){
  const target=reg(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(target))reject("invalid_registration");
  if(pendingRent2BuySpecialDeal(target))reject("fixed_legacy_special_not_customisable");
  const db=getDb();
  const decision=await loadReviewedRent2BuyByRegistration(db,target);
  const vehicle=await getDetail(decision.supplierStockId);
  if(!vehicle||reg(vehicle.registration)!==target||
     String(vehicle.supplierStockId)!==String(decision.supplierStockId))
    reject("dealerkit_vehicle_mismatch");
  if(!positive(vehicle.retailPrice)||
     vehicle.year===null||vehicle.year===undefined||vehicle.year===""||
     !Number.isFinite(Number(vehicle.year))||Number(vehicle.year)<=0||
     vehicle.mileage===null||vehicle.mileage===undefined||vehicle.mileage===""||
     !Number.isFinite(Number(vehicle.mileage))||Number(vehicle.mileage)<0)
    reject("pricing_inputs_missing");
  return {vehicle,decision,sourceRetailPrice:Number(vehicle.retailPrice)};
}
