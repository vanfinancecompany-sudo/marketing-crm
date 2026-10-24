import {useEffect,useState} from "react";
import {incVat,protectedOffers,reg,validateDraft} from "../lib/rent2BuySpecialDealControl.mjs";
const pounds=v=>Number(v).toLocaleString("en-GB",{style:"currency",currency:"GBP"});
export default function Rent2BuySpecialDealPanel({vehicles=[],selectedRegistration="",onSelectRegistration=()=>{}}){
 const [offers,setOffers]=useState(protectedOffers());
 const [registration,setRegistration]=useState("");
 const [monthly,setMonthly]=useState("");
 const [initial,setInitial]=useState("");
 const [term,setTerm]=useState("36");
 const [key,setKey]=useState("");
 const [status,setStatus]=useState("");
 const [busy,setBusy]=useState(false);
 const [storageReady,setStorageReady]=useState(null);
 useEffect(()=>{let mounted=true;fetch("/api/rent2buy-special-deals",{cache:"no-store"}).then(r=>r.json()).then(x=>{
  if(mounted&&x.ok){setOffers(x.offers);setStorageReady(x.storageReady);}
 }).catch(()=>{if(mounted)setStatus("Cannot load saved specials. Four protected deals remain selected.");});
 return ()=>{mounted=false};},[]);
 useEffect(()=>{if(selectedRegistration){setRegistration(reg(selectedRegistration));setStatus("");}},[selectedRegistration]);
 const active=new Set(offers.filter(x=>x.enabled).map(x=>reg(x.registration)));
 const selected=active.has(reg(registration));
 const current=offers.find(x=>reg(x.registration)===reg(registration));
 const locked=Boolean(current?.protected);
 const draft=()=>{try{return validateDraft({registration,monthlyExVat:Number(monthly),initialExVat:Number(initial),termMonths:Number(term)});}catch{return null;}};
 const possible=draft();
 async function save(event){
  event.preventDefault();setStatus("");
  if(locked){setStatus("This protected deal cannot be edited here.");return;}
  if(!possible){setStatus("Enter a valid registration, rental prices and agreement term. Minimum initial rental £1,000 + VAT.");return;}
  if(key.length<32){setStatus("Enter the dedicated special-deal admin key to save a draft.");return;}
  setBusy(true);
  try{
   const r=await fetch("/api/rent2buy-special-deals",{method:"POST",headers:{"Content-Type":"application/json","x-rent2buy-special-admin-key":key},body:JSON.stringify(possible)});
   const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||"Save failed.");
   setStatus("Draft saved. No public pricing, badges or Felix matrix have changed.");
  }catch(error){setStatus(error.message||"Could not save draft.");}finally{setBusy(false);}
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
    <label>Special-deal admin key <input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" placeholder="Required for protected draft saving"/></label>
    <button className="button button--primary" type="submit" disabled={busy||locked||storageReady===false}>{busy?"Saving draft...":"Save unpublished draft"}</button>
    {storageReady===false?<small>Special-deal storage is not installed yet. Existing four remain visible; new draft saving is unavailable.</small>:null}
    {status?<p role="status">{status}</p>:null}
   </form>
 </section>;
}
