import React,{useCallback,useEffect,useRef,useState} from "react";
import {getFacebookHelperStatus} from "../services/facebookGroupsAgent.js";
import {MARKETING_ACCESS_STORAGE_KEY,MARKETING_ACCESS_HEADER} from "../services/marketingAccess.js";
import {approvalMonitorHealth,healthCounts} from "../lib/crmHealthRegistry.js";
import "../styles/global-agent-health.css";
const LABEL={critical:"Issue",warning:"Attention",unverified:"Unverified",healthy:"Healthy",running:"Running",idle:"Idle",disabled:"Disabled",manual:"On demand"};
const ORDER={critical:0,warning:1,unverified:2,running:3,healthy:4,idle:5,disabled:6,manual:7};
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString("en-GB",{timeZone:"Europe/London",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"Not recorded";
function accessKey(){try{return localStorage.getItem(MARKETING_ACCESS_STORAGE_KEY)||sessionStorage.getItem(MARKETING_ACCESS_STORAGE_KEY)||"";}catch{return "";}}
function Row({item}){
 return <article className="gah-row"><div className="gah-row-head"><strong>{item.label}</strong><span className={"gah-status gah-"+item.state}>{LABEL[item.state]||"Unverified"}</span></div><p>{item.detail}</p><div className="gah-meta">{item.source||item.schedule||item.category}{item.lastAt?" · "+time(item.lastAt):""}{item.href?<a href={item.href}>Open</a>:null}</div></article>;
}
export default function AutomationHealthCentre(){
 const [open,setOpen]=useState(false),[showAll,setShowAll]=useState(false),[payload,setPayload]=useState(null),[helper,setHelper]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[copied,setCopied]=useState(""),[tick,setTick]=useState(Date.now());
 const running=useRef(false),last=useRef(0),mounted=useRef(true);
 const refresh=useCallback(async()=>{
  if(running.current)return;
  running.current=true;setBusy(true);
  try{
   const key=accessKey();
   const browserTask=getFacebookHelperStatus(3000).catch(()=>({connected:false}));
   const cloudTask=key?fetch("/api/agent-health",{cache:"no-store",headers:{[MARKETING_ACCESS_HEADER]:key},signal:AbortSignal.timeout(40000)}).then(async res=>{if(!res.ok)throw Error(res.status===401?"Unlock the CRM to view cloud health.":"Cloud monitoring could not be refreshed.");return res.json();}):Promise.reject(Error("Unlock the CRM to view cloud health."));
   const [browser,cloud]=await Promise.allSettled([browserTask,cloudTask]);
   if(!mounted.current)return;
   setHelper(browser.status==="fulfilled"?browser.value:{connected:false});
   if(cloud.status==="fulfilled"&&Array.isArray(cloud.value.items)){setPayload(cloud.value);setError("");}
   else setError(cloud.reason?.message||"Cloud monitoring could not be refreshed.");
   setTick(Date.now());last.current=Date.now();
  }finally{running.current=false;if(mounted.current)setBusy(false);}
 },[]);
 useEffect(()=>{
  mounted.current=true;refresh();
  const interval=setInterval(refresh,5*60000),clock=setInterval(()=>setTick(Date.now()),60000);
  const resume=()=>{if(!document.hidden&&Date.now()-last.current>60000)refresh();};
  const keydown=e=>{if(e.key==="Escape")setOpen(false);};
  document.addEventListener("visibilitychange",resume);window.addEventListener("focus",resume);window.addEventListener("keydown",keydown);
  return()=>{mounted.current=false;clearInterval(interval);clearInterval(clock);document.removeEventListener("visibilitychange",resume);window.removeEventListener("focus",resume);window.removeEventListener("keydown",keydown);};
 },[refresh]);
 const local=[
  {key:"groups-extension",label:"VFC Facebook Helper",category:"Browser extensions",state:helper?.connected?"healthy":"idle",detail:helper?.connected?"Version "+helper.version+" is connected in this browser. The approval and renewal rows report execution outcomes.":"No helper connected in this window. Check the configured Edge profile if this is the renewal browser.",source:"Local extension connection"},
  {key:"finance-autofill",label:"Finance lender autofill",category:"Browser extensions",state:"manual",detail:"On-demand extension used in Main CRM and lender portals. No Marketing CRM heartbeat is available.",source:"External extension"}
 ];
 const stale=!payload||!!error||tick-Date.parse(payload.checkedAt)>12*60000;
 const items=[...(payload?.items||[]).map(x=>stale?{...x,state:["critical","warning","disabled","manual"].includes(x.state)?x.state:"unverified",detail:"Last recorded: "+x.detail}:x),...local];
 if(!items.some(x=>x.key==="group-approval-monitor")&&helper?.connected)items.push(approvalMonitorHealth(helper.approvalMonitor,new Date(tick)));
 if(stale)items.unshift({key:"cloud",label:"Cloud monitoring",category:"Current incidents",state:error&&payload?"warning":"unverified",detail:error||"Waiting for current cloud evidence."});
 const counts=healthCounts(items),attention=items.filter(x=>["critical","warning","unverified"].includes(x.state));
 const shown=(showAll?items:attention).slice().sort((a,b)=>(ORDER[a.state]??9)-(ORDER[b.state]??9));
 const title=counts.critical?counts.critical+" issues":counts.warning?counts.warning+" warnings":counts.unverified?"Checks incomplete":"Systems healthy";
 const copy=async()=>{
  const report=["Marketing CRM · Agent health","Checked (UK): "+time(payload?.checkedAt),"Status: "+title,...attention.map(x=>LABEL[x.state]+" | "+x.label+" | "+x.detail+" | "+time(x.lastAt))].join("\n");
  try{await navigator.clipboard.writeText(report);setCopied("Copied");}catch{setCopied(report);}
 };
 return <aside className="gah" aria-label="Global CRM health">
  {open?<section className="gah-panel" aria-label="CRM health details">
   <header className="gah-header"><div><small>LIVE OPERATIONS</small><h2>Agent health centre</h2><p>All pages · shared CRM monitoring</p></div><button className="gah-min" onClick={()=>setOpen(false)} aria-label="Minimise health centre">−</button></header>
   <div className="gah-summary"><div><strong>{counts.total}</strong><span>Checks</span></div><div><strong>{counts.healthy+counts.running}</strong><span>Healthy / running</span></div><div><strong>{counts.critical+counts.warning}</strong><span>Attention</span></div><div><strong>{counts.unverified}</strong><span>Unverified</span></div></div>
   <div className="gah-toolbar"><div className="gah-tabs"><button aria-pressed={!showAll} onClick={()=>setShowAll(false)}>Attention</button><button aria-pressed={showAll} onClick={()=>setShowAll(true)}>All checks</button></div><button onClick={refresh} disabled={busy}>{busy?"Checking…":"Refresh"}</button></div>
   <div className="gah-list">{shown.length?shown.map(x=><Row key={x.key} item={x}/>):<p className="gah-empty">No current issues in the available evidence.</p>}</div>
   <footer className="gah-footer"><span>Checked {time(payload?.checkedAt)} UK</span><button onClick={copy}>Copy diagnostic report</button>{copied==="Copied"?<small role="status">Copied</small>:copied?<textarea readOnly value={copied} aria-label="Diagnostic report"/>:null}</footer>
  </section>:null}
  <button className={"gah-launch gah-"+counts.level} type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span className="gah-dot"/><span>CRM health</span><strong>{title}</strong><span>{open?"−":"+"}</span></button>
 </aside>;
}
