import { createClient } from "@supabase/supabase-js";
import { checkVanscoUnsubscribeToken } from "../lib/vanscoEmailRender.js";

const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function page(response,code,body) {
 response.status(code).setHeader("Content-Type","text/html; charset=utf-8");
 response.send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vansco unsubscribe</title><body style="font:16px/1.5 Arial,sans-serif;max-width:540px;margin:10vh auto;padding:22px"><h1>Vansco email preferences</h1>'+body+'</body></html>');
}
function tokenFromPost(req){
 const body=typeof req.body==="string"?req.body:undefined;
 return String(req.body?.token||new URLSearchParams(body||"").get("token")||"");
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(req.method))return page(res,405,"Method not allowed.");
 try{
  const token=req.method==="GET"?String(req.query?.token||""):tokenFromPost(req);
  const info=checkVanscoUnsubscribeToken(token,process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET);
  if(req.method==="GET")return page(res,200,'<p>Stop receiving marketing emails from Vansco at '+esc(info.email)+'?</p><form method="POST"><input name="token" type="hidden" value="'+esc(token)+'"><button style="background:#1e1e1e;color:white;border:0;padding:13px 18px;font-weight:bold" type="submit">Unsubscribe</button></form>');
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error("Email preference service unavailable.");
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const row=await db.from("marketing_vansco_email_contacts").select("id,email_normalized").eq("id",info.contact_id).maybeSingle();
  if(row.error)throw row.error;
  if(!row.data||row.data.email_normalized!==info.email)throw Error("Unsubscribe contact could not be verified.");
  const updated=await db.from("marketing_vansco_email_contacts").update({status:"suppressed",suppression_reason:"Confirmed Vansco unsubscribe",updated_at:new Date().toISOString()}).eq("id",info.contact_id);
  if(updated.error)throw updated.error;
  const existing=await db.from("marketing_suppression_identities").select("id").eq("email_normalized",info.email).limit(1);
  if(existing.error)throw existing.error;
  if(!existing.data.length){
   const inserted=await db.from("marketing_suppression_identities").insert({
    email_normalized:info.email,suppression_type:"email_unsubscribed",reason:"Confirmed Vansco marketing unsubscribe",
    provider:"Vansco email studio",suppressed_at:new Date().toISOString(),metadata:{vansco_send_id:info.send_id},
   });
   if(inserted.error&&inserted.error.code!=="23505")throw inserted.error;
  }
  await db.from("marketing_vansco_email_sends").update({status:"unsubscribed",last_event_at:new Date().toISOString()}).eq("id",info.send_id).eq("contact_id",info.contact_id);
  return page(res,200,"<p>You have been unsubscribed from future Vansco marketing emails.</p>");
 }catch(error){return page(res,400,"<p>We couldn't process that link. Please contact Vansco to request removal from marketing messages.</p>")}
}
