/**
 * Server-side Felix-matrix selector choices for a reviewed DealerKit vehicle.
 * Four fixed legacy specials never reach this function in normal routing.
 */
import {
  RENT2BUY_MATRIX_MILEAGE_BANDS,
  availableRent2BuyTerms,
  rent2BuyInitialRentalLadder,
} from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";
const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");

export function approvedRent2BuySelectorChoices(source){
  const vehicle=source?.vehicle;
  if(!vehicle||!Number.isFinite(Number(source.sourceRetailPrice))||Number(source.sourceRetailPrice)<=0)
    return {ok:false,error:"pricing_source_unavailable"};
  const registration=reg(vehicle.registration);
  if(pendingRent2BuySpecialDeal(registration))
    return {ok:false,error:"fixed_legacy_special_not_customisable"};
  const initialRentalOptionsExVat=rent2BuyInitialRentalLadder(source.sourceRetailPrice);
  if(!initialRentalOptionsExVat?.length)return {ok:false,error:"initial_rental_unavailable"};
  const allowedMileageTerms=RENT2BUY_MATRIX_MILEAGE_BANDS.map(milesPerMonth=>({
    milesPerMonth,
    termMonths:availableRent2BuyTerms({
      registrationYear:vehicle.year,
      vehicleMileage:vehicle.mileage,
      milesPerMonth,
    }),
  })).filter(row=>row.termMonths.length>0);
  if(!allowedMileageTerms.length)return {ok:false,error:"no_available_terms"};
  return {
    ok:true,registration,
    vehicleTitle:String(vehicle.title||registration).slice(0,180),
    allowedMileageTerms,
    initialRentalOptionsExVat,
    minimumInitialExVat:initialRentalOptionsExVat[0],
    special:null,
  };
}
