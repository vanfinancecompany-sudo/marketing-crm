import {timingSafeEqual} from "node:crypto";
import {manualSpecialSourceRevision} from "../lib/rent2BuyManualSpecialRevision.mjs";
import {getSupabaseServiceAdmin} from "./_vansco-cache-utils.js";
import {fetchDealerKitStockDetail} from "./_dealerkit-stock-adapter.js";
import {rent2BuyMaximumTerm} from "../lib/rent2BuyFlexiblePricing.mjs";
import {protectedOffers,reg} from "../lib/rent2BuySpecialDealControl.mjs";
const safeEqual=(candidate,expected)=>{
 if(typeof candidate!=="string"||typeof expected!=="string"||expected.length<32)return false;
 const a=Buffer.from(candidate),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
};
export const manualSpecialAuth=(request,env=process.env)=>{
 const key=request.headers?.["x-rent2buy-quote-verifier-key"];
 return safeEqual(key,env.RENT2BUY_QUOTE_VERIFY_KEY)||safeEqual(key,env.RENT2BUY_VFC_QUOTE_VERIFY_KEY);
};
export const checkedManualSpecial=(registration,record,vehicle)=>{
 const id=reg(registration),sourceId=String(record?.source_stock_id||"");
 if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(id)||record?.enabled!==true||
   reg(record.registration)!==id||!sourceId||
   reg(vehicle?.registration)!==id||String(vehicle?.supplierStockId||"")!==sourceId)
   throw new Error("special_vehicle_identity_unverified");
 const monthly=Number(record.monthly_ex_vat),initial=Number(record.initial_ex_vat),term=Number(record.term_months);
 const status=String(vehicle.status||vehicle.sourceStatus||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
 const max=rent2BuyMaximumTerm({registrationYear:vehicle.year,vehicleMileage:vehicle.mileage,milesPerMonth:1000});
 const money=n=>Number.isFinite(n)&&n>0&&Math.abs(n*100-Math.round(n*100))<0.001;
 if(!money(monthly)||!money(initial)||initial<1000||
    ![12,18,24,30,36,42,48].includes(term)||!max||term>max||
    !["available","in_stock","due_in"].includes(status)||
    !Number.isFinite(Number(vehicle.retailPrice))||Number(vehicle.retailPrice)<=0)
   throw new Error("special_deal_no_longer_eligible");
 const sourceRevision=manualSpecialSourceRevision(record);
 return {registration:id,pricingMode:"fixed_manual_special",monthlyExVat:monthly,
   monthlyIncVat:Math.round(monthly*120)/100,initialExVat:initial,
   initialIncVat:Math.round(initial*120)/100,termMonths:term,
   contractualMileage:null,customisable:false,sourceRevision};
};
export default async function handler(request,response){
 response.setHeader("Cache-Control","private, no-store");
 if(request.method!=="POST")return response.status(405).json({ok:false,error:"method_not_allowed"});
 if(!manualSpecialAuth(request))return response.status(401).json({ok:false,error:"unauthorised"});
 if(process.env.RENT2BUY_MANUAL_SPECIALS_ENABLED!=="true")
   return response.status(200).json({ok:true,active:false});
 let body=request.body;
 if(typeof body==="string"){try{body=JSON.parse(body);}catch{body={};}}
 const id=reg(body?.registration);
 if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(id))
   return response.status(400).json({ok:false,error:"invalid_registration"});
 if(protectedOffers().some(x=>x.registration===id))
   return response.status(200).json({ok:true,active:false}); // CRM owns protected four.
 try{
   const {data,error}=await getSupabaseServiceAdmin().from("rent2buy_special_deals")
    .select("registration,monthly_ex_vat,initial_ex_vat,term_months,source_stock_id,enabled,updated_at")
    .eq("registration",id).eq("enabled",true).maybeSingle();
   if(error)throw error;
   if(!data)return response.status(200).json({ok:true,active:false});
   const vehicle=await fetchDealerKitStockDetail(data.source_stock_id,{specifications:false});
   const special=checkedManualSpecial(id,data,vehicle);
   return response.status(200).json({ok:true,active:true,special});
 }catch(error){
   console.error("[rent2buy-manual-verify] approval failed",error?.message||"unknown");
   return response.status(503).json({ok:false,error:"current_special_unavailable"});
 }
}
