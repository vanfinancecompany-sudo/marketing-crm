import {createClient} from "@supabase/supabase-js";
import {timingSafeEqual} from "node:crypto";
export function isMonitoredCron(req,env=process.env){
 if(env.VERCEL_ENV!=="production"||req.method!=="GET"||!env.CRON_SECRET)return false;
 const a=Buffer.from(String(req.headers?.authorization||"")),b=Buffer.from("Bearer "+env.CRON_SECRET);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function classifyReceipt(key,status,payload,env=process.env){
 let b=payload;
 if ((typeof b==="string"||Buffer.isBuffer(b)) && b.length<=256_000) { try { b=JSON.parse(String(b)); } catch { b=null; } }
 b=b&&typeof b==="object"&&!Buffer.isBuffer(b)?b:{};
 const state=String(b.state||b.status||"").toLowerCase();
 if(b.disabled===true||b.enabled===false||b.dormant===true||["disabled","paused","dormant"].includes(state)||(key==="/api/application-received-event-retry"&&env.CRM_EMAIL_EVENT_RETRY_ENABLED!=="true"&&status===503))
  return {outcome:"disabled",detail:"Worker reported disabled or paused."};
 if(status>=400||b.success===false||["failed","error"].includes(state)||b.ok===false&&status!==207&&status!==202)
  return {outcome:"failed",detail:"Scheduled execution failed (HTTP "+status+")."};
 if(key==="/api/rent2buy-monthly-price-sync"){
  if(b.skipped===true)return {outcome:"warning",detail:"Rent2Buy price sync skipped its Wix read. Check the VAN FINANCE Wix configuration."};
  const scanned=Number(b.scanned),updated=Number(b.updated),needed=Number(b.changes_needed);
  if(Number.isFinite(scanned)&&Number.isFinite(updated)&&Number.isFinite(needed)){
   if(status===207||updated<needed||b.failures?.length)return {outcome:"warning",detail:`Wix updated ${updated} of ${needed} required prices. Check the price-sync worker log.`};
   if(!scanned)return {outcome:"warning",detail:"Wix returned zero Rent2Buy rows. Check the stock collection before treating prices as current."};
   return {outcome:needed?"success":"idle",detail:`Wix verified ${scanned} stock rows; ${updated} numeric prices updated.`};
  }
 }
 if(key==="/api/marketing-template-campaign-send-orphan-worker"&&Array.isArray(b.results)){
  const held=b.results.filter(result=>result.action==="attention").length;
  if(held)return {outcome:"warning",detail:`${held} stranded campaign queues need reconciliation before retry. Open Campaigns and review provider outcomes.`};
  const repaired=b.results.filter(result=>result.changed===true).length;
  return {outcome:repaired?"success":"idle",detail:`Inspected ${Number(b.inspected)||0} stranded campaign queues; ${repaired} safely recovered.`};
 }
 if(key==="/api/buffer-instagram-mirror"&&status===202)return {outcome:"warning",detail:"Instagram mirror was deferred. Check the Buffer integration and the next publication receipt."};
 if(status===207||status===202||b.deferred===true||Number(b.errors)>0||Number(b.failed)>0||Number(b.jobs_failed)>0||b.errors?.length||b.failures?.length||["partial","deferred","completed_with_errors"].includes(state))
  return {outcome:"warning",detail:"Partial or deferred execution (HTTP "+status+")."};
 if(b.skipped===true||b.alreadyChecked===true||["idle","skipped","no_work"].includes(state))
  return {outcome:"idle",detail:"Execution completed; no work required."};
 return {outcome:"success",detail:"Scheduled execution returned HTTP "+status+". Delivery outcomes are checked separately."};
}
async function saveReceipt(receipt,env){
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return;
 const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await db.rpc("record_crm_worker_health",receipt).abortSignal(AbortSignal.timeout(1500));
 if(error)throw error;
}
// Production cron only. Never store payload data. Fail open if monitoring is unavailable.
export function withCronHealth(key,handler,{environment=process.env,record=saveReceipt,clock=()=>new Date()}={}){
 return async function monitoredCron(req,res){
  if(!isMonitoredCron(req,environment))return handler(req,res);
  const started=clock().toISOString();
  const originals=new Map();let completion;
  const restore=()=>{for(const [method,original] of originals)res[method]=original;};
  const write=async(status,body)=>{
   try{const result=classifyReceipt(key,status,body,environment);
    await record({p_worker_key:key,p_started_at:started,p_completed_at:clock().toISOString(),p_outcome:result.outcome,p_http_status:status,p_detail:result.detail},environment);
   }catch{/* The worker must still respond. */}
  };
  for(const method of ["json","send","end"]){
   if(typeof res[method]!=="function")continue;
   const original=res[method];originals.set(method,original);
   res[method]=function(...args){
    restore();const status=Number(res.statusCode)||200;
    completion=(async()=>{await write(status,args[0]);return original.apply(res,args);})();
    return res;
   };
  }
  try{const result=await handler(req,res);if(completion)return await completion;return result;}
  catch(error){if(!completion)await write(500,{ok:false});else await completion;throw error;}
  finally{restore();}
 };
}
