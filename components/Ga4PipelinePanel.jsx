import { useEffect, useState } from 'react';

function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
function formatNumber(value){return new Intl.NumberFormat('en-GB').format(Math.round(number(value)));}
function formatPercent(value){return value==null?'n/a':`${Math.round(number(value)*1000)/10}%`;}
function changeLabel(value){if(value==null)return 'No 7-day comparison yet';const prefix=value>0?'+':'';return `${prefix}${value}% vs 7-day average`;}

function SiteCard({site}){
 const configured=Boolean(site?.configured);
 const liveApplication=site?.applicationStartSource==='first_party_live'||site?.applicationCompletionSource==='first_party_live';
 const conversionRate=site?.effectiveConversionRate??site?.conversionRate;
 const ga4Starts=site?.ga4ApplicationStartsToday??site?.applicationStartsToday;
 return <article className="ga4-pipeline-card">
  <div className="ga4-pipeline-card__head">
   <div><span>{site?.label||'Website'}</span><strong>{configured?'GA4 live':'GA4 setup needed'}</strong></div>
   <b>{liveApplication?'GA4 + first-party':site?.source||'ga4'}</b>
  </div>
  {configured? <>
   <div className="ga4-pipeline-metrics">
    <div><strong>{formatNumber(site.usersToday)}</strong><span>Users today</span><em>{changeLabel(site.usersVsSevenDayPct)}</em></div>
    <div><strong>{formatNumber(site.sessionsToday)}</strong><span>Sessions</span><em>{formatNumber(site.pageViewsToday)} page views</em></div>
    <div><strong>{formatNumber(site.applicationStartsToday)}</strong><span>{liveApplication?'Unique app starts':'App start events'}</span><em>{formatNumber(site.applicationCompletionsToday)} completed{liveApplication?` · GA4 logged ${formatNumber(ga4Starts)} start events`:''}</em></div>
    <div><strong>{formatPercent(conversionRate)}</strong><span>App conversion</span><em>{liveApplication?'Deduplicated by application session':`${formatNumber(site.leadEventsToday)} lead events`}</em></div>
   </div>
   <div className="ga4-pipeline-lists">
    <div><h4>Top pages today</h4>{(site.topPages||[]).slice(0,4).map((page)=><p key={page.path}><span>{page.path}</span><b>{formatNumber(page.views)}</b></p>)}</div>
    <div><h4>Traffic sources today</h4>{(site.sources||[]).slice(0,4).map((source)=><p key={source.source}><span>{source.source}</span><b>{formatNumber(source.sessions)}</b></p>)}</div>
   </div>
  </> : <p className="ga4-pipeline-note">{site?.message||'Add the GA4 property ID and service account credentials in Vercel to activate live reporting.'}</p>}
 </article>;
}

export default function Ga4PipelinePanel(){
 const [data,setData]=useState(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;
  async function load(){
   try{
    const response=await fetch('/api/ga4-pipeline-summary',{cache:'no-store'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false)throw new Error(payload?.message||'GA4 summary could not be loaded.');
    if(!cancelled)setData(payload);
   }catch(caught){if(!cancelled)setError(caught.message||'GA4 summary could not be loaded.');}
  }
  load();
  const id=window.setInterval(load,5*60*1000);
  return()=>{cancelled=true;window.clearInterval(id);};
 },[]);
 return <section className="panel ga4-pipeline-panel">
  <div className="section-heading">
   <div>
    <span className="eyebrow">GA4 · REAL WEBSITE TRAFFIC</span>
    <h3>Daily pipeline traffic</h3>
    <p>Google Analytics remains the traffic source of truth; application starts and completions use first-party session IDs when available so repeat events are not counted as extra applicants.</p>
   </div>
   <small>{data?.checkedAt?`Checked ${new Date(data.checkedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`:'Loading'}</small>
  </div>
  {error?<div className="notice notice--error">{error}</div>:null}
  {!error&&!data?<div className="notice">Loading GA4 pipeline stats…</div>:null}
  {data?.message?<div className="notice">{data.message}</div>:null}
  <div className="ga4-pipeline-grid">
   {(data?.sites||[]).map((site)=><SiteCard key={site.key} site={site}/>) }
  </div>
  <style>{`
   .ga4-pipeline-panel{display:grid;gap:18px}.ga4-pipeline-panel .section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.ga4-pipeline-panel h3{margin:4px 0 6px;font-size:28px;line-height:1}.ga4-pipeline-panel p{margin:0;color:#667085}.ga4-pipeline-panel small{color:#667085;font-weight:800}.ga4-pipeline-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.ga4-pipeline-card{border:1px solid #e4e7ec;border-radius:22px;background:#fff;padding:18px;box-shadow:0 14px 40px rgba(16,24,40,.06)}.ga4-pipeline-card__head{display:flex;justify-content:space-between;gap:14px;margin-bottom:16px}.ga4-pipeline-card__head span{display:block;color:#d71920;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.ga4-pipeline-card__head strong{display:block;margin-top:4px;color:#101828;font-size:20px}.ga4-pipeline-card__head b{height:max-content;border-radius:999px;background:#101828;color:#fff;padding:6px 10px;font-size:11px;text-transform:uppercase}.ga4-pipeline-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ga4-pipeline-metrics div{border:1px solid #eef0f4;border-radius:16px;padding:12px;background:#f9fafb}.ga4-pipeline-metrics strong{display:block;color:#101828;font-size:24px}.ga4-pipeline-metrics span{display:block;color:#344054;font-size:13px;font-weight:800}.ga4-pipeline-metrics em{display:block;margin-top:4px;color:#667085;font-size:12px;font-style:normal}.ga4-pipeline-lists{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.ga4-pipeline-lists h4{margin:0 0 8px;color:#101828;font-size:14px}.ga4-pipeline-lists p{display:flex;justify-content:space-between;gap:12px;margin:0 0 6px;color:#344054;font-size:13px}.ga4-pipeline-lists span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ga4-pipeline-lists b{color:#101828}.ga4-pipeline-note{padding:14px;border-radius:16px;background:#fff7ed;color:#9a3412!important;font-weight:700}@media(max-width:900px){.ga4-pipeline-grid,.ga4-pipeline-lists{grid-template-columns:1fr}.ga4-pipeline-panel .section-heading{display:block}.ga4-pipeline-metrics{grid-template-columns:1fr 1fr}}@media(max-width:560px){.ga4-pipeline-metrics{grid-template-columns:1fr}.ga4-pipeline-card{padding:14px;border-radius:18px}.ga4-pipeline-panel h3{font-size:24px}}
  `}</style>
 </section>;
}
