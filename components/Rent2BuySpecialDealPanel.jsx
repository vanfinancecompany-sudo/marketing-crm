import {useEffect,useState} from "react";
import {incVat,protectedOffers,reg,validateDraft} from "../lib/rent2BuySpecialDealControl.mjs";
import {getStoredMarketingAccessKey,MARKETING_ACCESS_HEADER} from "../services/marketingAccess.js";
const pounds=v=>Number(v).toLocaleString("en-GB",{style:"currency",currency:"GBP"});
export default function Rent2BuySpecialDealPanel({selectedRegistration=""}){
 const [offers,setOffers]=useState(protectedOffers());
 const [registration,setRegistration]=useState("");
 const [monthly,setMonthly]=useState("");
 const [initial,setInitial]=useState("");
 const [term,setTerm]=useState("36");

 const [status,setStatus]=useState("");
 const [busy,setBusy]=useState(false);
 const [storageReady,setStorageReady]=useState(null);
 const [activationReady,setActivationReady]=useState(false);
 useEffect(()=>{let mounted=true;const k=getStoredMarketingAccessKey();fetch("/api/rent2buy-special-deals"+(k?"?admin=1":""),{cache:"no-store",headers:k?{[MARKETING_ACCESS_HEADER]:k}:{}}).then(r=>r.json()).then(x=>{
  if(mounted&&x.ok){setOffers(x.offers);setStorageReady(x.storageReady);setActivationReady(x.activationReady===true);}
 }).catch(()=>{if(mounted)setStatus("Cannot load saved specials. Four protected deals remain selected.");});
 return ()=>{mounted=false};},[]);
 useEffect(()=>{if(selectedRegistration){setRegistration(reg(selectedRegistration));setStatus("");}},[selectedRegistration]);
 useEffect(()=>{const stored=offers.find(x=>reg(x.registration)===reg(registration)&&!x.protected);if(stored){setMonthly(String(stored.monthlyExVat));setInitial(String(stored.initialExVat));setTerm(String(stored.termMonths));}},[registration,offers]);
 const active=new Set(offers.filter(x=>x.enabled).map(x=>reg(x.registration)));

 const current=offers.find(x=>reg(x.registration)===reg(registration));
 const locked=Boolean(current?.protected);
 const savedDraft=Boolean(current&&!current.protected);
 const manuallyActive=savedDraft&&current.enabled===true;
 const draft=()=>{try{return validateDraft({registration,monthlyExVat:Number(monthly),initialExVat:Number(initial),termMonths:Number(term)});}catch{return null;}};
 const possible=draft();
 async function save(event){
  event.preventDefault();setStatus("");
  if(locked){setStatus("This protected deal cannot be edited here.");return;}
  if(!possible){setStatus("Enter a valid registration, rental prices and agreement term. Minimum initial rental £1,000 + VAT.");return;}
  const existingKey=getStoredMarketingAccessKey();
  if(!existingKey){setStatus("Unlock the Customer Database once to authorise changes. Your existing saved access will be reused here.");return;}
  setBusy(true);
  try{
   const r=await fetch("/api/rent2buy-special-deals",{method:"POST",headers:{"Content-Type":"application/json",[MARKETING_ACCESS_HEADER]:existingKey},body:JSON.stringify(possible)});
   const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Save failed.");
   setStatus("Draft saved. No public prices or badges have changed.");
   const refreshed=await fetch("/api/rent2buy-special-deals?admin=1",{headers:{[MARKETING_ACCESS_HEADER]:existingKey},cache:"no-store"}).then(r=>r.json());
   if(refreshed.ok){setOffers(refreshed.offers);setStorageReady(refreshed.storageReady);setActivationReady(refreshed.activationReady===true);}
  }catch(error){setStatus(error.message||"Could not save draft.");}finally{setBusy(false);}
 }
 async function changeStatus(action){
  const existingKey=getStoredMarketingAccessKey();if(!existingKey){setStatus("Unlock the Customer Database first.");return;}
  if(!activationReady||!savedDraft||locked){setStatus("Publishing is locked until the website and CRM release is complete.");return;}
  if(!window.confirm(action==="activate"?`Activate the special rental for ${registration} on BOTH Rent2Buy websites?`:`End the special rental for ${registration} and restore Felix pricing?`))return;
  setBusy(true);setStatus("");
  try{
   const response=await fetch("/api/rent2buy-special-deals",{method:"PATCH",headers:{"Content-Type":"application/json",[MARKETING_ACCESS_HEADER]:existingKey},body:JSON.stringify({action,registration,confirmRegistration:registration})});
   const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||"Update failed.");
   setStatus(result.message||"Updated.");
   const refreshed=await fetch("/api/rent2buy-special-deals?admin=1",{headers:{[MARKETING_ACCESS_HEADER]:existingKey},cache:"no-store"}).then(r=>r.json());if(refreshed.ok)setOffers(refreshed.offers);
  }catch(error){setStatus(error.message||"Special deal not updated.");}finally{setBusy(false);}
 }
 return <section className="panel" id="rent2buy-special-deal-editor" aria-label="Rent2Buy special-deal management" style={{padding:18,marginBottom:16}}>
   <div className="panel__header"><div><h3>Rent2Buy Special Deals</h3><p>Four approved legacy offers are selected and protected. New offers start as unpublished drafts.</p></div><span className="status-pill">{active.size} protected / active</span></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,margin:"12px 0 18px"}}>
    {protectedOffers().map(o=><div key={o.registration} style={{padding:"11px 12px",border:"1px solid #d6d7dc",borderRadius:9,background:"#f8f8f9",fontSize:13}}>
      <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:800}}><input type="checkbox" checked readOnly disabled aria-label={o.registration+" protected special deal"}/>{o.registration}</label>
      <div style={{marginTop:6}}>{pounds(o.monthlyExVat)} + VAT per month</div>
      <div>{pounds(o.initialExVat)} + VAT initial · {o.termMonths} months</div>
      <small>PROTECTED · live legacy deal</small>
    </div>)}
   </div>
   <form onSubmit={save} style={{display:"grid",gap:10,maxWidth:650}}>
    <strong>Create a new special-deal draft</strong>
    <small>Drafts do not appear on either website until the shared publishing and CRM verification are released. The protected four above are unchanged.</small>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:9}}>
      <label>Registration<input value={registration} onChange={e=>setRegistration(reg(e.target.value))} maxLength={7} placeholder="AB12CDE" required/></label>
      <label>Monthly + VAT<input type="number" min="1" step="0.01" value={monthly} onChange={e=>setMonthly(e.target.value)} required/></label>
      <label>Initial + VAT<input type="number" min="1000" step="0.01" value={initial} onChange={e=>setInitial(e.target.value)} required/></label>
      <label>Term<select value={term} onChange={e=>setTerm(e.target.value)}>{[12,18,24,30,36,42,48].map(t=><option key={t} value={t}>{t} months</option>)}</select></label>
    </div>
    {locked?<span className="notice">This is one of the four protected deals. Its existing terms are locked.</span>:null}
    {possible?<div className="notice">Preview: {pounds(possible.monthlyExVat)} + VAT ({pounds(incVat(possible.monthlyExVat))} inc VAT) monthly · {pounds(possible.initialExVat)} + VAT ({pounds(incVat(possible.initialExVat))} inc VAT) initial · {possible.termMonths} months</div>:null}
    <small>Uses your existing Customer Database access. No separate pricing password.</small>
    <button className="button button--primary" type="submit" disabled={busy||locked||storageReady===false||manuallyActive}>{busy?"Saving...":"Save unpublished draft"}</button>
    {savedDraft?<button className="button button--ghost" type="button" disabled={busy||!activationReady} onClick={()=>changeStatus(manuallyActive?"deactivate":"activate")}>{manuallyActive?"End Special Deal":"Activate Special Deal"}</button>:null}
    {!activationReady&&savedDraft?<small>Activation remains locked until the coordinated website and CRM release is complete.</small>:null}
    {storageReady===false?<small>Special-deal storage is not installed yet. Existing four remain visible; new draft saving is unavailable.</small>:null}
    {status?<p role="status">{status}</p>:null}
   </form>
 </section>;
}
