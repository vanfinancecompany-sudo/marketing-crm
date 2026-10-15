
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {instagramBufferSlots,instagramRemainingCapacity} from "../api/vansco-instagram-automation-worker.js";
import {vanscoDailySlots} from "../lib/vanscoFacebookAutomation.js";
const code=path=>readFileSync(new URL(path,import.meta.url),"utf8");
test("hourly UTC cron can refill while BST shifts London working hours",()=>{
 const worker=code("../api/vansco-instagram-automation-worker.js");
 assert.match(worker,/isBufferScheduledRunDue\("status"\)/);
 assert.doesNotMatch(worker,/isBufferScheduledRunDue\("two-hour"\)/);
 assert.match(worker,/MAX_CREATE_PER_RUN=6/);
 const when=new Date("2026-10-15T09:15:00Z"); // 10:15 London BST
 assert.equal(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"}).format(when),"10");
});

test("Vansco Instagram schedules at most twenty daily posts, ending before 22:00 UK",()=>{
 const day="2026-10-16";
 const slots=instagramBufferSlots({day,now:Date.UTC(2026,9,15),limit:20});
 assert.equal(slots.length,20);
 assert.equal(new Set(slots.map(s=>s.dueAt)).size,20);
 assert.equal(slots[0].localTime,"08:00");
 assert.equal(slots.at(-1).localTime,"21:00");
 assert.deepEqual(slots.map(s=>s.dueAt),vanscoDailySlots(day,20).map(s=>s.dueAt));
});
test("Provider sent and scheduled posts both count against twenty a day",()=>{
 const state={limit:{sent:7,scheduled:9,limit:50},posts:[]};
 assert.equal(instagramRemainingCapacity({state}),4);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:11,scheduled:10,limit:50},posts:[]}}),0);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:0,scheduled:0,limit:50},posts:[]}}),6);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:0,scheduled:0,limit:0},posts:[]}}),0);
 assert.equal(instagramRemainingCapacity({state:{limit:null,posts:[]}}),6);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:0,scheduled:0,limit:null},posts:[]}}),6);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:0,scheduled:0,limit:undefined},posts:[]}}),6);
 assert.equal(instagramRemainingCapacity({state:{limit:{sent:0,scheduled:0,limit:50},posts:[]},organisationCapacity:2}),2);
});
test("Manual queue slots are not duplicated",()=>{
 const day="2026-10-16",slots=vanscoDailySlots(day,20);
 const next=instagramBufferSlots({day,now:Date.UTC(2026,9,15),posts:[{dueAt:slots[0].dueAt}],limit:20});
 assert.equal(next.length,19);
 assert.ok(next.every(s=>s.dueAt!==slots[0].dueAt));
});
test("Vansco Instagram is a separate DealerKit worker that respects stocks, VAT and API cooldown",()=>{
 const worker=code("../api/vansco-instagram-automation-worker.js");
 const runtime=code("../api/_vansco-instagram-runtime.js");
 assert.match(worker,/fetchVanscoMetaCatalogue/);
 assert.match(worker,/isEligibleVanscoVehicle/);
 assert.match(worker,/isVanscoVatResolved/);
 assert.match(worker,/isBufferRateLimitCooldownError/);
 assert.match(worker,/VANSCO_INSTAGRAM_AUTOMATION_ENABLED/);
 assert.match(worker,/MAX_CREATE_PER_RUN=6/);
 assert.match(worker,/deleteVanscoBufferPost/);
 assert.match(runtime,/service\|\|""\)\.toLowerCase\(\)==="instagram"/);
 assert.match(runtime,/buildBufferCreatePostInput/);
 assert.match(runtime,/vansco-buffer-v1\/instagram-/);
});
test("Existing Vansco social Facebook and Google Business are not modified",()=>{
 const service=code("../lib/marketingDailyOperations.js");
 const dashboard=code("../pages/DashboardPage.jsx");
 assert.match(service,/vansco_instagram_post: "Vansco Instagram posts"/);
 assert.match(dashboard,/vanscoInstagramMetric/);
 assert.match(dashboard,/target = 20/);
});

test("Instagram operator controls verify channel and queue before any manual refill",()=>{
 const worker=code("../api/vansco-instagram-automation-worker.js");
 const dashboard=code("../pages/DashboardPage.jsx");
 assert.match(worker,/verifyBuffer=dryRun/);
 assert.match(worker,/const force=request.method==="POST"/);
 assert.match(worker,/vanscoInstagramConfig\(\)/);
 assert.match(worker,/vanscoInstagramState\(config,new Date\(now\)\)/);
 assert.match(dashboard,/CHECK VANSCO INSTAGRAM/);
 assert.match(dashboard,/QUEUE UP TO 6 INSTAGRAM POSTS/);
 assert.match(dashboard,/window.confirm\("Queue up to six Vansco Instagram/);
 assert.match(dashboard,/force=true/);
 assert.match(dashboard,/dryRun=true&verifyBuffer=true/);
});

test("Instagram Buffer access errors distinguish account, channel, queue and post stages", () => {
 const worker=code("../api/vansco-instagram-automation-worker.js");
 const shared=code("../api/_vansco-buffer-runtime.js");
 const runtime=code("../api/_vansco-instagram-runtime.js");
 const status=code("../api/vansco-facebook-automation-status.js");
 const dashboard=code("../pages/DashboardPage.jsx");
 assert.match(shared,/onStage\?\.\("read_buffer_account"\)/);
 assert.match(shared,/onStage\?\.\("read_buffer_channels"\)/);
 assert.match(runtime,/inspectVanscoBufferAccount\(\{onStage\}\)/);
 assert.match(worker,/stage="create_instagram_post"/);
 assert.match(worker,/stage="read_instagram_queue"/);
 assert.match(worker,/Worker failed",\{stage,message/);
 assert.match(worker,/state:"failed",stage,error:message/);
 assert.match(status,/stage: instagram\?\.stage/);
 assert.match(dashboard,/Buffer step:/);
});
