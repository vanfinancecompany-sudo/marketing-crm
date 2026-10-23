/**
 * Verify a signed Rent2Buy quote against the same reviewed DealerKit pricing
 * inputs used by the existing Rent2Buy system. This is PRICE integrity only.
 * Stock/image availability remains the existing stock workflow's responsibility.
 */
import { createHash } from "node:crypto";
import { quoteRent2BuyMatrix } from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const money=v=>Number.isFinite(Number(v))&&Number(v)>0;
const equalMoney=(a,b)=>Math.abs(Number(a)-Number(b))<0.001;
const fail=reason=>({ok:false,reason});

export function rent2BuyPricingSourceRevision(source={}){
  const v=source.vehicle||{},d=source.decision||{},special=source.activeSpecial||null;
  return createHash("sha256").update(JSON.stringify({
    matrix:"felix-2026-09-30-v1",
    registration:reg(v.registration),
    supplierStockId:String(v.supplierStockId||""),
    sourceUpdatedAt:String(v.sourceUpdatedAt||""),
    year:Number(v.year)||null,
    mileage:Number(v.mileage),
    retailPrice:Number(source.sourceRetailPrice),
    vatStatus:String(v.vatStatus||""),
    reviewed:Boolean(d.reviewStatus==="reviewed"&&d.rent2buyEnabled===true),
    special:special?{
      id:String(special.id||""),revision:Number(special.revision||0),
      status:String(special.status||""),
      monthlyExVat:Number(special.monthly_ex_vat),
      initialExVat:Number(special.initial_ex_vat),
      termMonths:Number(special.term_months),
      milesPerMonth:Number(special.miles_per_month),
      expiresAt:String(special.expires_at||""),
    }:null,
  })).digest("hex").slice(0,40);
}

export function verifyRent2BuyQuoteAgainstSource(quote,source,{now=Date.now()}={}){
  const q=quote||{},v=source?.vehicle||{},d=source?.decision||{};
  const registration=reg(v.registration);
  if(!registration||registration!==reg(q.registration))return fail("registration_mismatch");
  if(d.reviewStatus!=="reviewed"||d.rent2buyEnabled!==true||
     reg(d.registration)!==registration||
     String(d.supplierStockId||"")!==String(v.supplierStockId||""))
    return fail("rent2buy_not_reviewed");
  if(!money(source.sourceRetailPrice))return fail("retail_price_unavailable");

  const special=source.activeSpecial||null;
  if(pendingRent2BuySpecialDeal(registration)&&!special)
    return fail("manual_special_migration_hold");

  let exactSpecial=null;
  if(special){
    const expiry=special.expires_at?Date.parse(special.expires_at):null;
    if(special.status!=="active"||!special.id||
       reg(special.registration)!==registration||
       String(special.supplier_stock_id||"")!==String(v.supplierStockId||"")||
       (special.expires_at&&(!Number.isFinite(expiry)||expiry<=now)))
      return fail("special_deal_not_active");
    exactSpecial={
      enabled:true,
      monthlyExVat:Number(special.monthly_ex_vat),
      initialExVat:Number(special.initial_ex_vat),
      termMonths:Number(special.term_months),
      milesPerMonth:Number(special.miles_per_month),
    };
  }

  const sourceRevision=rent2BuyPricingSourceRevision(source);
  if(q.sourceRevision!==sourceRevision)return fail("source_revision_changed");

  const result=quoteRent2BuyMatrix({
    retailPrice:Number(source.sourceRetailPrice),
    registrationYear:v.year,
    vehicleMileage:v.mileage,
    termMonths:q.termMonths,
    milesPerMonth:q.milesPerMonth,
    initialRentalExVat:q.initialExVat,
    specialDeal:exactSpecial,
  });
  if(result.status!=="ok")return fail(result.reason||"quote_ineligible");
  if(q.pricingMode!==result.pricingMode||
     !equalMoney(q.monthlyExVat,result.monthlyExVat)||
     !equalMoney(q.monthlyIncVat,result.monthlyIncVat)||
     !equalMoney(q.initialExVat,result.initialExVat)||
     !equalMoney(q.initialIncVat,result.initialIncVat))
    return fail("quoted_amount_changed");

  return {ok:true,current:true,sourceRevisionVerified:true,
    registration,quoteId:q.quoteId,sourceRevision,quote:result};
}
