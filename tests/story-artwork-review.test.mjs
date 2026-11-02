import test from "node:test";
import assert from "node:assert/strict";
import {createStoryArtworkReview} from "../api/story-artwork-review.js";
const env={VERCEL_ENV:"preview",VERCEL_PROJECT_ID:"prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl",
 VERCEL_URL:"marketing-review.vercel.app",VERCEL_GIT_COMMIT_SHA:"review-commit"};
const req={method:"GET",headers:{host:env.VERCEL_URL},query:{brandKey:"vansco",registration:"AB12CDE"}};
function reply(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v},send(v){this.body=v}}}
test("review cannot execute in production, on other projects/hosts, or through mutation requests",async()=>{
 let reads=0;const getSnapshot=()=>{reads++;throw Error("unexpected read")};
 for(const change of [{VERCEL_ENV:"production"},{VERCEL_ENV:undefined},{VERCEL_PROJECT_ID:"other"},{VERCEL_URL:""}]){
  const r=reply();await createStoryArtworkReview({env:{...env,...change},getSnapshot})(req,r);assert.equal(r.code,404);
 }
 for(const change of [{headers:{host:"custom.example"}},{method:"POST"}]){
  const r=reply();await createStoryArtworkReview({env,getSnapshot})({...req,...change},r);assert.ok([404,405].includes(r.code));
 }
 assert.equal(reads,0);
});
test("review uses authoritative Meta proof and stock then dry-run composer; output excludes private fields",async()=>{
 const meta={registration:"AB12CDE",storyMetaPrimaryImage:"https://acdn.uk/vansco/i/first.jpeg",vehicleId:"PRIVATE_SUPPLIER_ID"};
 const selected={source:{kind:"eligible_live_meta_first_image"},imageSource:meta.storyMetaPrimaryImage};
 let snapshots=0,loaded=0,composed=0;
 const r=reply();await createStoryArtworkReview({env,getSnapshot:async()=>{snapshots++;return {complete:true}},
  getMeta:async()=>[meta],loadVehicle:async(input,deps)=>{
   loaded++;assert.equal(input.vehicle,meta);assert.equal((await deps.getSnapshot()).complete,true);return selected;
  },compose:async(input,options)=>{
   composed++;assert.equal(options.dryRun,true);assert.equal(await options.loadVehicle(),selected);
   assert.throws(options.host,/upload_forbidden/);
   return {png:Buffer.from("PNG"),model:{title:"Real van",pricingMode:"none"},provenance:{sourceSha256:"photoHash"}};
  }})(req,r);
 assert.equal(r.code,200);assert.equal(r.body.metaPrimaryMatches,true);
 assert.equal(snapshots,1);assert.equal(loaded,1);assert.equal(composed,1);
 assert.equal(r.body.uploads,0);assert.equal(r.body.bufferWrites,0);
 assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_SUPPLIER_ID|password|secret/i);
});
test("review holds ambiguous Meta identity before composing and sanitizes unexpected errors",async()=>{
 const r=reply();await createStoryArtworkReview({env,getSnapshot:async()=>({}),getMeta:async()=>[],
  compose:()=>{throw Error("must not compose")}})(req,r);
 assert.equal(r.code,422);assert.equal(r.body.reason,"story_meta_identity_ambiguous");
 const s=reply();await createStoryArtworkReview({env,getSnapshot:()=>{throw Error("private secret")}})(req,s);
 assert.equal(s.body.reason,"story_review_held");assert.doesNotMatch(JSON.stringify(s.body),/private secret/);
});
