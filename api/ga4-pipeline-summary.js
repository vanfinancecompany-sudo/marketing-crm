import { loadGa4PipelineSummary } from './_ga4-data-api.js';
import { loadLiveApplicationCompletions } from './_live-application-completions.js';

function clean(value,limit=500){return String(value||'').trim().slice(0,limit);}
function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}

function withLiveApplicationCompletions(summary,live){
 if(!summary||!Array.isArray(summary.sites)||!live?.sites)return summary;
 return {
  ...summary,
  liveApplicationDate:live.date||'',
  sites:summary.sites.map((site)=>{
   const ga4Completions=number(site.applicationCompletionsToday);
   const liveCompletions=number(live.sites?.[site.key]?.completions);
   const effectiveCompletions=Math.max(ga4Completions,liveCompletions);
   const starts=number(site.applicationStartsToday);
   const liveAhead=liveCompletions>ga4Completions;
   return {
    ...site,
    ga4ApplicationCompletionsToday:ga4Completions,
    liveApplicationCompletionsToday:liveCompletions,
    applicationCompletionsToday:effectiveCompletions,
    applicationCompletionSource:liveAhead?'first_party_live':'ga4',
    effectiveConversionRate:starts>=effectiveCompletions&&starts>0?effectiveCompletions/starts:site.conversionRate,
   };
  }),
 };
}

export default async function handler(request,response){
 if(request.method!=='GET')return response.status(405).json({ok:false,message:'Method not allowed.'});
 response.setHeader('Cache-Control','no-store');
 try{
  const [summary,live]=await Promise.all([
   loadGa4PipelineSummary(),
   loadLiveApplicationCompletions().catch(()=>null),
  ]);
  return response.status(200).json(withLiveApplicationCompletions(summary,live));
 }catch(error){
  return response.status(error.status||500).json({ok:false,source:'ga4',message:clean(error?.message||'GA4 pipeline summary failed.')});
 }
}

export { withLiveApplicationCompletions };
