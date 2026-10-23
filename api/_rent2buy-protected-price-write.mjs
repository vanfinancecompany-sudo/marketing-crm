/**
 * Price-write gate for Rent2Buy special deals.
 *
 * A four-vehicle manual-price hold is unconditional. All future deal rows
 * (draft, active, inactive) are treated as requiring an audited resolution
 * before either old Wix pricing writer can modify their published prices.
 *
 * This module NEVER authorises the new special-deal publisher. It guards old
 * automatic price-recalculation routes only. Inability to read the dedicated
 * table is a HARD hold, not proof that no special exists.
 */
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";
import { RENT2BUY_SPECIAL_DEALS_TABLE } from "../lib/rent2BuySpecialDealPolicy.mjs";

const canonical = value => String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const blocked = (code) => ({
  permitted:false,code,
  message:"Rent2Buy pricing is protected or cannot be checked. No Wix prices were changed.",
});

export async function checkRent2BuyLegacyPriceWrite(registration,{
  db = null,
  getDb = getSupabaseServiceAdmin,
  environment = process.env,
}={}){
  const reg=canonical(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(reg))
    return blocked("invalid_registration");

  // These four are protected even before any new table exists.
  if(pendingRent2BuySpecialDeal(reg))
    return blocked("confirmed_manual_special_hold");

  // Backwards compatible until the new special-deal schema is migrated.
  // The four existing holds above remain unconditional. A new special cannot
  // be saved unless this same protection gate is enabled.
  if(environment.RENT2BUY_SPECIAL_PRICE_WRITE_GUARD_ENABLED!=="true")
    return {permitted:true,code:"new_override_guard_not_activated"};
  try{
    const client=db||getDb();
    const {data,error}=await client
      .from(RENT2BUY_SPECIAL_DEALS_TABLE)
      .select("id,registration,status,revision")
      .eq("registration",reg)
      .limit(2);

    if(error||!Array.isArray(data))
      return blocked("special_deal_lookup_unavailable");
    // Never guess which duplicate, partial or malformed row is current.
    if(data.length>1)
      return blocked("duplicate_special_deal_records");
    if(data.length===1)
      return blocked("special_deal_requires_audited_resolution");
    return {permitted:true,code:"no_special_deal_override"};
  }catch{
    return blocked("special_deal_lookup_unavailable");
  }
}
