import test from "node:test";
import assert from "node:assert/strict";
import {analyseRent2BuyQuoteReadiness} from "../lib/rent2BuyQuoteReadiness.mjs";
import {RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS} from "../api/_rent2buy-complete-quote-snapshot.mjs";

const now=Date.UTC(2026,9,23,17,0);
const rows=(spacing=900000,n=96)=>{
 const result=[];
 for(let i=0;i<n;i++){
  const started=new Date(now-6000-(n-i-1)*spacing).toISOString();
  const completed=new Date(now-1000-(n-i-1)*spacing).toISOString();
  result.push({
    started_at:started,completed_at:completed,status:"complete",
    snapshot:{provider:{complete:true,refresh:{status:"complete"},diagnostics:{
      complete:true,stableReportedTotal:true,
    }}},
  });
 }
 return result;
};

test("15-minute stable monitor is not enough for 90-second binding quote, even with 96/96 successful runs",()=>{
 const state=analyseRent2BuyQuoteReadiness(rows(),{now});
 assert.equal(state.monitorRuns,96);
 assert.equal(state.completeRuns,96);
 assert.equal(state.maxSourceAgeSeconds,90);
 assert.equal(state.measuredP95IntervalSeconds,900);
 assert.equal(state.theoreticalMaxWindowPercent,10);
 assert.equal(state.readyForCustomerQuotes,false);
 assert.ok(state.blockers.includes("monitor_cadence_exceeds_quote_ttl"));
 assert.equal(RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS,90000);
});
test("monitor with failed/incomplete rows remains blocked and does not pretend freshness",()=>{
 const history=rows();history[95].snapshot.provider.complete=false;
 const result=analyseRent2BuyQuoteReadiness(history,{now});
 assert.equal(result.completeRuns,95);
 assert.ok(result.blockers.includes("last_monitor_not_complete"));
 assert.ok(result.blockers.includes("incomplete_monitor_runs"));
});
test("even with fast healthy scans and fresh snapshot, a commercial/advertisement confirmation remains necessary",()=>{
 const result=analyseRent2BuyQuoteReadiness(rows(60000),{now});
 assert.equal(result.measuredP95IntervalSeconds,60);
 assert.equal(result.blockers.includes("monitor_cadence_exceeds_quote_ttl"),false);
 assert.equal(result.readyForCustomerQuotes,false);
 assert.ok(result.blockers.includes("provider_current_advertisement_semantics_not_confirmed"));
 assert.ok(result.blockers.includes("commercial_approvals_not_completed"));
});
test("stale, absent or short monitor history cannot claim production readiness",()=>{
 const old=analyseRent2BuyQuoteReadiness(rows(900000),{now:now+120000});
 assert.ok(old.blockers.includes("last_complete_snapshot_outside_strict_ttl"));
 const missing=analyseRent2BuyQuoteReadiness([],{now});
 assert.equal(missing.monitorRuns,0);
 assert.equal(missing.theoreticalMaxWindowPercent,0);
 assert.ok(missing.blockers.includes("insufficient_monitor_history"));
 const short=analyseRent2BuyQuoteReadiness(rows(900000,3),{now});
 assert.ok(short.blockers.includes("insufficient_monitor_history"));
});
