/**
 * Issue a short-lived signed Felix-matrix quote from the EXISTING reviewed
 * vehicle retail price, year and mileage. Fixed legacy specials are separate.
 */
import {randomUUID} from "node:crypto";
import {signRent2BuyQuote} from "./rent2BuyQuoteHandoff.mjs";
import {quoteRent2BuyMatrix} from "./rent2BuyFlexiblePricing.mjs";
import {rent2BuyPricingSourceRevision,verifyRent2BuyQuoteAgainstSource} from "./rent2BuyCurrentSourceQuote.mjs";
const failed=error=>({ok:false,error});

export function issueApprovedRent2BuyQuote({
  source,selection={},secret,now=Date.now(),reference=randomUUID(),
}={}){
  if(!source?.vehicle||!Number.isFinite(Number(source.sourceRetailPrice))||
     !secret||String(secret).length<32)
    return failed("pricing_source_or_signature_not_configured");
  const selected=quoteRent2BuyMatrix({
    retailPrice:Number(source.sourceRetailPrice),
    registrationYear:source.vehicle.year,
    vehicleMileage:source.vehicle.mileage,
    termMonths:selection.termMonths===undefined?undefined:Number(selection.termMonths),
    milesPerMonth:selection.milesPerMonth===undefined?undefined:Number(selection.milesPerMonth),
    initialRentalExVat:selection.initialExVat===undefined?undefined:Number(selection.initialExVat),
  });
  if(selected.status!=="ok")return failed(selected.reason||"unavailable_quote");
  const quote={
    quoteId:"r2b-"+String(reference).replace(/[^a-zA-Z0-9-]/g,"").slice(0,90),
    registration:source.vehicle.registration,
    vehicleTitle:source.vehicle.title||source.vehicle.registration,
    pricingMode:"matrix",
    termMonths:selected.termMonths,
    milesPerMonth:selected.milesPerMonth,
    monthlyExVat:selected.monthlyExVat,
    initialExVat:selected.initialExVat,
    sourceRevision:rent2BuyPricingSourceRevision(source),
    issuedAt:now,
    expiresAt:now+30*60*1000,
  };
  const verified=verifyRent2BuyQuoteAgainstSource({
    ...quote,monthlyIncVat:selected.monthlyIncVat,initialIncVat:selected.initialIncVat,
  },source);
  if(!verified.ok)return failed(verified.reason||"quote_not_approved");
  try{
    return {
      ok:true,
      quote:{...selected,pricingMode:"matrix",quoteId:quote.quoteId,registration:quote.registration,
        vehicleTitle:quote.vehicleTitle,sourceRevision:quote.sourceRevision,
        issuedAt:quote.issuedAt,expiresAt:quote.expiresAt},
      token:signRent2BuyQuote(quote,secret,now),
    };
  }catch{return failed("quote_signing_unavailable")}
}
