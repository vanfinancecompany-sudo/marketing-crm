/**
 * Server-side selector choices from the existing reviewed DealerKit vehicle.
 * The browser receives choices only; all prices are recalculated server-side.
 */
import {
  RENT2BUY_MATRIX_MILEAGE_BANDS,
  availableRent2BuyTerms,
  rent2BuyInitialRentalLadder,
  quoteRent2BuyMatrix,
} from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");

export function approvedRent2BuySelectorChoices(source){
  const vehicle=source?.vehicle;
  if(!vehicle||!Number.isFinite(Number(source.sourceRetailPrice))||
     Number(source.sourceRetailPrice)<=0)
    return {ok:false,error:"pricing_source_unavailable"};

  const registration=reg(vehicle.registration);
  const special=source.activeSpecial||null;
  if(pendingRent2BuySpecialDeal(registration)&&!special)
    return {ok:false,error:"protected_special_not_imported"};

  const initialRentalOptionsExVat=rent2BuyInitialRentalLadder(source.sourceRetailPrice);
  if(!initialRentalOptionsExVat?.length)
    return {ok:false,error:"initial_rental_unavailable"};

  const allowedMileageTerms=RENT2BUY_MATRIX_MILEAGE_BANDS.map(milesPerMonth=>({
    milesPerMonth,
    termMonths:availableRent2BuyTerms({
      registrationYear:vehicle.year,
      vehicleMileage:vehicle.mileage,
      milesPerMonth,
    }),
  })).filter(row=>row.termMonths.length>0);

  if(!allowedMileageTerms.length)return {ok:false,error:"no_available_terms"};

  let promotion=null;
  if(special){
    const preview=quoteRent2BuyMatrix({
      retailPrice:source.sourceRetailPrice,
      registrationYear:vehicle.year,
      vehicleMileage:vehicle.mileage,
      termMonths:special.term_months,
      milesPerMonth:special.miles_per_month,
      initialRentalExVat:special.initial_ex_vat,
      specialDeal:{
        enabled:true,
        monthlyExVat:special.monthly_ex_vat,
        initialExVat:special.initial_ex_vat,
        termMonths:special.term_months,
        milesPerMonth:special.miles_per_month,
      },
    });
    if(preview.status!=="ok"||preview.pricingMode!=="special")
      return {ok:false,error:"special_not_eligible"};
    promotion={
      termMonths:preview.termMonths,
      milesPerMonth:preview.milesPerMonth,
      initialExVat:preview.initialExVat,
      monthlyExVat:preview.monthlyExVat,
    };
  }

  return {
    ok:true,
    registration,
    vehicleTitle:String(vehicle.title||registration).slice(0,180),
    allowedMileageTerms,
    initialRentalOptionsExVat,
    minimumInitialExVat:initialRentalOptionsExVat[0],
    special:promotion,
  };
}
