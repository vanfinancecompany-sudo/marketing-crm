import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { processBatch } from "./vansco-email-delivery.js";

export const config = { maxDuration: 300 };
const BATCH_TABLE = "marketing_vansco_email_batches";
const SENDS_TABLE = "marketing_vansco_email_sends";

function cronAuthorised(request){
 const configured=process.env.CRON_SECRET||"";
 const bearer=String(request.headers?.authorization||"");
 const expected="Bearer "+configured;
 const a=Buffer.from(bearer),b=Buffer.from(expected);
 return Boolean(configured&&a.length===b.length&&crypto.timingSafeEqual(a,b));
}
function supabase(){
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error("Database credentials are missing.");
 return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
}
function checked(result){
 if(result.error)throw Error(result.error.message||"Vansco worker database request failed.");
 return result.data;
}
export default async function handler(request,response){
 response.setHeader("Cache-Control","no-store");
 if(request.method!=="GET")return response.status(405).json({ok:false});
 if(!cronAuthorised(request))return response.status(401).json({ok:false});
 // A missing production flag must NEVER enable customer sends.
 if(process.env.VANSCO_EMAIL_PRODUCTION_ENABLED!=="true")
   return response.status(200).json({ok:true,disabled:true,processed:0});
 try{
  const client=supabase();
  const active=checked(await client.from(BATCH_TABLE)
   .select("id,status").in("status",["queued","sending"])
   .order("created_at",{ascending:true}).limit(1));
  if(!active?.length)return response.status(200).json({ok:true,processed:0,idle:true});
  const batchId=active[0].id;
  // A crashed invocation can leave a submission uncertain. Never retry it.
  // The conservative quarantine applies even if the provider request did not begin.
  const staleBefore=new Date(Date.now()-10*60*1000).toISOString();
  const stale=checked(await client.from(SENDS_TABLE).select("id")
    .eq("batch_id",batchId).eq("send_type","production")
    .eq("status","attempting").lt("updated_at",staleBefore).limit(100));
  for(const row of stale||[]){
   checked(await client.from(SENDS_TABLE).update({
     status:"submission_unknown",
     failure_reason:"Worker interrupted during a claimed send. Reconcile against SendGrid before any manual action.",
     updated_at:new Date().toISOString()
   }).eq("id",row.id).eq("status","attempting"));
  }
  const result=await processBatch(client,{batch_id:batchId});
  return response.status(200).json({ok:true,batch_id:batchId,
    processed:Object.values(result.step||{}).reduce((a,n)=>a+Number(n||0),0),
    quarantined:stale?.length||0,progress:result.batch});
 }catch(err){
  console.error("[Vansco queued email worker]",String(err.message||err).slice(0,250));
  return response.status(500).json({ok:false,message:"Vansco worker failed safely. Check server logs and durable batch progress."});
 }
}
