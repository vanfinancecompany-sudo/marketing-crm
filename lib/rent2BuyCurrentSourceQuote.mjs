/**
 * Recalculate a signed Felix-matrix quote from the same current DealerKit
 * retail/year/mileage used to issue it. Existing stock/image flows are untouched.
 */
import { createHash } from "node:crypto";
import { quoteRent2BuyMatrix } from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";
const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const money=v=>Number.isFinite(Number(v))&&Number(v)>0;
const equalMoney=(a,b)=>Math.abs(Number(a)-Number(b))<0.001;
const fail=reason=>({ok:false,reason});

export function rent2BuyPricingSourceRevision(source={}){
  const v=source.vehicle||{};
  return createHash("sha256").update(JSON.stringify({
    matrix:"felix-2026-09-30-v1",
    registration:reg(v.registration),
    supplierStockId:String(v.supplierStockId||""),
    sourceUpdatedAt:String(v.sourceUpdatedAt||""),
    year:Number(v.year)||null,
    mileage:Number(v.mileage),
    retailPrice:Number(source.sourceRetailPrice),
    vatStatus:String(v.vatStatus||""),
    sourceMode:String(source.sourceMode||""),
  })).digest("hex").slice(0,40);
}

export function verifyRent2BuyQuoteAgainstSource(quote,source){
  const q=quote||{},v=source?.vehicle||{};
  const registration=reg(v.registration);
  if(!registration||registration!==reg(q.registration))return fail("registration_mismatch");
  if(pendingRent2BuySpecialDeal(registration))
    return fail("fixed_legacy_special_not_customisable");
  if(source?.sourceMode!=="dealerkit_current_stock"||!String(v.supplierStockId||""))
    return fail("dealerkit_source_unavailable");
  if(!money(source.sourceRetailPrice))return fail("retail_price_unavailable");
  const sourceRevision=rent2BuyPricingSourceRevision(source);
  if(q.sourceRevision!==sourceRevision)return fail("source_revision_changed");
  const result=quoteRent2BuyMatrix({
    retailPrice:Number(source.sourceRetailPrice),
    registrationYear:v.year,
    vehicleMileage:v.mileage,
    termMonths:q.termMonths,
    milesPerMonth:q.milesPerMonth,
    initialRentalExVat:q.initialExVat,
  });
  if(result.status!=="ok")return fail(result.reason||"quote_ineligible");
  if(q.pricingMode!=="matrix"||result.pricingMode!=="matrix"||
     !equalMoney(q.monthlyExVat,result.monthlyExVat)||
     !equalMoney(q.monthlyIncVat,result.monthlyIncVat)||
     !equalMoney(q.initialExVat,result.initialExVat)||
     !equalMoney(q.initialIncVat,result.initialIncVat))
    return fail("quoted_amount_changed");
  return {ok:true,current:true,sourceRevisionVerified:true,
    registration,quoteId:q.quoteId,sourceRevision,quote:result};
}
