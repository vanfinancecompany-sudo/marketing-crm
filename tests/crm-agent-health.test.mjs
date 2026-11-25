import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {WORKERS,healthCounts,previousDue,workerHealth,normaliseExisting} from "../lib/crmHealthRegistry.js";
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
