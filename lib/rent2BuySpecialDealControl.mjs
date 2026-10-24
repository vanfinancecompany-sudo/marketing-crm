import {RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS} from "./rent2BuyProtectedSpecialDeals.mjs";
export const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
export const protectedOffers=()=>Object.entries(RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS).map(([registration,v])=>({
 registration,monthlyExVat:v.monthlyExVat,initialExVat:v.initialExVat,termMonths:v.termMonths,
 enabled:true,protected:true,source:"protected_legacy",customisable:false
}));
export const validMoney=n=>typeof n==="number"&&Number.isFinite(n)&&n>0&&Number.isInteger(Math.round(n*100))&&Math.abs(n*100-Math.round(n*100))<0.001;
export function validateDraft(value={}){
 const registration=reg(value.registration);
 const monthlyExVat=Number(value.monthlyExVat);
 const initialExVat=Number(value.initialExVat);
 const termMonths=Number(value.termMonths);
 if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration))throw Error("Enter a valid registration.");
 if(RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS[registration])throw Error("The four approved legacy specials are protected.");
 if(!validMoney(monthlyExVat)||monthlyExVat>10000)throw Error("Enter a valid monthly rental excluding VAT.");
 if(!validMoney(initialExVat)||initialExVat<1000||initialExVat>100000)throw Error("Initial rental must be at least £1,000 excluding VAT.");
 if(![12,18,24,30,36,42,48].includes(termMonths))throw Error("Choose an approved contract term.");
 return {registration,monthlyExVat,initialExVat,termMonths};
}
export const incVat=n=>Math.round((Number(n)*1.2+Number.EPSILON)*100)/100;
export function visibleOffers(rows=[]){
 const protectedByReg=new Map(protectedOffers().map(x=>[x.registration,x]));
 for(const v of rows){
  const key=reg(v.registration);
  if(!protectedByReg.has(key)&&v.enabled===true)protectedByReg.set(key,{
    registration:key,monthlyExVat:Number(v.monthly_ex_vat),initialExVat:Number(v.initial_ex_vat),termMonths:Number(v.term_months),
    enabled:true,protected:false,source:"approved_manual",customisable:false
  });
 }
 return [...protectedByReg.values()];
}
