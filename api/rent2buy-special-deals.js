import {timingSafeEqual} from "node:crypto";
import {getSupabaseServiceAdmin,isMissingOptionalTableError} from "./_vansco-cache-utils.js";
import {fetchDealerKitStockDetail,fetchDealerKitStockSnapshot} from "./_dealerkit-stock-adapter.js";
import {protectedOffers,reg,validateDraft,visibleOffers} from "../lib/rent2BuySpecialDealControl.mjs";
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
   return res.status(200).json({ok:true,offers:admin?[...protectedOffers(),...rows.filter(x=>!protectedOffers().some(p=>p.registration===reg(x.registration))).map(x=>({
      registration:reg(x.registration),monthlyExVat:Number(x.monthly_ex_vat),initialExVat:Number(x.initial_ex_vat),
      termMonths:Number(x.term_months),enabled:Boolean(x.enabled),protected:false,source:"manual_draft"
   }))]:list,storageReady:true});
  }catch(error){
    if(isMissingOptionalTableError(error))return res.status(200).json({ok:true,offers:protectedOffers(),storageReady:false});
    console.error("[r2b-specials] read failed",error?.message||"error");
    return res.status(503).json({ok:false,error:"Special-deal store unavailable."});
  }
 }
 if(req.method!=="POST")return res.status(405).json({ok:false,error:"Method not allowed."});
 if(!authorised(req))return res.status(401).json({ok:false,error:"Admin authorisation required."});
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
  const {data,error}=await getSupabaseServiceAdmin().from(table).upsert({
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
