import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";
import { makeVanscoUnsubscribeToken, renderVanscoEmail } from "../lib/vanscoEmailRender.js";
import { liveStock, normaliseSettings } from "./vansco-email-studio.js";

// Isolated MANUAL Vansco marketing workflow. Does not call the main CRM's email automation endpoints.
export const config = { maxDuration: 120 };
const CONTACTS = "marketing_vansco_email_contacts";
const CAMPAIGNS = "marketing_vansco_email_campaigns";
const SENDS = "marketing_vansco_email_sends";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fail(message, code=400) {const e=new Error(message);e.statusCode=code;throw e;}
function clean(v, max=400) {return String(v??"").trim().slice(0,max);}
function email(v) {return clean(v,254).toLowerCase();}
function validId(v) {return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(v,80));}
function checked(result, msg) {if(result.error)fail(msg+": "+clean(result.error.message,250),500);return result.data;}
function auth(request) {
  const a=Buffer.from(clean(request.headers?.["x-marketing-customer-database-key"],10000));
  const b=Buffer.from(clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY,10000));
  return Boolean(a.length&&a.length===b.length&&crypto.timingSafeEqual(a,b));
}
function db(){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)fail("Database not configured.",503);
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
}
function requireProvider() {
  if(!process.env.SENDGRID_API_KEY)fail("SendGrid isn't configured.",503);
  if(!process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET)fail("Unsubscribe secret isn't configured.",503);
}
async function campaign(supabase,id) {
  if(!validId(id))fail("Choose a saved Vansco campaign.");
  const row=checked(await supabase.from(CAMPAIGNS).select("*").eq("id",id).maybeSingle(),"Couldn't load saved Vansco campaign");
  if(!row||row.status!=="draft")fail("Campaign isn't an available Vansco draft.");
  return {...row,settings:normaliseSettings(row.settings||{})};
}
async function recipientEligible(supabase,contact) {
  if(contact.status!=="ready"||!contact.reviewed_at||!contact.permission_notes||contact.permission_notes.length<15)return false;
  const mail=email(contact.email_normalized);
  if(!EMAIL.test(mail))return false;
  const [identity,legacy]=await Promise.all([
    supabase.from("marketing_suppression_identities").select("id").eq("email_normalized",mail).limit(1),
    supabase.from("marketing_contacts").select("marketing_status,lifecycle_status,suppression").eq("email_normalized",mail).limit(1),
  ]);
  checked(identity,"Couldn't check shared global suppression");checked(legacy,"Couldn't check previous contact suppression");
  if(identity.data?.length)return false;
  for(const row of legacy.data||[]){
    if(row.marketing_status!=="active"||row.lifecycle_status==="suppressed")return false;
    const sup=row.suppression||{};
    for(const type of ["email_unsubscribed","email_bounced","manual_suppression","global_do_not_contact"]){
      if(sup[type]&&sup[type].active!==false)return false;
    }
  }
  return true;
}
async function verifiedVehicles(row) {
  const current=await liveStock(),available=new Map(current.map(v=>[v.key,v]));
  const chosen=Array.isArray(row.selected_vehicles)?row.selected_vehicles:[];
  if(!chosen.length||chosen.length>6)fail("Campaign must have 1–6 saved Vansco vans.");
  for(const item of chosen){
    const live=available.get(item.key);
    if(!live||live.url!==item.url||!live.image)fail("An advertised van is unavailable or has changed. Create a fresh campaign draft before sending.");
  }
  // Live images and mileage; preserve approved promotional prices and text.
  return chosen.map(item=>({...available.get(item.key),sale_prices:item.sale_prices||null}));
}
async function registerAttempt(supabase,{campaignId,contactId=null,to,type}){
  const row={campaign_id:campaignId,contact_id:contactId,email_normalized:to,send_type:type,status:"attempting"};
  const result=await supabase.from(SENDS).insert(row).select("*").single();
  if(result.error?.code==="23505")fail("This contact has already been queued or sent for this campaign. Duplicate blocked.",409);
  return checked(result,"Couldn't safely reserve Vansco email send");
}
async function dispatch(supabase,{send,campaignRow,vehicles,test=false}){
  const token=test?"":makeVanscoUnsubscribeToken({
    email:send.email_normalized,contactId:send.contact_id,sendId:send.id,
    secret:process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET,
  });
  const unsubscribeUrl=test?"":"https://marketing-crm-six.vercel.app/api/vansco-email-unsubscribe?token="+encodeURIComponent(token);
  const html=renderVanscoEmail({settings:campaignRow.settings,vehicles,unsubscribeUrl,testMode:test});
  try{
    const sent=await sendSendGridEmail({
      apiKey:process.env.SENDGRID_API_KEY,to:send.email_normalized,
      subject:(test?"[VANSCO TEST] ":"")+campaignRow.subject,
      html,text:campaignRow.settings.introduction||"Vansco used vans and offers",
      fromEmail:"sales@vanfinancecompany.co.uk",fromName:"Vansco",
      categories:["vansco-email-studio",test?"internal-test":"marketing"],
      customArgs:{vansco_email_send_id:send.id,vansco_email_campaign_id:campaignRow.id,vansco_brand:"vansco"},
      ...(test?{}:{headers:{"List-Unsubscribe":"<"+unsubscribeUrl+">"}}),
      timeoutMs:12000,
    });
    checked(await supabase.from(SENDS).update({
      status:"accepted",provider_message_id:sent.messageId,updated_at:new Date().toISOString(),
    }).eq("id",send.id),"Provider accepted Vansco email but tracking couldn't be updated");
    return {accepted:true,send_id:send.id};
  }catch(error){
    const unknown=Boolean(error.ambiguous)||/tracking couldn't be updated/i.test(error.message||"");
    // Never retry a claimed send automatically: the provider may already have it.
    const status=unknown?"submission_unknown":"failed";
    const result=await supabase.from(SENDS).update({status,failure_reason:clean(error.message,500),updated_at:new Date().toISOString()}).eq("id",send.id).eq("status","attempting");
    if(result.error)console.error("VANSCO EMAIL TRACKING UPDATE FAILURE",result.error.message);
    return {accepted:false,send_id:send.id,status,error:clean(error.message,160)};
  }
}
async function listContacts(supabase,body={}){
  let query=supabase.from(CONTACTS).select("id,email_normalized,first_name,last_name,status,source,marketing_basis,reviewed_at,permission_notes").order("created_at",{ascending:false}).limit(80);
  const term=clean(body.query,60).replace(/[%_,()\\]/g,"");
  if(term)query=query.ilike("email_normalized","%"+term+"%");
  const rows=checked(await query,"Couldn't list Vansco contacts");
  return {contacts:rows||[]};
}
async function reviewContact(supabase,body){
  const id=clean(body.contact_id,80),notes=clean(body.permission_notes,700);
  if(!validId(id)||notes.length<15||body.confirm_phrase!=="REVIEWED FOR VANSCO")fail('Review a single contact, explain its marketing basis and type "REVIEWED FOR VANSCO".');
  const contact=checked(await supabase.from(CONTACTS).select("*").eq("id",id).maybeSingle(),"Couldn't read contact");
  if(!contact||contact.status!=="pending_review")fail("Only pending Vansco contacts can be reviewed.");
  // This only changes the brand-specific record, never the shared customer database.
  const active=await recipientEligible(supabase,{...contact,status:"ready",reviewed_at:new Date().toISOString(),permission_notes:notes});
  if(!active)fail("Existing suppression or invalid email blocks this address.",409);
  const updated=checked(await supabase.from(CONTACTS).update({status:"ready",reviewed_at:new Date().toISOString(),permission_notes:notes,updated_at:new Date().toISOString()}).eq("id",id).eq("status","pending_review").select("id").single(),"Couldn't approve this Vansco contact");
  return {reviewed:true,id:updated.id};
}
export function isPermittedVanscoTestDestination(address,{configured = ""} = {}) {
  const to=email(address);
  if(!EMAIL.test(to))return false;
  if(to==="sales@vanfinancecompany.co.uk"||to.endsWith("@vansco.co.uk")||(configured&&to===email(configured)))return true;
  // Test messages are single-recipient, sent manually by an authenticated Marketing CRM operator.
  return /@(gmail\.com|googlemail\.com)$/.test(to);
}
async function checkVanscoTestRateLimit(supabase) {
  // Guard against accidental loops / stolen API keys without hindering daily design testing.
  // The previous 3-per-recipient / 20-total limits were too restrictive.
  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const total=supabase.from(SENDS).select("id",{count:"exact",head:true})
    .eq("send_type","test").gte("created_at",since);
  const result=await total;
  checked(result,"Couldn't check test-email safety limit");
  if((result.count||0)>=100)fail("The email studio has reached its safety limit of 100 internal test sends in 24 hours.",429);
}
async function testSend(supabase,body){
  requireProvider();
  const to=email(body.to);
  const configured=email(process.env.SENDGRID_TEST_RECIPIENT_EMAIL||"");
  if(!isPermittedVanscoTestDestination(to,{configured})) {
    fail("Internal tests can only go to Vansco/VFC staff addresses, an authorised configured test address, or Gmail.");
  }
  await checkVanscoTestRateLimit(supabase);
  const row=await campaign(supabase,body.campaign_id);
  const vehicles=await verifiedVehicles(row);
  const send=await registerAttempt(supabase,{campaignId:row.id,to,type:"test"});
  const result=await dispatch(supabase,{send,campaignRow:row,vehicles,test:true});
  return {result,warning:"Accepted means SendGrid received the email, not proof of inbox delivery."};
}
async function productionBatch(supabase,body){
  if(process.env.VANSCO_EMAIL_PRODUCTION_ENABLED!=="true")fail("Customer sends are locked until an approved production launch.",403);
  requireProvider();
  const ids=body.contact_ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!validId(id)))fail("Select 1–5 distinct approved Vansco contacts.");
  if(body.confirm_phrase!=="SEND "+ids.length)fail('Type "SEND '+ids.length+'" to confirm this customer batch.');
  const row=await campaign(supabase,body.campaign_id);
  const vehicles=await verifiedVehicles(row);
  const contacts=checked(await supabase.from(CONTACTS).select("*").in("id",ids).eq("status","ready"),"Couldn't check reviewed Vansco customers");
  if(contacts.length!==ids.length)fail("Some selected contacts are not approved.",409);
  for(const c of contacts)if(!await recipientEligible(supabase,c))fail("A selected address is no longer marketing-eligible. Batch stopped.",409);
  let accepted=0,unknown=0,failed=0;
  for(const contact of contacts){
    // Verify suppression again immediately before claiming each send.
    if(!await recipientEligible(supabase,contact)){failed++;continue;}
    const send=await registerAttempt(supabase,{campaignId:row.id,contactId:contact.id,to:contact.email_normalized,type:"production"});
    const result=await dispatch(supabase,{send,campaignRow:row,vehicles});
    if(result.accepted)accepted++;else if(result.status==="submission_unknown")unknown++;else failed++;
  }
  return {accepted,unknown,failed,count:contacts.length,note:"Manual only; no automatic retries. Check provider before acting on unknown outcomes."};
}
async function reporting(supabase,body={}){
  let query=supabase.from(SENDS).select("id,campaign_id,send_type,email_normalized,status,created_at,delivered_at,opened_at,clicked_at").order("created_at",{ascending:false}).limit(2000);
  if(body.campaign_id&&validId(body.campaign_id))query=query.eq("campaign_id",body.campaign_id);
  const rows=checked(await query,"Couldn't load Vansco email results");
  const production=rows.filter(r=>r.send_type==="production"),tests=rows.filter(r=>r.send_type==="test");
  return {
    tests:tests.length,
    submitted:production.filter(r=>!["failed"].includes(r.status)).length,
    delivered:production.filter(r=>Boolean(r.delivered_at)).length,
    opened:production.filter(r=>Boolean(r.opened_at)).length,
    clicked:production.filter(r=>Boolean(r.clicked_at)).length,
    bounced:production.filter(r=>r.status==="bounced").length,
    unsubscribed:production.filter(r=>r.status==="unsubscribed").length,
    unknown:production.filter(r=>r.status==="submission_unknown").length,
    recent:rows.slice(0,15).map(r=>({email:r.email_normalized,type:r.send_type,status:r.status,at:r.created_at})),
    limited_to_latest:2000,
    production_enabled:process.env.VANSCO_EMAIL_PRODUCTION_ENABLED==="true",
  };
}
export default async function handler(request,response){
  response.setHeader("Cache-Control","no-store");
  if(request.method!=="POST")return response.status(405).json({ok:false,message:"Method not allowed."});
  if(!auth(request))return response.status(401).json({ok:false,message:"Access denied."});
  try{
    const body=typeof request.body==="string"?JSON.parse(request.body):(request.body||{});
    const supabase=db();
    let result;
    if(body.action==="contacts")result=await listContacts(supabase,body);
    else if(body.action==="reviewContact")result=await reviewContact(supabase,body);
    else if(body.action==="testSend")result=await testSend(supabase,body);
    else if(body.action==="sendBatch")result=await productionBatch(supabase,body);
    else if(body.action==="report")result=await reporting(supabase,body);
    else fail("Unsupported Vansco email action.");
    return response.status(200).json({ok:true,...result});
  }catch(error){
    console.error("[Vansco email delivery]",clean(error.message,170));
    return response.status(error.statusCode||500).json({ok:false,message:clean(error.message,340)});
  }
}
