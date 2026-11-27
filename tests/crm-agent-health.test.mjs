import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {WORKERS,healthCounts,previousDue,workerHealth,normaliseExisting,approvalMonitorHealth,isCurrentServiceRow} from "../lib/crmHealthRegistry.js";
import {isMonitoredCron,classifyReceipt,withCronHealth} from "../lib/cronHealthTelemetry.js";

test("all scheduled workers are registered and instrumented",()=>{
 const config=JSON.parse(fs.readFileSync(new URL("../vercel.json",import.meta.url)));
 assert.deepEqual(WORKERS.map(w=>[w.key,w.schedule]),config.crons.map(c=>[c.path.split("?")[0],c.schedule]));
 for(const w of WORKERS){const src=fs.readFileSync(new URL(".."+w.key+".js",import.meta.url),"utf8");assert.ok(src.includes("withCronHealth("+JSON.stringify(w.key)),w.key);}
});
test("unverified evidence never produces an all-green summary",()=>{
 assert.equal(healthCounts([{state:"unverified"},{state:"healthy"}]).level,"unverified");
 assert.equal(healthCounts([{state:"critical"},{state:"unverified"}]).level,"critical");
 assert.equal(normaliseExisting({status:"healthy",telemetry:"shared"}).state,"unverified");
});
test("schedule grace respects nightly inactivity and daily cadence",()=>{
 assert.equal(previousDue("5 6-22 * * *",new Date("2026-11-26T03:00Z")).toISOString(),"2026-11-25T22:05:00.000Z");
 const w={key:"test",label:"Worker",schedule:"0 7 * * *"};
 const row={started_at:"2026-11-25T07:00:00Z",completed_at:"2026-11-25T07:00:02Z",outcome:"success"};
 assert.equal(workerHealth(w,row,new Date("2026-11-26T07:05:00Z")).state,"healthy");
 assert.equal(workerHealth(w,row,new Date("2026-11-26T07:20:00Z")).state,"critical");
 assert.equal(workerHealth(w,null,new Date()).state,"unverified");
});
test("cron telemetry is production-only, authenticated and classifies outcomes",()=>{
 const env={VERCEL_ENV:"production",CRON_SECRET:"secret"};
 const req={method:"GET",headers:{authorization:"Bearer secret"}};
 assert.equal(isMonitoredCron(req,env),true);
 assert.equal(isMonitoredCron(req,{...env,VERCEL_ENV:"preview"}),false);
 assert.equal(isMonitoredCron({...req,headers:{}},env),false);
 assert.equal(classifyReceipt("x",207,{ok:false}).outcome,"warning");
 assert.equal(classifyReceipt("x",500,{ok:false}).outcome,"failed");
 assert.equal(classifyReceipt("x",200,{disabled:true}).outcome,"disabled");
});
test("telemetry failure cannot prevent or modify the actual response",async()=>{
 const env={VERCEL_ENV:"production",CRON_SECRET:"secret"};
 const req={method:"GET",headers:{authorization:"Bearer secret"}};
 const records=[];const payload={ok:true,privateValue:"never stored"};
 const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.sent=v;return this;}};
 const handler=withCronHealth("/api/example",async(req,res)=>res.status(200).json(payload),{environment:env,record:async r=>{records.push(r);throw Error("telemetry offline");}});
 await handler(req,res);
 assert.equal(res.sent,payload);assert.equal(records.length,1);assert.equal(records[0].p_outcome,"success");
 assert.equal(JSON.stringify(records).includes("privateValue"),false);
});
test("preview and manual calls do not write telemetry",async()=>{
 const env={VERCEL_ENV:"preview",CRON_SECRET:"secret"};
 let writes=0;const res={statusCode:200,json(v){this.sent=v;return this;}};
 await withCronHealth("/api/example",async(req,r)=>r.json({ok:true}),{environment:env,record:async()=>{writes++;}})({method:"GET",headers:{authorization:"Bearer secret"}},res);
 assert.equal(writes,0);assert.deepEqual(res.sent,{ok:true});
});
test("only one global health widget is mounted and retired stock refresh is removed",()=>{
 const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const core=fs.readFileSync(new URL("../api/system-health.js",import.meta.url),"utf8");
 assert.ok(!html.includes("/system-health-monitor.js"));
 assert.ok(!core.includes('key: "vansco_stock_refresh"'));
 assert.ok(!core.includes('.from("vansco_refresh_runs")'));
});

test("approval monitoring distinguishes an alarm from results and reports unresolved deliveries",()=>{
 const now=new Date("2026-11-26T10:00Z");
 const alarm={scheduled:true,lastAlarmAt:"2026-11-26T09:00Z",lastCheckAt:"2026-11-26T09:01Z"};
 assert.equal(approvalMonitorHealth({scheduled:true},now).state,"unverified");
 assert.equal(approvalMonitorHealth({...alarm,pendingCount:0},now).state,"idle");
 const idle = approvalMonitorHealth({...alarm,pendingCount:0,outcome:"timeout"},now);
 assert.equal(idle.state,"idle");
 assert.equal(idle.lastAt,alarm.lastAlarmAt);
 assert.match(idle.detail,/No adverts are awaiting approval/);
 assert.equal(approvalMonitorHealth({...alarm,pendingCount:2,outcome:"pending"},now).state,"healthy");
 assert.equal(approvalMonitorHealth({...alarm,pendingCount:2,unresolvedCount:1},now).state,"warning");
 assert.equal(approvalMonitorHealth({...alarm,outcome:"timeout"},now).state,"warning");
 assert.equal(approvalMonitorHealth(alarm,new Date("2026-11-26T11:00Z")).state,"warning");
 assert.ok(["rent2buy_price_sync","email_orphan_worker","vansco_stock_refresh"].every(key=>!isCurrentServiceRow({key})));
});

test("price and orphan workers record outcomes even when handlers return JSON strings",()=>{
 const price="/api/rent2buy-monthly-price-sync",orphan="/api/marketing-template-campaign-send-orphan-worker";
 assert.equal(classifyReceipt(price,200,{skipped:true}).outcome,"warning");
 assert.equal(classifyReceipt(price,200,{scanned:120,changes_needed:0,updated:0}).outcome,"idle");
 assert.equal(classifyReceipt(price,207,{scanned:120,changes_needed:3,updated:2,failures:[{}]}).outcome,"warning");
 assert.match(classifyReceipt(price,200,{scanned:120,changes_needed:3,updated:3}).detail,/120 stock rows; 3 numeric prices/);
 assert.equal(classifyReceipt(orphan,200,JSON.stringify({ok:true,inspected:1,results:[{action:"attention",send_id:"private-id"}]})).outcome,"warning");
 assert.equal(classifyReceipt(orphan,200,{inspected:0,results:[]}).outcome,"idle");
 const receipt=classifyReceipt(orphan,200,{inspected:2,results:[{action:"release",changed:true,send_id:"private-id"}]});
 assert.equal(receipt.outcome,"success");
 assert.ok(!receipt.detail.includes("private-id"));
});
