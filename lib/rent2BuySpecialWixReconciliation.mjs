/**
 * Read-only comparison of Wix listing/detail fields against the four
 * user-confirmed FIXED legacy specials.
 *
 * Contractual mileage is deliberately irrelevant here: these four are not
 * customisable Felix-matrix deals.
 */
import {pendingRent2BuySpecialDeal} from "./rent2BuyProtectedSpecialDeals.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const amount=value=>{
  const m=String(value??"").match(/£\s*([\d,]+)(?:\.(\d{1,2}))?/i);
  if(!m)return null;
  return Number(m[1].replace(/,/g,""))+Number("0."+(m[2]||"00"));
};
const payments=value=>{
  const m=String(value??"").toUpperCase().match(/^X\s*(\d{1,3})\b|^(\d{1,3})\s*X\b/);
  return m?Number(m[1]||m[2]):null;
};
const data=value=>value?.data&&typeof value.data==="object"?value.data:(value||{});

export function inspectRent2BuyWixSpecial({registration,listing,detail}={}){
  const id=reg(registration);
  const fixed=pendingRent2BuySpecialDeal(id);
  const problems=[];
  if(!fixed)return {registration:id,ready:false,problems:["not_a_fixed_legacy_special"]};

  const l=data(listing),d=data(detail);
  if(reg(l.title)!==id)problems.push("missing_or_wrong_listing");
  if(reg(d.title)!==id)problems.push("missing_or_wrong_vehicle_detail");

  const values={
    listingMonthly:amount(l.mth),
    detailMonthly:amount(d.monthlyPayments),
    listingInitial:amount(l.initialRental2250Vat ?? l.initialRental2385Vat ?? l.initialRental2085Vat),
    detailInitial:amount(d.intialRentalCharge),
    listingPayments:payments(l.weekly),
    detailPayments:payments(d.numberOfMonths),
    expectedMonthly:fixed.monthlyExVat,
    expectedInitial:fixed.initialExVat,
    expectedPayments:fixed.termMonths,
  };

  for(const [field,val] of Object.entries(values)){
    if(val===null||val===undefined)problems.push("missing_"+field);
  }
  if(values.listingMonthly!==fixed.monthlyExVat)problems.push("listing_monthly_not_fixed_special");
  if(values.detailMonthly!==fixed.monthlyExVat)problems.push("detail_monthly_not_fixed_special");
  if(values.listingInitial!==fixed.initialExVat)problems.push("listing_initial_not_fixed_special");
  if(values.detailInitial!==fixed.initialExVat)problems.push("detail_initial_not_fixed_special");
  if(values.listingPayments!==fixed.termMonths)problems.push("listing_term_not_fixed_special");
  if(values.detailPayments!==fixed.termMonths)problems.push("detail_term_not_fixed_special");

  return {registration:id,ready:problems.length===0,fixedSpecial:true,customisable:false,
    contractualMileageRequired:false,values,problems};
}
