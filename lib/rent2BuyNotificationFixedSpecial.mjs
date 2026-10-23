const FIXED=Object.freeze({
  BT25LVK:Object.freeze({monthlyExVat:595,initialExVat:2000,termMonths:48}),
  FV74BBJ:Object.freeze({monthlyExVat:545,initialExVat:2000,termMonths:48}),
  FV74BEO:Object.freeze({monthlyExVat:595,initialExVat:2000,termMonths:48}),
  BJ74HTL:Object.freeze({monthlyExVat:595,initialExVat:2000,termMonths:48}),
});
const reg=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const sterling=value=>"£"+Number(value).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});

export function normaliseRent2BuyNotificationFixedSpecial(raw,vehicleRegistration){
  if(!raw)return null;
  const registration=reg(vehicleRegistration);
  const expected=FIXED[registration];
  if(!expected)throw new Error("Fixed Rent2Buy special in internal notification is invalid.");
  if(reg(raw.registration)!==registration||
     Number(raw.monthlyExVat)!==expected.monthlyExVat||
     Number(raw.initialExVat)!==expected.initialExVat||
     Number(raw.termMonths)!==expected.termMonths||
     raw.contractualMileage!==null||
     raw.customisable!==false)
    throw new Error("Fixed Rent2Buy special in internal notification does not match the server-approved deal.");
  return {
    registration,
    pricingMode:"fixed_legacy_special",
    monthlyExVat:expected.monthlyExVat,
    monthlyIncVat:Math.round(expected.monthlyExVat*1.2*100)/100,
    initialExVat:expected.initialExVat,
    initialIncVat:Math.round(expected.initialExVat*1.2*100)/100,
    termMonths:expected.termMonths,
    contractualMileage:null,
    customisable:false,
  };
}

export function rent2BuyNotificationFixedSpecialLines(deal){
  if(!deal)return "";
  return [
    "FIXED RENT2BUY SPECIAL",
    "Vehicle registration: "+deal.registration,
    "Pricing: Fixed legacy special (not Felix matrix)",
    "Contract length: "+deal.termMonths+" months",
    "Contract mileage allowance: Not applicable - fixed special is not customisable",
    "Monthly rental: "+sterling(deal.monthlyExVat)+" + VAT ("+sterling(deal.monthlyIncVat)+" inc VAT)",
    "Initial rental: "+sterling(deal.initialExVat)+" + VAT ("+sterling(deal.initialIncVat)+" inc VAT)",
  ].join("\n");
}
export function rent2BuyNotificationFixedSpecialFields(deal){
  if(!deal)return [];
  return [
    ["Pricing","Fixed legacy special"],
    ["Contract length",deal.termMonths+" months"],
    ["Contract mileage allowance","Not applicable - fixed special"],
    ["Monthly rental",sterling(deal.monthlyExVat)+" + VAT ("+sterling(deal.monthlyIncVat)+" inc VAT)"],
    ["Initial rental",sterling(deal.initialExVat)+" + VAT ("+sterling(deal.initialIncVat)+" inc VAT)"],
  ];
}
