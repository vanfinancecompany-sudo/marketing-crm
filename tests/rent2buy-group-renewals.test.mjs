import test from "node:test";
import assert from "node:assert/strict";
import { buildRenewalPlan, summarizeRenewalRun, londonDay } from "../lib/rent2buyGroupRenewals.js";
const now = new Date("2026-11-25T16:00:00Z");
const fixture = (id, state = {}, r2b = true) => ({ group_url: "https://www.facebook.com/groups/" + id + "/", group_name: id, rent2buy: r2b, state: { pipeline: "proven", acceptedPostCount: 1, lastPostedAt: "2026-11-18T16:00:00Z", repeatDays: 7, postStatus: "accepted", status: "Green", joined: true, canPost: true, ...state } });
test("only due, previously accepted Rent2Buy groups; respect stricter interval", () => {
  const p = buildRenewalPlan([fixture("ok"), fixture("finance",{},false), fixture("archive",{archived:true}), fixture("new",{pipeline:"new",acceptedPostCount:0}), fixture("recent",{lastPostedAt:"2026-11-19T16:00:00Z"}), fixture("long",{repeatDays:14}), fixture("red",{status:"Red"}), fixture("short",{repeatDays:1,lastPostedAt:"2026-11-24T16:00:00Z"})],now);
  assert.deepEqual(p.groups.map(g=>g.name),["ok"]);
});
test("unconfirmed posts and permissions stay visibly in review; cap 30", () => {
  const p = buildRenewalPlan([fixture("review",{postStatus:"awaiting",joined:false,canPost:false}), ...Array.from({length:30},(_,i)=>fixture("g"+i))],now);
  assert.equal(p.dueCount,31); assert.equal(p.reviewCount,1); assert.equal(p.groups.length,30); assert.ok(p.groups.every(g=>!g.issues.length));
  const review = buildRenewalPlan([fixture("review",{postStatus:"not_found",canPost:false})],now);
  assert.equal(review.groups[0].issues.length,2);
});
test("daily reporting counts each planned group once and never earlier activity", () => {
  const plan = buildRenewalPlan([fixture("ok"),fixture("other")],now);
  const run = { run_date:"2026-11-25",checked_at:now.toISOString(),plan };
  const event = (id,at,date="2026-11-25")=>({activity_date:date,occurred_at:at,metadata:{group_url:"https://www.facebook.com/groups/"+id+"/"}});
  const result = summarizeRenewalRun(run,[event("ok","2026-11-25T16:01:00Z"),event("ok","2026-11-25T16:02:00Z"),event("other","2026-11-25T15:00:00Z"),event("outside","2026-11-25T16:03:00Z"),event("other","2026-11-26T16:00:00Z","2026-11-26")]);
  assert.equal(result.recorded,1); assert.equal(result.queued,2);
});
test("London local day changes correctly in BST",()=>assert.equal(londonDay(new Date("2026-07-01T23:30:00Z")),"2026-07-02"));
