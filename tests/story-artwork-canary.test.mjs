import test from "node:test";
import assert from "node:assert/strict";
import {createCanaryHandler} from "../api/story-artwork-canary.js";
const env={VERCEL_ENV:"preview",VERCEL_PROJECT_ID:"prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl",VERCEL_GIT_COMMIT_REF:"ops/story-rollout-canary-20261102",VERCEL_URL:"canary.vercel.app"};
const req={method:"POST",headers:{host:env.VERCEL_URL},body:{brandKey:"vanFinance",confirmOneStory:true}};
const reply=()=>({setHeader(){},status(n){this.code=n;return this},json(v){this.body=v}});
test("canary refuses production, other branch/host and unconfirmed writes before reading anything",async()=>{
 let reads=0;const read=()=>{reads++;throw Error()};
 for(const change of [{VERCEL_ENV:"production"},{VERCEL_GIT_COMMIT_REF:"main"},{VERCEL_URL:"other.vercel.app"}]){
  const r=reply();await createCanaryHandler({env:{...env,...change},read})(req,r);assert.equal(r.code,404);
 }
 const r=reply();await createCanaryHandler({env,read})({...req,body:{brandKey:"vanFinance"}},r);assert.equal(r.code,400);assert.equal(reads,0);
});
test("canary creates only one verified Story without changing global flags; GET never composes",async()=>{
 let made=0;const r=reply();const handler=createCanaryHandler({env,read:async()=>[],settings:async()=>({enabled:true,vanFinanceStoriesPerDay:3}),
  now:()=>Date.parse("2026-11-02T09:00:00Z"),load:async()=>({imageSource:"first"}),compose:async(input,options)=>{
   assert.equal(options.env.STORY_ARTWORK_VFC_ENABLED,"true");assert.equal(env.STORY_ARTWORK_VFC_ENABLED,undefined);
   return {url:"verified",text:"current",vehicle:{supplierStockId:"supplier"}};
  },publish:async()=>{made++;return {id:"one",status:"scheduled"}}});
 await handler(req,r);assert.equal(r.code,200);assert.equal(made,1);assert.equal(r.body.created,true);
 const g=reply();await handler({...req,method:"GET",query:{brandKey:"vanFinance"}},g);assert.equal(made,1);assert.equal(g.code,200);
});
