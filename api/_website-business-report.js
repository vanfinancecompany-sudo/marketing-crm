import { getSupabaseServiceAdmin } from './_vansco-cache-utils.js';
import { groupApplicationOpportunities, APPLICATION_REPORT_SOURCES } from './_crm-application-opportunities.js';
import { ANALYTICS_SITE_ORIGINS } from '../lib/analyticsSiteOrigins.js';

// Reporting only: no writes, no collection/consent changes. Completed London calendar days; today's window is partial.
function londonDateKey(date){return Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date).map(p=>[p.type,p.value]));}

function dateKey(date){const p=londonDateKey(date);return `${p.year}-${p.month}-${p.day}`;}

function shiftDate(key,days){const [y,m,d]=key.split("-").map(Number);return new Date(Date.UTC(y,m-1,d+days,12)).toISOString().slice(0,10);}

function boundary(key){const [y,m,d]=key.split("-").map(Number),utc=Date.UTC(y,m-1,d);const offset=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",timeZoneName:"longOffset"}).formatToParts(new Date(utc)).find(p=>p.type==="timeZoneName")?.value||"GMT";const m0=offset.match(/^GMT([+-])(\d\d):(\d\d)$/);return new Date(utc-(m0?(m0[1]==="-"?-1:1)*(Number(m0[2])*60+Number(m0[3]))*60000:0)).toISOString();}

function buildRanges(now=new Date()){const instant=new Date(now);const today=dateKey(instant);const make=(a,b,partial=false)=>({startDate:a,endExclusive:b,from:boundary(a),to:partial?instant.toISOString():boundary(b),partial});return {today:make(today,shiftDate(today,1),true),sevenDays:make(shiftDate(today,-7),today),previousSevenDays:make(shiftDate(today,-14),shiftDate(today,-7)),twentyEightDays:make(shiftDate(today,-28),today),previousTwentyEightDays:make(shiftDate(today,-56),shiftDate(today,-28))};}

function measurementWarning(site,current,previous){const start=previous.startDate,end=current.endExclusive;if(site==="vanFinance"&&start<"2026-11-23"&&end>"2026-11-22")return "VFC consent and first-party page-view measurement changed around 22–23 November 2026. Recorded traffic is not directly comparable across this boundary.";if(site==="rent2buy"&&start<"2026-11-20"&&end>"2026-11-18")return "18–19 November 2026 contained unusually high unattributed Rent2Buy session counts. Traffic comparisons including those dates are unreliable.";return null;}

function opportunityCount(groups,site,range){if(!Array.isArray(groups))return null;const keys=site==="vanFinance"?["vanFinance","vfcRent2Buy"]:["rent2buy"];const from=Date.parse(range.from),to=Date.parse(range.to);return groups.filter(g=>keys.includes(g.site)&&g.firstAt>=from&&g.firstAt<to).length;}

function relativeChange(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b>0?(a-b)/b:null;}

async function countSessions(client,origin,range,sourceOnly=false){try{let query=client.from("site_analytics_sessions").select("session_id",{count:"exact",head:true}).eq("site_origin",origin).gte("started_at",range.from).lt("started_at",range.to);if(sourceOnly)query=query.not("source","is",null).neq("source","");const {count,error}=await query;return !error&&Number.isSafeInteger(count)&&count>=0?count:null;}catch{return null;}}

async function loadTraffic(client,origin,range){const [sessions,sourceLabelledSessions]=await Promise.all([countSessions(client,origin,range),countSessions(client,origin,range,true)]);return {sessions,sourceLabelledSessions:sessions!==null&&sourceLabelledSessions!==null&&sourceLabelledSessions>sessions?null:sourceLabelledSessions};}

async function readApplicationRows(client,ranges,sources){const start=new Date(Date.parse(ranges.previousTwentyEightDays.from)-3600000).toISOString(),end=ranges.today.to,rows=[];const size=500;for(let offset=0;offset<20000;offset+=size){const {data,error}=await client.from("manual_leads").select("id,created_at,pipeline,source,email,phone,name").in("source",sources).in("pipeline",["vanFinance","rent2buy"]).gte("created_at",start).lt("created_at",end).order("created_at",{ascending:true}).order("id",{ascending:true}).range(offset,offset+size-1);if(error||!Array.isArray(data))throw new Error("CRM application report unavailable");rows.push(...data);if(data.length<size)return rows;}throw new Error("CRM application report exceeds safe pagination limit");}

function summarizeSite(site,ranges,traffic,groups){const periods=Object.fromEntries(Object.entries(ranges).map(([key,range])=>[key,{...traffic[key],crmApplications:opportunityCount(groups,site,range)}]));const compare=(current,previous)=>{const warning=measurementWarning(site,ranges[current],ranges[previous]);const a=periods[current],b=periods[previous];return {warning,sessionChange:warning?null:relativeChange(a.sessions,b.sessions),applicationChange:relativeChange(a.crmApplications,b.crmApplications)};};return {periods,comparisons:{sevenDays:compare("sevenDays","previousSevenDays"),twentyEightDays:compare("twentyEightDays","previousTwentyEightDays")}};}

async function loadWebsiteBusinessReport({now=new Date(),supabase}={}){const client=supabase||getSupabaseServiceAdmin(),ranges=buildRanges(now);const groupsPromise=readApplicationRows(client,ranges,APPLICATION_REPORT_SOURCES).then(groupApplicationOpportunities).catch(()=>null);const sites=[["vanFinance",ANALYTICS_SITE_ORIGINS.vfc],["rent2buy",ANALYTICS_SITE_ORIGINS.rent2buy]];const results=await Promise.all(sites.map(async ([key,origin])=>{const traffic={};for(const [period,range] of Object.entries(ranges))traffic[period]=await loadTraffic(client,origin,range);return [key,summarizeSite(key,ranges,traffic,await groupsPromise)];}));return {version:"crm-business-report-v1",checkedAt:new Date(now).toISOString(),timeZone:"Europe/London",periods:Object.fromEntries(Object.entries(ranges).map(([key,r])=>[key,{startDate:r.startDate,endExclusive:r.endExclusive,partial:r.partial}])),sites:Object.fromEntries(results)};}

export { buildRanges, boundary, measurementWarning, opportunityCount, relativeChange, countSessions, summarizeSite, loadWebsiteBusinessReport };
