/**
 * Pure server-side quote issuer for a future rate-limited public selector API.
 * DO NOT expose as a public endpoint until stock cache, abuse controls and
 * customer-facing acceptance tests are approved.
 */
import { randomUUID } from "node:crypto";
import { signRent2BuyQuote } from "./rent2BuyQuoteHandoff.mjs";
import { quoteRent2BuyMatrix } from "./rent2BuyFlexiblePricing.mjs";
import { rent2BuyApprovedSourceRevision, verifyRent2BuyQuoteAgainstSource } from "./rent2BuyCurrentSourceQuote.mjs";
const failed=code=>({ok:false,error:code});

export function issueApprovedRent2BuyQuote({
  source,selection={},secret,now=Date.now(),reference=randomUUID(),
}={}){
  if(!source?.vehicle||!secret||String(secret).length<32)
    return failed("pricing_source_or_signature_not_configured");
  const requestedTerm=selection.termMonths===undefined?undefined:Number(selection.termMonths);
  const requestedMiles=selection.milesPerMonth===undefined?undefined:Number(selection.milesPerMonth);
  const requestedInitial=selection.initialExVat===undefined?undefined:Number(selection.initialExVat);

  // Special promotions are fixed configurations. Changing one input to the
  // ordinary matrix must also choose one of that matrix's valid upfront steps.
  const s=source.activeSpecial;
  const active=s?.status==="active"&&s?.id?{
    enabled:true,
    monthlyExVat:Number(s.monthly_ex_vat),
    initialExVat:Number(s.initial_ex_vat),
    termMonths:Number(s.term_months),
    milesPerMonth:Number(s.miles_per_month),
  }:null;
  const selected=quoteRent2BuyMatrix({
    retailPrice:source.approvedRetailExVat,
    registrationYear:source.vehicle.year,
    vehicleMileage:source.vehicle.mileage,
    termMonths:requestedTerm,
    milesPerMonth:requestedMiles,
    initialRentalExVat:requestedInitial,
    specialDeal:active,
  });
  if(selected.status!=="ok")return failed(selected.reason||"unavailable_quote");

  const quote={
    quoteId:"r2b-"+String(reference).replace(/[^a-zA-Z0-9-]/g,"").slice(0,90),
    registration:source.vehicle.registration,
    vehicleTitle:source.vehicle.title||source.vehicle.registration,
    pricingMode:selected.pricingMode,
    termMonths:selected.termMonths,
    milesPerMonth:selected.milesPerMonth,
    monthlyExVat:selected.monthlyExVat,
    initialExVat:selected.initialExVat,
    sourceRevision:rent2BuyApprovedSourceRevision(source),
    issuedAt:now,
    expiresAt:now+30*60*1000,
  };
  const toCheck={
    ...quote,
    monthlyIncVat:selected.monthlyIncVat,
    initialIncVat:selected.initialIncVat,
  };
  const current=verifyRent2BuyQuoteAgainstSource(toCheck,source,{now});
  if(!current.ok)return failed(current.reason||"quote_not_approved");
  try {
    const token=signRent2BuyQuote(quote,secret,now);
    return {
      ok:true,
      quote:{...selected,
        quoteId:quote.quoteId,registration:quote.registration,
        vehicleTitle:quote.vehicleTitle,sourceRevision:quote.sourceRevision,
        issuedAt:now,expiresAt:quote.expiresAt},
      token,
    };
  }catch{return failed("quote_signing_unavailable")}
}
