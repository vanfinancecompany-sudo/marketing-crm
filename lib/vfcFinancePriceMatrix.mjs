/**
 * Proposed VFC sales-site finance prices. PURE DRY-RUN HELPER ONLY.
 * Do not use this to write Wix, Supabase or advertising data.
 * The live VFC calculator is the reference for effective APR amortisation.
 */
export const VFC_PRICE_POLICY=Object.freeze({
 apr:9.9,months:60,terms:Object.freeze([36,48,60]),vatRate:0.2,
 version:'vfc-hp-9.9-2026-10'
});
export function cashPriceNumber(raw){
 if(typeof raw==='number')return Number.isFinite(raw)&&raw>0?raw:null;
 const text=String(raw??'').trim();
 // Reject malformed thousands separators such as "£21.995".
 if(/\d+\.\d{3}(?!\d)/.test(text))return null;
 const match=text.match(/^£?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?=$|\s|\+|\[)/);
 if(!match)return null;
 const value=Number(match[1].replace(/,/g,''));
 return Number.isFinite(value)&&value>0?value:null;
}
export function currentMonthlyNumber(raw){
 const match=String(raw??'').match(/£\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
 if(!match)return null;
 const value=Number(match[1].replace(/,/g,''));
 return Number.isFinite(value)&&value>=0?value:null;
}
export function hpMonthlyPayment(principal,months=VFC_PRICE_POLICY.months,apr=VFC_PRICE_POLICY.apr){
 if(!Number.isFinite(principal)||principal<0||!VFC_PRICE_POLICY.terms.includes(months)||!Number.isFinite(apr)||apr<0)throw new RangeError('Invalid HP pricing inputs');
 if(principal===0)return 0;
 if(apr===0)return principal/months;
 const rate=Math.expm1(Math.log1p(apr/100)/12);
 return principal*rate/-Math.expm1(-months*Math.log1p(rate));
}
export function roundMonthlyUp(value){
 if(!Number.isFinite(value)||value<0)throw new RangeError('Invalid monthly payment');
 return Math.ceil(value-Number.EPSILON*Math.max(1,value)*4);
}
/**
 * Canonical VFC sales-site advertised monthly payment from the financed balance.
 * DealerKit retail figures are the ex-VAT amount for +VAT vans; a VAT-equivalent
 * deposit is paid upfront, so the financed amount still equals retail.
 * Cars and N/A vans finance their displayed cash retail by default.
 * Return null rather than advertising an invalid amount.
 */
// Temporary safety hold: these current listings have unresolved Wix pricing/VAT/identity conflicts.
export const VFC_PRICING_REVIEW_HOLDS=Object.freeze([
 'WGZ8806','WM73CXJ','YK23ZYA','JM10ASM','LM70YPT','MT18UFR',
 'PE71YTG','FL19OFN','FL71GZW','SF70TNO'
]);
export function isVfcPricingReviewHeld(registration){
 return VFC_PRICING_REVIEW_HOLDS.includes(String(registration??'').toUpperCase().replace(/[^A-Z0-9]/g,''));
}
export function calculateVfcAdvertisedMonthly(retailPrice) {
 const principal=cashPriceNumber(retailPrice);
 return principal===null?null:roundMonthlyUp(hpMonthlyPayment(principal));
}
export function previewVfcMonthlyPrice({kind,price,vat='no_vat',oldMonthly,months=VFC_PRICE_POLICY.months}={}){
 if(!['van','car'].includes(kind))return {ok:false,reason:'UNSUPPORTED_KIND'};
 const netOrCashPrice=cashPriceNumber(price);
 if(netOrCashPrice===null)return {ok:false,reason:'INVALID_CASH_PRICE',price};
 const plusVat=kind==='van'&&(/\+\s*vat/i.test(String(vat))||/\+\s*vat/i.test(String(price)));
 const knownNonVat=kind==='car'||/^(?:n\/a|no vat|non.vat|vat free)$/i.test(String(vat).trim())||/no\s*vat/i.test(String(price));
 if(kind==='van'&&!plusVat&&!knownNonVat)return {ok:false,reason:'UNVERIFIED_VAT_TREATMENT',price,vat};
 // Ex-VAT stock: default total deposit is the VAT amount; financed amount equals ex-VAT price.
 // Cars: non-VAT, no deposit by default. No stock data is altered here.
 const cashPrice=plusVat?netOrCashPrice*(1+VFC_PRICE_POLICY.vatRate):netOrCashPrice;
 const deposit=plusVat?netOrCashPrice*VFC_PRICE_POLICY.vatRate:0;
 const amountFinanced=cashPrice-deposit;
 const exact=hpMonthlyPayment(amountFinanced,months);
 const rounded=roundMonthlyUp(exact);
 const previous=currentMonthlyNumber(oldMonthly);
 return {ok:true,kind,cashPrice,deposit,amountFinanced,apr:VFC_PRICE_POLICY.apr,months,
  exactMonthly:exact,newMonthly:rounded,oldMonthly:previous,change:previous===null?null:rounded-previous};
}
