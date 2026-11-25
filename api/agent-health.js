import {createClient} from "@supabase/supabase-js";
import {timingSafeEqual} from "node:crypto";
import coreHealth from "./system-health.js";
import {readRenewalMonitoring} from "./rent2buy-group-renewals.js";
import {buildMonitorIssues,isMonitorTestEvent,withoutFacebookSessions} from "../lib/conversationsMonitor.js";
import {WORKERS,workerHealth,normaliseExisting,healthCounts} from "../lib/crmHealthRegistry.js";

const AUTH="x-marketing-customer-database-key";
function authorised(req,env){
 const a=Buffer.from(String(req.headers?.[AUTH]||"")),b=Buffer.from(String(env.MARKETING_CUSTOMER_DATABASE_API_KEY||""));
 return b.length>0&&a.length===b.length&&timingSafeEqual(a,b);
}
function item(key,label,category,state,detail,extra={}){return {key,label,category,state,detail,...extra};}
async function data(query){const result=await query;if(result.error)throw result.error;return result.data;}
function severity(issues){return issues.some(x=>x.severity==="critical")?"critical":issues.some(x=>x.severity==="warning")?"warning":"healthy";}
const describe=issues=>issues.map(x=>x.title).join(" · ");
function probe(key,label,category,task){return Promise.resolve().then(task).catch(()=>[item(key,label,category,"unverified","Telemetry unavailable; check this source directly.")]);}
export async function collectAgentHealth(db,{now=new Date(),environment=process.env,collectCore=async()=>coreHealth({method:"GET"},{setHeader(){},status(){return this;},json(body){return body;}})}={}){
 const ms=now.getTime(),since=new Date(ms-24*3600000).toISOString();
 const sources=await Promise.all([
  probe("core","Core services","Services",async()=>{
   const core=await collectCore();
   if(!Array.isArray(core?.automations))throw Error("Missing core data");
   const rows=core.automations.filter(x=>x.key!=="vansco_stock_refresh").map(normaliseExisting);
   for(const [key,label] of [["supabase","Supabase connection"],["reel_duplicate_protection","Reel duplicate protection"],["email_delivery","Email delivery"]]){
    rows.push(item(key,label,"Services",core.checks?.[key]===true?"healthy":core.checks?.[key]===false?"critical":"unverified","Existing core service check.",{lastAt:core.checked_at}));
   }
   for(const x of core.issues||[])rows.push(item("core-issue:"+x.key,x.label,"Current incidents","critical",x.message,{lastAt:core.checked_at}));
   for(const x of core.degraded||[])rows.push(item("degraded:"+x.key,x.key,"Current incidents","warning",x.reason,{lastAt:core.checked_at}));
   return rows;
  }),
  probe("worker-telemetry","Scheduled worker telemetry","Scheduled workers",async()=>{
   const rows=await data(db.from("crm_worker_health").select("worker_key,started_at,completed_at,outcome,http_status,detail,last_success_at"));
   const map=new Map((rows||[]).map(x=>[x.worker_key,x]));
   return WORKERS.map(w=>workerHealth(w,map.get(w.key),now));
  }),
  probe("stock-monitor","DealerKit stock monitor","Agents",async()=>{
   const run=await data(db.from("stock_watch_monitor_runs").select("started_at,completed_at,status,health,issue_count,warning_count,critical_count").order("started_at",{ascending:false}).limit(1).maybeSingle());
   if(!run)return [item("stock-monitor","DealerKit stock monitor","Agents","unverified","No monitor run recorded.")];
   const age=ms-Date.parse(run.started_at);
   const state=age>45*60000||run.health==="critical"||run.status==="failed"?"critical":run.health==="warning"||run.warning_count>0?"warning":run.status==="running"?"running":run.status==="complete"&&run.health==="healthy"?"healthy":"unverified";
   const issues=await data(db.from("stock_watch_monitor_issues").select("title,severity").eq("status","open").limit(10));
   return [item("stock-monitor","DealerKit stock monitor","Agents",state,(age>45*60000?"Monitor run overdue. ":"")+String(run.issue_count||0)+" issues. "+(issues||[]).map(x=>x.title).join(" · "),{lastAt:run.completed_at||run.started_at,href:"/vansco-stock-watch",source:"Stock monitor run log"})];
  }),
  probe("renewals","Rent2Buy Group Renewal Agent","Agents",async()=>{
   const r=await readRenewalMonitoring(db,now,environment);
   const state=({disabled:"disabled",paused:"disabled",healthy:"healthy",processing:"running",waiting:"unverified",restricted:"critical",missed_run:"critical",disconnected:"critical",stalled:"critical",publication_failures:"critical"})[r.health]||"unverified";
   return [item("renewals","Rent2Buy Group Renewal Agent","Agents",state,describe(r.issues||[])||"Agent state: "+r.health,{lastAt:r.lastHeartbeatAt,href:"/conversations-ai",source:"Renewal heartbeat and queue monitor"})];
  }),
  probe("conversation-source","Marketplace and Ask Me","Agents",async()=>{
   const [fb,events,sessions]=await Promise.all([
    data(db.from("conversation_channel_status").select("last_heartbeat_at,status").eq("channel","facebook_marketplace").maybeSingle()),
    data(db.from("conversation_events").select("source_id,channel,kind,occurred_at,product,reason,question_excerpt").gte("occurred_at",since).order("occurred_at",{ascending:false}).limit(2000)),
    data(db.from("ai_customer_sessions").select("product_lock,conversation_history,last_activity_at").gte("last_activity_at",since).order("last_activity_at",{ascending:false}).limit(300))
   ]);
   const actual=(events||[]).filter(e=>!isMonitorTestEvent(e));
   const issues=buildMonitorIssues({facebook:fb,events:actual,now});
   const fbi=issues.filter(x=>x.channel==="facebook_marketplace");
   const fbState=fbi.length?severity(fbi):fb?.status?.monitoring&&fb?.status?.mode==="auto"?"healthy":"unverified";
   const answered=actual.filter(e=>e.channel==="facebook_marketplace"&&e.kind==="answered");
   const rows=[item("marketplace-replies","Marketplace automatic replies","Agents",fbState,describe(fbi)||"Browser and service reporting; "+answered.length+" confirmed replies in 24 hours.",{lastAt:fb?.last_heartbeat_at,href:"/conversations-ai",source:"Browser heartbeat and delivery receipts"})];
   const web=withoutFacebookSessions(sessions||[],actual.filter(e=>e.channel==="facebook_marketplace"));
   const aiIssues=issues.filter(x=>x.channel==="ask_me");
   for(const [product,label] of [["finance","Ask Me · Van Finance"],["rent2buy","Ask Me · Rent2Buy"]]){
    const recent=web.filter(s=>s.product_lock===product&&Array.isArray(s.conversation_history)&&s.conversation_history.some(m=>m.role==="assistant"));
    rows.push(item("ask-me:"+product,label,"Agents",aiIssues.length?severity(aiIssues):recent.length?"healthy":"idle",describe(aiIssues)||recent.length+" sessions with a recorded answer in 24 hours. No live synthetic test.",{lastAt:recent[0]?.last_activity_at,href:"/conversations-ai",source:"Recorded session replies"}));
   }
   return rows;
  }),
  probe("incidents","Recorded agent incidents","Current incidents",async()=>{
   const rows=await data(db.from("conversation_monitor_alerts").select("fingerprint,channel,severity,title,first_seen_at,last_seen_at").eq("status","open").limit(100));
   return (rows||[]).filter(x=>x.severity!=="info").map(x=>item("incident:"+x.fingerprint,x.title,"Current incidents",x.severity==="critical"?"critical":"warning","Open monitor incident.",{lastAt:x.last_seen_at,href:"/conversations-ai"}));
  })
 ]);
 const rows=sources.flat();
 if(!rows.some(x=>x.category==="Scheduled workers"&&x.key.startsWith("/api/")))rows.push(...WORKERS.map(w=>workerHealth(w,null,now)));
 rows.push(item("stock-reconciliation","Stock reconciliation","Agents","manual","Read-only analysis on request; not an unattended worker.",{href:"/vansco-stock-watch"}));
 return {checkedAt:now.toISOString(),items:rows,counts:healthCounts(rows)};
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 if(!authorised(req,process.env))return res.status(401).json({error:"Unlock the CRM to view agent health"});
 try{
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  return res.status(200).json(await collectAgentHealth(db));
 }catch{return res.status(503).json({error:"Agent health temporarily unavailable"});}
}
