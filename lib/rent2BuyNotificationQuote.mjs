/**
 * Presentation-only recipient view of the quote already verified by main CRM.
 * Does not issue or approve pricing. Internal notification uses a server-to-server
 * authenticated endpoint and rejects malformed/mismatched quote envelopes.
 */
const clean=(v,n=240)=>String(v??"").trim().slice(0,n);
const reg=v=>clean(v,40).toUpperCase().replace(/[^A-Z0-9]/g,"");
const sterling=v=>"£"+Number(v).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
export function normaliseRent2BuyNotificationQuote(raw,vehicleRegistration) {
  if (!raw) return null;
  const q=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  const registration=reg(q.registration);
  const term=Number(q.termMonths),miles=Number(q.milesPerMonth);
  const monthly=Number(q.monthlyExVat),initial=Number(q.initialExVat);
  const vatMonthly=Number(q.monthlyIncVat),vatInitial=Number(q.initialIncVat);
  const money=n=>Number.isFinite(n)&&n>0&&Math.abs(n*100-Math.round(n*100))<0.00001;
  const vat=n=>Math.round((n*1.2+Number.EPSILON)*100)/100;
  if (!registration || !reg(vehicleRegistration) || registration!==reg(vehicleRegistration)
      || !clean(q.quoteId,100) || !clean(q.sourceRevision,120)
      || ![12,18,24,30,36,42,48].includes(term)
      || ![1000,1500,2000,2500,3000,3500,4000].includes(miles)
      || !["matrix","special"].includes(q.pricingMode)
      || !money(monthly) || !money(initial) || initial<1000
      || !money(vatMonthly) || !money(vatInitial)
      || vat(monthly)!==vatMonthly || vat(initial)!==vatInitial
  )throw new Error("Selected rental quote in internal notification is invalid.");
  return {
    registration,quoteId:clean(q.quoteId,100),sourceRevision:clean(q.sourceRevision,120),
    pricingMode:q.pricingMode,termMonths:term,milesPerMonth:miles,
    monthlyExVat:monthly,monthlyIncVat:vatMonthly,
    initialExVat:initial,initialIncVat:vatInitial,
  };
}

export function rent2BuyNotificationQuoteLines(q) {
  if(!q)return "";
  return [
    "SELECTED RENT2BUY RENTAL (VERIFIED)",
    "Quote reference: "+q.quoteId,
    "Vehicle registration: "+q.registration,
    "Pricing: "+(q.pricingMode==="special"?"Special deal":"Standard matrix"),
    "Contract length: "+q.termMonths+" months",
    "Contract mileage allowance: "+q.milesPerMonth.toLocaleString("en-GB")+" miles per month",
    "Monthly rental: "+sterling(q.monthlyExVat)+" + VAT ("+sterling(q.monthlyIncVat)+" inc VAT)",
    "Initial rental: "+sterling(q.initialExVat)+" + VAT ("+sterling(q.initialIncVat)+" inc VAT)",
  ].join("\n");
}
export function rent2BuyNotificationQuoteFields(q) {
  if(!q)return [];
  return [
    ["Quote reference",q.quoteId],
    ["Pricing",q.pricingMode==="special"?"Special deal":"Standard matrix"],
    ["Contract length",q.termMonths+" months"],
    ["Contract mileage allowance",q.milesPerMonth.toLocaleString("en-GB")+" miles/month"],
    ["Monthly rental",sterling(q.monthlyExVat)+" + VAT ("+sterling(q.monthlyIncVat)+" inc VAT)"],
    ["Initial rental",sterling(q.initialExVat)+" + VAT ("+sterling(q.initialIncVat)+" inc VAT)"],
  ];
}
