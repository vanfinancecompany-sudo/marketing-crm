import { loadGa4PipelineSummary } from './_ga4-data-api.js';
import { loadLiveApplicationCompletions } from './_live-application-completions.js';
import { loadCrmApplicationOpportunities } from './_crm-application-opportunities.js';

function clean(value,limit=500){return String(value||'').trim().slice(0,limit);}
function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}

function withLiveApplicationCompletions(summary,live){
 if(!summary||!Array.isArray(summary.sites)||!live?.sites)return summary;
 return {
  ...summary,
  liveApplicationDate:live.date||'',
  sites:summary.sites.map((site)=>{
   const ga4Starts=number(site.applicationStartsToday);
   const ga4Completions=number(site.applicationCompletionsToday);
   const liveSite=live.sites?.[site.key]||null;
   const liveReaches=number(liveSite?.reaches);
   const liveStarts=number(liveSite?.starts);
   const liveExplicitStarts=number(liveSite?.explicitStarts);
   const liveCompletions=number(liveSite?.completions);
   const hasLiveApplicationActivity=Boolean(liveSite)&&(liveReaches>0||liveStarts>0||liveCompletions>0);
   const effectiveStarts=hasLiveApplicationActivity?liveStarts:ga4Starts;
   const effectiveCompletions=hasLiveApplicationActivity?liveCompletions:ga4Completions;
   const effectiveConversionRate=effectiveStarts>0&&effectiveCompletions<=effectiveStarts
    ?effectiveCompletions/effectiveStarts
    :effectiveStarts===0&&effectiveCompletions===0?0:null;
   return {
    ...site,
    ga4ApplicationStartsToday:ga4Starts,
    ga4ApplicationCompletionsToday:ga4Completions,
    liveApplicationReachesToday:liveReaches,
    liveApplicationStartsToday:liveStarts,
    liveExplicitApplicationStartsToday:liveExplicitStarts,
    liveApplicationCompletionsToday:liveCompletions,
    applicationStartsToday:effectiveStarts,
    applicationCompletionsToday:effectiveCompletions,
    applicationStartSource:hasLiveApplicationActivity?'first_party_live':'ga4',
    applicationCompletionSource:hasLiveApplicationActivity?'first_party_live':'ga4',
    effectiveConversionRate:hasLiveApplicationActivity?effectiveConversionRate:site.conversionRate,
   };
  }),
 };
}

export function withCrmApplicationOpportunities(summary, applicationStats) {
 if (!summary || !Array.isArray(summary.sites)) return summary;
 const statsAvailable = Boolean(applicationStats?.periods?.today);
 const today = applicationStats?.periods?.today?.sites || {};
 const seven = applicationStats?.periods?.sevenDays?.sites || {};
 const twentyEight = applicationStats?.periods?.twentyEightDays?.sites || {};
 return {
  ...summary,
  applicationOpportunities: applicationStats || null,
  applicationStatsStatus: statsAvailable ? 'crm_verified' : 'unavailable',
  sites: summary.sites.map((site) => {
   const key = site.key;
   return {
    ...site,
    crmConfirmedApplicationsToday: statsAvailable ? (today[key] ?? 0) : null,
    crmConfirmedApplications7Days: statsAvailable ? (seven[key] ?? 0) : null,
    crmConfirmedApplications28Days: statsAvailable ? (twentyEight[key] ?? 0) : null,
    crmApplicationsStatus: statsAvailable ? 'verified' : 'unavailable',
    // Do not infer a conversion percentage from completion events posing as starts.
    actualApplicationConversionRate: null,
   };
  }),
 };
}

export default async function handler(request,response){
 if(request.method!=='GET')return response.status(405).json({ok:false,message:'Method not allowed.'});
 response.setHeader('Cache-Control','no-store');
 try{
  const [summary,live,confirmed]=await Promise.all([
   loadGa4PipelineSummary(),
   loadLiveApplicationCompletions().catch(()=>null),
   loadCrmApplicationOpportunities().catch((error)=> {
    console.error('[application-statistics] CRM verified counts unavailable:', error?.message || error);
    return null;
   }),
  ]);
  return response.status(200).json(withCrmApplicationOpportunities(withLiveApplicationCompletions(summary,live),confirmed));
 }catch(error){
  return response.status(error.status||500).json({ok:false,source:'ga4',message:clean(error?.message||'GA4 pipeline summary failed.')});
 }
}

export { withLiveApplicationCompletions };
