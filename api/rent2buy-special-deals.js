import {timingSafeEqual} from "node:crypto";
import {getSupabaseServiceAdmin,isMissingOptionalTableError} from "./_vansco-cache-utils.js";
import {fetchDealerKitStockDetail,fetchDealerKitStockSnapshot} from "./_dealerkit-stock-adapter.js";
import {protectedOffers,reg,validateDraft,visibleOffers} from "../lib/rent2BuySpecialDealControl.mjs";
import {rent2BuyMaximumTerm} from "../lib/rent2BuyFlexiblePricing.mjs";
const table="rent2buy_special_deals";
const secretMatch=(candidate,expected)=>{
 const a=Buffer.from(String(candidate||"")),b=Buffer.from(String(expected||""));
 return a.length>0&&b.length>0&&a.length===b.length&&timingSafeEqual(a,b);
};
// Reuse the existing Customer Database authenticated admin access, not a second password.
const authorised=(req,env=process.env)=>secretMatch(req.headers?.["x-marketing-customer-database-key"],env.MARKETING_CUSTOMER_DATABASE_API_KEY);
const jsonBody=req=>{
 if(req.body&&typeof req.body==="object"&&!Array.isArray(req.body))return req.body;
 try{return JSON.parse(req.body||"{}");}catch{return null;}
};
const readRows=async supabase=>{
 const {data,error}=await supabase.from(table).select("registration,monthly_ex_vat,initial_ex_vat,term_months,enabled,updated_at").order("registration");
 if(error)throw error;
 return data||[];
};
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method==="GET"){
  const admin=req.query?.admin==="1";
  if(admin&&!authorised(req))return res.status(401).json({ok:false,error:"Admin authorisation required."});
  try{
   const rows=await readRows(getSupabaseServiceAdmin());
   const list=admin?rows:visibleOffers(rows.filter(x=>x.enabled));
   return res.status(200).json({ok:true,activationReady:process.env.RENT2BUY_MANUAL_SPECIAL_ACTIVATION_ENABLED==="true",offers:admin?[...protectedOffers(),...rows.filter(x=>!protectedOffers().some(p=>p.registration===reg(x.registration))).map(x=>({
      registration:reg(x.registration),monthlyExVat:Number(x.monthly_ex_vat),initialExVat:Number(x.initial_ex_vat),
      termMonths:Number(x.term_months),enabled:Boolean(x.enabled),protected:false,source:"manual_draft"
   }))]:list,storageReady:true});
  }catch(error){
    if(isMissingOptionalTableError(error))return res.status(200).json({ok:true,offers:protectedOffers(),storageReady:false,activationReady:false});
    console.error("[r2b-specials] read failed",error?.message||"error");
    return res.status(503).json({ok:false,error:"Special-deal store unavailable."});
  }
 }
 if(!["POST","PATCH"].includes(req.method))return res.status(405).json({ok:false,error:"Method not allowed."});
 if(!authorised(req))return res.status(401).json({ok:false,error:"Admin authorisation required."});
 if(req.method==="PATCH"){
  if(process.env.RENT2BUY_MANUAL_SPECIAL_ACTIVATION_ENABLED!=="true")
    return res.status(503).json({ok:false,error:"Manual specials are not yet ready to activate."});
  const command=jsonBody(req)||{};
  const registration=reg(command.registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration)||protectedOffers().some(x=>x.registration===registration))
    return res.status(400).json({ok:false,error:"Invalid or protected registration."});
  if(!["activate","deactivate"].includes(command.action))
    return res.status(400).json({ok:false,error:"Choose activate or deactivate."});
  if(reg(command.confirmRegistration)!==registration)
    return res.status(400).json({ok:false,error:"Confirm the vehicle registration before changing a live deal."});
  try{
   const sb=getSupabaseServiceAdmin();
   const {data:record,error:readError}=await sb.from(table)
     .select("registration,monthly_ex_vat,initial_ex_vat,term_months,source_stock_id,enabled")
     .eq("registration",registration).maybeSingle();
   if(readError||!record)return res.status(409).json({ok:false,error:"Save a verified draft before activation."});
   if(command.action==="activate"){
     validateDraft({registration,monthlyExVat:record.monthly_ex_vat,initialExVat:record.initial_ex_vat,termMonths:record.term_months});
     const vehicle=await fetchDealerKitStockDetail(record.source_stock_id,{specifications:false});
     if(reg(vehicle.registration)!==registration||String(vehicle.supplierStockId)!==String(record.source_stock_id))
       return res.status(409).json({ok:false,error:"DealerKit vehicle identity changed."});
     const status=String(vehicle.status||vehicle.sourceStatus||"").trim().toLowerCase().replace(/[\\s-]+/g,"_");
     const maximum=rent2BuyMaximumTerm({registrationYear:vehicle.year,vehicleMileage:vehicle.mileage,milesPerMonth:1000});
     if(!["available","in_stock","due_in"].includes(status)||!maximum||Number(record.term_months)>maximum||
       !Number.isFinite(Number(vehicle.retailPrice))||Number(vehicle.retailPrice)<=0)
       return res.status(409).json({ok:false,error:"Vehicle is unavailable or this special term is not eligible."});
   }
   const enabled=command.action==="activate";
   const {error}=await sb.from(table).update({enabled,updated_at:new Date().toISOString()})
    .eq("registration",registration).eq("source_stock_id",record.source_stock_id);
   if(error)throw error;
   return res.status(200).json({ok:true,registration,enabled,
     message:enabled?"Special activated. Allow up to one minute for both websites to refresh.":"Special ended. Standard matrix will resume after caches refresh."});
  }catch(error){
   console.error("[r2b-specials] activation failed",error?.message||"error");
   return res.status(503).json({ok:false,error:"Special-deal status could not be verified or saved."});
  }
 }
 const input=jsonBody(req);
 if(!input)return res.status(400).json({ok:false,error:"Invalid input."});
 let deal;
 try{deal=validateDraft(input);}catch(error){return res.status(400).json({ok:false,error:error.message});}
 // A deal remains DRAFT. Publication is intentionally locked until both
 // websites and CRM have verified-price special-offer handoff enabled.
 if(input.enabled===true)return res.status(409).json({ok:false,error:"Publishing is locked until both websites and the CRM are ready. Save a draft instead."});
 try{
  const snapshot=await fetchDealerKitStockSnapshot({allowPartial:true});
  const matches=(snapshot.vehicles||[]).filter(v=>reg(v.registration)===deal.registration);
  if(matches.length!==1||!matches[0]?.supplierStockId)return res.status(409).json({ok:false,error:"Cannot verify this vehicle in current DealerKit stock."});
  const vehicle=await fetchDealerKitStockDetail(matches[0].supplierStockId,{specifications:false});
  if(reg(vehicle.registration)!==deal.registration||String(vehicle.supplierStockId)!==String(matches[0].supplierStockId))
   return res.status(409).json({ok:false,error:"Vehicle identity has changed in DealerKit."});
  const status=String(vehicle.status||vehicle.sourceStatus||"").toLowerCase().replace(/[\\s-]+/g,"_");
  if(!["available","in_stock","due_in"].includes(status))return res.status(409).json({ok:false,error:"Vehicle is not currently available."});
  const sb=getSupabaseServiceAdmin();
  const {data:previous,error:previousError}=await sb.from(table).select("enabled").eq("registration",deal.registration).maybeSingle();
  if(previousError)throw previousError;
  if(previous?.enabled)return res.status(409).json({ok:false,error:"End the currently active special before editing its terms."});
  const {data,error}=await sb.from(table).upsert({
    registration:deal.registration,monthly_ex_vat:deal.monthlyExVat,initial_ex_vat:deal.initialExVat,
    term_months:deal.termMonths,enabled:false,source_stock_id:String(vehicle.supplierStockId),
    updated_at:new Date().toISOString()
  },{onConflict:"registration"}).select().single();
  if(error)throw error;
  return res.status(200).json({ok:true,saved:true,published:false,registration:deal.registration,
    message:"Draft saved. No website prices or badges have changed."});
 }catch(error){
  console.error("[r2b-specials] save failed",error?.message||"error");
  return res.status(503).json({ok:false,error:"Special deal could not be saved. DealerKit or draft storage unavailable."});
 }
}
