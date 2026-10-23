/**
 * Pure authoritative Rent2Buy quote comparison.
 * No I/O or live publishing. Server must supply a verified current stock record,
 * a reviewed Rent2Buy decision, and an approved EX-VAT pricing base.
 *
 * Never infer EX-VAT from DealerKit retail until commercial VAT mapping is
 * approved for the vehicle. Pending Wix manual specials remain held.
 */
import { createHash } from "node:crypto";
import { quoteRent2BuyMatrix } from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

const reg=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const money=value=>Number.isFinite(Number(value))&&Number(value)>0&&Math.abs(Number(value)*100-Math.round(Number(value)*100))<0.00001;
const equalMoney=(left,right)=>Math.abs(Number(left)-Number(right))<0.001;
const fail=reason=>({ok:false,reason});

export function rent2BuyApprovedSourceRevision(source={}){
  const v=source.vehicle||{};
  const d=source.decision||{};
  const special=source.activeSpecial||null;
  const parts={
    matrix:"felix-2026-09-30-v1",
    registration:reg(v.registration),
    supplierStockId:String(v.supplierStockId||""),
    sourceUpdatedAt:String(v.sourceUpdatedAt||""),
    year:String(v.year||""),
    mileage:String(v.mileage??""),
    retailAmount:String(v.retailPrice??""),
    vatStatus:String(v.vatStatus||""),
    approvedRetailExVat:String(source.approvedRetailExVat??""),
    reviewed:Boolean(d.rent2buyEnabled && d.reviewStatus==="reviewed"),
    special:special?{
      id:String(special.id||""),
      revision:Number(special.revision||0),status:String(special.status||""),
      monthlyExVat:Number(special.monthly_ex_vat),
      initialExVat:Number(special.initial_ex_vat),
      termMonths:Number(special.term_months),
      milesPerMonth:Number(special.miles_per_month),
      expiresAt:String(special.expires_at||""),
    }:null,
  };
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0,40);
}

export function verifyRent2BuyQuoteAgainstSource(approvedQuote,source,{now=Date.now()}={}){
  const q=approvedQuote||{},v=source?.vehicle||{},d=source?.decision||{};
  const registration=reg(v.registration),requestedReg=reg(q.registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration)||registration!==requestedReg)
    return fail("registration_mismatch");
  if(!String(v.supplierStockId||"").trim()||
    String(d.supplierStockId||"").trim()!==String(v.supplierStockId||"").trim()||
    reg(d.registration)!==registration||
    d.rent2buyEnabled!==true||d.reviewStatus!=="reviewed"||
    source.stockVerifiedCurrent!==true)
    return fail("unverified_stock_or_review");
  if(source.retailVatBasisApproved!==true||!money(source.approvedRetailExVat)||
    !String(v.vatStatus||"").trim()||v.vatStatus==="unknown")
    return fail("retail_vat_basis_unverified");

  const special=source.activeSpecial||null;
  // Existing manual Wix promotions never auto-switch to the matrix.
  if(pendingRent2BuySpecialDeal(registration) && !special)
    return fail("manual_special_migration_hold");

  let eligibleSpecial=null;
  if(special){
    const expiry=special.expires_at?new Date(special.expires_at).valueOf():Infinity;
    if(special.status!=="active"||!special.id||!Number.isSafeInteger(Number(special.revision))||
      reg(special.registration)!==registration||
      String(special.supplier_stock_id||"")!==String(v.supplierStockId||"")||
      !Number.isFinite(expiry)||expiry<=now) return fail("special_deal_not_active");
    if(!money(special.monthly_ex_vat)||!money(special.initial_ex_vat)||
      Number(special.initial_ex_vat)<1000)return fail("special_deal_invalid");
    eligibleSpecial={
      enabled:true,monthlyExVat:Number(special.monthly_ex_vat),
      initialExVat:Number(special.initial_ex_vat),
      termMonths:Number(special.term_months),
      milesPerMonth:Number(special.miles_per_month),
    };
  }
  const sourceRevision=rent2BuyApprovedSourceRevision(source);
  if(q.sourceRevision!==sourceRevision)return fail("source_revision_changed");

  const result=quoteRent2BuyMatrix({
    retailPrice:Number(source.approvedRetailExVat),
    registrationYear:v.year,
    vehicleMileage:v.mileage,
    termMonths:q.termMonths,
    milesPerMonth:q.milesPerMonth,
    initialRentalExVat:q.initialExVat,
    specialDeal:eligibleSpecial,
  });
  if(result.status!=="ok")return fail(result.reason||"matrix_quote_ineligible");
  if(q.pricingMode!==result.pricingMode ||
    !equalMoney(q.monthlyExVat,result.monthlyExVat)||
    !equalMoney(q.monthlyIncVat,result.monthlyIncVat)||
    !equalMoney(q.initialExVat,result.initialExVat)||
    !equalMoney(q.initialIncVat,result.initialIncVat))
    return fail("quoted_amount_changed");
  return {ok:true,current:true,sourceRevisionVerified:true,registration,quoteId:q.quoteId,sourceRevision,quote:result};
}
