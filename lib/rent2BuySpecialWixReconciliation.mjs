/**
 * Read-only reconciliation of Rent2Buy listing vs vehicle-detail Wix prices.
 *
 * This is a PRE-MIGRATION check, not a price importer. Never decide that one
 * conflicting Wix field is "correct". Both records and the written commercial
 * term/mileage agreement must match before activating a new special.
 */
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

const cleanReg=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const amount=value=>{
  const v=String(value??"").trim();
  // Prices in these known CMS fields are labelled £ followed by ex-VAT money.
  const match=v.match(/£\s*([\d,]+)(?:\.(\d{1,2}))?/i);
  if(!match)return null;
  const parsed=Number(match[1].replace(/,/g,""))+Number("0."+(match[2]||"00"));
  return Number.isFinite(parsed) && parsed>0 ? Math.round(parsed*100)/100 : null;
};
const payments=value=>{
  const raw=String(value??"").toUpperCase().trim();
  const match=raw.match(/^X\s*(\d{1,3})\b|^(\d{1,3})\s*X\b/);
  const result=match?Number(match[1]||match[2]):null;
  return Number.isInteger(result)&&result>=1&&result<=120?result:null;
};
const asData=value=>value&&typeof value==="object"&&value.data&&typeof value.data==="object"
  ?value.data:value||{};

export function inspectRent2BuyWixSpecial({
  registration, listing, detail, reviewedTermMonths=null,
  approvedAgreement=null,
}={}){
  const id=cleanReg(registration);
  const problems=[];
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(id))
    return {registration:id,ready:false,problems:["invalid_registration"]};

  // An exact single item from each collection is required; missing or duplicate
  // items must be detected by the Wix caller BEFORE passing them here.
  const l=asData(listing),d=asData(detail);
  if(cleanReg(l.title)!==id) problems.push("missing_or_wrong_listing");
  if(cleanReg(d.title)!==id) problems.push("missing_or_wrong_vehicle_detail");

  const listingMonthly=amount(l.mth);
  const detailMonthly=amount(d.monthlyPayments);
  const listingInitial=amount(l.initialRental2250Vat ?? l.initialRental2385Vat ?? l.initialRental2085Vat);
  const detailInitial=amount(d.intialRentalCharge);
  const listingPayments=payments(l.weekly);
  const detailPayments=payments(d.numberOfMonths);

  const expected=pendingRent2BuySpecialDeal(id)?.publishedMonthlyExVat??null;
  const values={listingMonthly,detailMonthly,listingInitial,detailInitial,
    listingPayments,detailPayments,legacySpecialMonthly:expected};

  for(const [field,val] of Object.entries(values)){
    if(field==="legacySpecialMonthly")continue;
    if(val===null)problems.push("missing_"+field);
  }
  if(listingMonthly!==null&&detailMonthly!==null&&listingMonthly!==detailMonthly)
    problems.push("monthly_price_disagreement");
  if(listingInitial!==null&&detailInitial!==null&&listingInitial!==detailInitial)
    problems.push("initial_rental_disagreement");
  if(listingPayments!==null&&detailPayments!==null&&listingPayments!==detailPayments)
    problems.push("payment_count_disagreement");
  if(expected!==null && (listingMonthly!==expected||detailMonthly!==expected))
    problems.push("manual_special_price_not_reconciled");
  if(reviewedTermMonths!==null&&reviewedTermMonths!==undefined&&
     (!Number.isInteger(Number(reviewedTermMonths))||
      listingPayments!==Number(reviewedTermMonths)||
      detailPayments!==Number(reviewedTermMonths)))
    problems.push("reviewed_term_disagreement");

  if(!approvedAgreement || approvedAgreement.registration!==id ||
     !Number.isInteger(Number(approvedAgreement.milesPerMonth)) ||
     !Number.isInteger(Number(approvedAgreement.termMonths)) ||
     !Number.isFinite(Number(approvedAgreement.monthlyExVat)) ||
     !Number.isFinite(Number(approvedAgreement.initialExVat))){
    problems.push("approved_special_terms_missing");
  }else if(
    listingMonthly!==Number(approvedAgreement.monthlyExVat)||
    detailMonthly!==Number(approvedAgreement.monthlyExVat)||
    listingInitial!==Number(approvedAgreement.initialExVat)||
    detailInitial!==Number(approvedAgreement.initialExVat)||
    listingPayments!==Number(approvedAgreement.termMonths)||
    detailPayments!==Number(approvedAgreement.termMonths)
  ){
    problems.push("approved_special_terms_do_not_match_wix");
  }
  return {registration:id,ready:problems.length===0,values,problems};
}
