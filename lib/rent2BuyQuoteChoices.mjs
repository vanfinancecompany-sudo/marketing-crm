/**
 * Server-side selector choices for a single reviewed Rent2Buy vehicle.
 * NO quote is approved or signed here; submitted options must be rechecked by
 * issueApprovedRent2BuyQuote against a freshly loaded authoritative source.
 */
import {
  RENT2BUY_MATRIX_MILEAGE_BANDS,
  availableRent2BuyTerms,
  rent2BuyInitialRentalLadder,
  quoteRent2BuyMatrix,
} from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

const reg = v => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function approvedRent2BuySelectorChoices(source){
  const vehicle=source?.vehicle;
  if(!vehicle || source.stockVerifiedCurrent!==true ||
     source.retailVatBasisApproved!==true ||
     source.commercialTermsApproved!==true ||
     !Number.isFinite(Number(source.approvedRetailExVat)) ||
     Number(source.approvedRetailExVat)<=0 ||
     !Array.isArray(source.approvedTermMonths) ||
     source.approvedTermMonths.length===0)
    return {ok:false,error:"approved_pricing_unavailable"};

  const registration=reg(vehicle.registration);
  const special=source.activeSpecial;
  if(pendingRent2BuySpecialDeal(registration) && !special)
    return {ok:false,error:"protected_special_not_imported"};

  const ladder=rent2BuyInitialRentalLadder(source.approvedRetailExVat);
  if(!ladder?.length)return {ok:false,error:"initial_rental_unavailable"};

  const mileage=RENT2BUY_MATRIX_MILEAGE_BANDS.map(miles=>{
    const calculated=availableRent2BuyTerms({
      registrationYear:vehicle.year,
      vehicleMileage:vehicle.mileage,
      milesPerMonth:miles,
    });
    const approved=calculated.filter(term=>source.approvedTermMonths.includes(term));
    return {milesPerMonth:miles,termMonths:approved};
  }).filter(x=>x.termMonths.length>0);

  if(!mileage.length)return {ok:false,error:"no_approved_terms"};

  // The listed special is a single fixed configuration, never a blanket discount.
  // Do not present unapproved, expired or malformed overrides as live choices.
  let promotion=null;
  if(special){
    const expires=special.expires_at?Date.parse(special.expires_at):null;
    if(special.status!=="active"||!special.id||
       (special.expires_at && (!Number.isFinite(expires)||expires<=Date.now())))
      return {ok:false,error:"special_not_approved"};
    const preview=quoteRent2BuyMatrix({
      retailPrice:source.approvedRetailExVat,
      registrationYear:vehicle.year,
      vehicleMileage:vehicle.mileage,
      termMonths:special.term_months,
      milesPerMonth:special.miles_per_month,
      initialRentalExVat:special.initial_ex_vat,
      specialDeal:{
        enabled:true,monthlyExVat:special.monthly_ex_vat,
        initialExVat:special.initial_ex_vat,
        termMonths:special.term_months,
        milesPerMonth:special.miles_per_month,
      },
    });
    if(preview.status!=="ok"||preview.pricingMode!=="special"||
       !source.approvedTermMonths.includes(preview.termMonths))
      return {ok:false,error:"special_not_eligible"};
    promotion={
      termMonths:preview.termMonths,
      milesPerMonth:preview.milesPerMonth,
      initialExVat:preview.initialExVat,
      // amount shown only as advertised/approved; never use it to sign anything
      monthlyExVat:preview.monthlyExVat,
    };
  }
  return {
    ok:true,
    registration,
    vehicleTitle:String(vehicle.title||registration).slice(0,180),
    allowedMileageTerms:mileage,
    initialRentalOptionsExVat:ladder,
    minimumInitialExVat:ladder[0],
    special:promotion,
  };
}
