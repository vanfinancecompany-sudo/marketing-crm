/**
 * Read-only operational readiness for the signed Rent2Buy quote source.
 * NEVER lengthens the 90-second TTL or makes a DealerKit request.
 * A healthy 15-minute monitor does NOT establish current quote availability.
 */
import { RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS } from "../api/_rent2buy-complete-quote-snapshot.mjs";

const time=value=>{
  const result=Date.parse(String(value??""));
  return Number.isFinite(result)?result:NaN;
};
const finite=value=>Number.isFinite(value);
const percentile=(sorted,fraction)=>{
  if(!sorted.length)return null;
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))];
};
const monitorIsComplete=row=>row?.status==="complete"&&
 row?.snapshot?.provider?.complete===true&&
 row?.snapshot?.provider?.diagnostics?.complete===true&&
 row?.snapshot?.provider?.diagnostics?.stableReportedTotal===true&&
 row?.snapshot?.provider?.refresh?.status==="complete";

export function analyseRent2BuyQuoteReadiness(runs,{
  now=Date.now(),maxAgeMs=RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS,
}={}){
  const latestRuns=Array.isArray(runs)?runs.slice(0,120):[];
  const chronological=latestRuns.map(row=>({
    startedAt:time(row?.started_at),
    completedAt:time(row?.completed_at),
    complete:monitorIsComplete(row),
  })).filter(row=>finite(row.startedAt)).sort((a,b)=>a.startedAt-b.startedAt);
  const intervals=[];
  for(let i=1;i<chronological.length;i++){
    const delta=chronological[i].startedAt-chronological[i-1].startedAt;
    if(delta>0)intervals.push(delta);
  }
  intervals.sort((a,b)=>a-b);
  const latest=chronological.at(-1);
  const measuredP95Ms=percentile(intervals,0.95);
  const count=chronological.length;
  const successful=chronological.filter(row=>row.complete).length;
  const latestAgeMs=latest?now-latest.completedAt:null;

  const blockers=[];
  if(count<12||intervals.length<11)blockers.push("insufficient_monitor_history");
  if(successful!==count)blockers.push("incomplete_monitor_runs");
  if(!latest?.complete||!finite(latest.completedAt))blockers.push("last_monitor_not_complete");
  if(latestAgeMs===null||!finite(latestAgeMs)||latestAgeMs<0||
     latestAgeMs>maxAgeMs)blockers.push("last_complete_snapshot_outside_strict_ttl");
  if(measuredP95Ms===null||measuredP95Ms>maxAgeMs)
    blockers.push("monitor_cadence_exceeds_quote_ttl");

  // This is ONLY an upper bound based on a regularly spaced schedule;
  // it is not observed customer quote uptime or proof of current advertising.
  const theoreticalMaxWindowPercent=measuredP95Ms===null?0:
    Math.round(Math.min(1,maxAgeMs/measuredP95Ms)*10000)/100;

  // Provider has not confirmed a per-stock "currently advertised" verifier;
  // approval/VAT tables and explicit commercial terms are also outstanding.
  blockers.push("provider_current_advertisement_semantics_not_confirmed");
  blockers.push("commercial_approvals_not_completed");
  return {
    readyForCustomerQuotes:false,
    monitorRuns:count,
    completeRuns:successful,
    lastMonitorComplete:Boolean(latest?.complete),
    latestMonitorAgeSeconds:finite(latestAgeMs)?Math.max(0,Math.round(latestAgeMs/1000)):null,
    measuredP95IntervalSeconds:finite(measuredP95Ms)?Math.round(measuredP95Ms/1000):null,
    maxSourceAgeSeconds:Math.round(maxAgeMs/1000),
    theoreticalMaxWindowPercent,
    blockers:[...new Set(blockers)],
  };
}
