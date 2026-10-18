import test from "node:test";
import assert from "node:assert/strict";
import { vanscoCleanupEligibleStock, vanscoSoldEquivalentStatus, vanscoLeaseSafeToRemove,
 cleanConfirmedSoldVanscoImages, planVanscoImageCleanup } from "../lib/vanscoSoldImageCleanup.js";
import { vanscoVehicleMediaToken, VANSCO_OWNED_BLOB_PREFIX, VANSCO_LEASE_PREFIX } from "../lib/vanscoSocialMediaHandoff.js";

const NOW=Date.parse("2026-12-01T12:00:00Z");
const OLD="2026-10-01T10:00:00Z";
const NEW="2026-11-20T10:00:00Z";
const ids=["c500e0856a9b0eef55ec3","c500e0856a9b10bf6e602","c500e0856a9b0dfdb8d26","c500e0856a9b0ccc63f5d"];
const item=(i,age=OLD)=>{
 const pathname=VANSCO_OWNED_BLOB_PREFIX+"/"+vanscoVehicleMediaToken(ids[i])+"/"+String(i+1).repeat(64)+".jpg";
 return {pathname,url:"https://test-storage.public.blob.vercel-storage.com/"+pathname,uploadedAt:age,size:250_000};
};
const row=(i,last_status,source_status,last_seen_at=OLD)=>({
 supplier_stock_id:ids[i],last_status,source_status,last_seen_at,updated_at:last_seen_at,source_updated_at:last_seen_at
});
function fixture(images,leaseByIndex={}){
 const deletions=[];
 const listImpl=async ({prefix})=>{
  if(prefix===VANSCO_OWNED_BLOB_PREFIX+"/")return {blobs:images,hasMore:false};
  const n=ids.findIndex(id=>prefix===VANSCO_LEASE_PREFIX+"/"+vanscoVehicleMediaToken(id)+"/");
  if(n<0)throw new Error("Unexpected cleanup inventory scope");
  return {blobs:(leaseByIndex[n]||[]).map(day=>({
   pathname:prefix+day+".json",
   url:"https://test-storage.public.blob.vercel-storage.com/"+prefix+day+".json",
  })),hasMore:false};
 };
 return {listImpl,delImpl:async url=>{deletions.push(url);},deletions};
}

test("Hard rule: Awaiting Delivery and Sold qualify, Reserved and missing never qualify",()=>{
 for(const status of ["Awaiting Delivery","awaiting_delivery","SOLD","sold"])assert.equal(vanscoSoldEquivalentStatus(status),true);
 for(const status of ["Reserved","available","unknown","missing","de-advertised","awaiting_stock",""])assert.equal(vanscoSoldEquivalentStatus(status),false);
 assert.equal(vanscoCleanupEligibleStock(row(0,"awaiting_delivery","Awaiting Delivery"),NOW),true);
 assert.equal(vanscoCleanupEligibleStock(row(0,"sold","Sold"),NOW),true);
 assert.equal(vanscoCleanupEligibleStock(row(0,"reserved","Reserved"),NOW),false);
 assert.equal(vanscoCleanupEligibleStock(row(0,"available","In Stock"),NOW),false);
 assert.equal(vanscoCleanupEligibleStock(row(0,"unknown","Awaiting Delivery"),NOW),false);
 assert.equal(vanscoCleanupEligibleStock(row(0,"sold","unknown"),NOW),false);
 assert.equal(vanscoCleanupEligibleStock(row(0,"awaiting_delivery","Awaiting Delivery",NEW),NOW),false);
});

test("Protected scheduled posts block removal until thirty days after latest scheduled calendar date",()=>{
 const prefix=VANSCO_LEASE_PREFIX+"/"+vanscoVehicleMediaToken(ids[0])+"/";
 const lease=day=>({pathname:prefix+day+".json"});
 assert.equal(vanscoLeaseSafeToRemove([lease("20261005")],NOW),true);
 assert.equal(vanscoLeaseSafeToRemove([lease("20261115")],NOW),false);
 assert.equal(vanscoLeaseSafeToRemove([lease("20261005"),lease("20261115")],NOW),false);
 assert.equal(vanscoLeaseSafeToRemove([lease("20261350")],NOW),false);
 assert.equal(vanscoLeaseSafeToRemove([lease("mystery")],NOW),false);
});

test("Sold and awaiting-delivery images are deleted only after expiry, not Reserved or unknown",async()=>{
 const images=[item(0),item(1),item(2),item(3)];
 const fx=fixture(images,{0:["20261005"],2:["20261005"],3:["20261005"]});
 const stockRows=[
  row(0,"awaiting_delivery","Awaiting Delivery"),
  row(1,"reserved","Reserved"),
  row(2,"sold","Sold"),
 ];
 const r=await cleanConfirmedSoldVanscoImages({stockRows,...fx,now:NOW,dryRun:false});
 assert.equal(r.deleted,2);
 assert.deepEqual(fx.deletions.sort(),[images[0].url,images[2].url].sort());
 assert.equal(r.scanned,4);
});

test("Dry run reports candidates but never deletes",async()=>{
 const fx=fixture([item(0)],{0:["20261005"]});
 const r=await cleanConfirmedSoldVanscoImages({stockRows:[row(0,"awaiting_delivery","Awaiting Delivery")],...fx,now:NOW,dryRun:true});
 assert.equal(r.eligible,1);
 assert.equal(r.deleted,0);
 assert.deepEqual(fx.deletions,[]);
});

test("Recent photos and upcoming scheduled leases survive even with old confirmed Sold status",async()=>{
 const fx=fixture([item(0,NEW),item(2)],{2:["20261115"]});
 const stockRows=[row(0,"sold","Sold"),row(2,"awaiting_delivery","Awaiting Delivery")];
 const r=await cleanConfirmedSoldVanscoImages({stockRows,...fx,now:NOW,dryRun:false});
 assert.equal(r.deleted,0);
 assert.deepEqual(fx.deletions,[]);
});

test("Never infer sold from disappearance; only explicit status is considered",async()=>{
 const fx=fixture([item(0)]);
 const r=await cleanConfirmedSoldVanscoImages({stockRows:[],...fx,now:NOW,dryRun:false});
 assert.equal(r.deleted,0);
});

test("Refuse incomplete or cross-brand blob inventory before deleting anything",async()=>{
 const url=item(0).url,stockRows=[row(0,"sold","Sold")];
 const fx=fixture([item(0)],{0:["20261001"]});
 for(const listImpl of [
  async()=>({blobs:[{pathname:"buffer-social-images/vfc.jpg",url,uploadedAt:OLD}],hasMore:false}),
  async()=>({blobs:[item(0)],hasMore:true}),
  async()=>({blobs:null,hasMore:false}),
 ]){
  await assert.rejects(cleanConfirmedSoldVanscoImages({stockRows,listImpl,delImpl:fx.delImpl,now:NOW,dryRun:false}),/unrelated|pagination|inventory/);
 }
 assert.equal(fx.deletions.length,0);
});

test("Safeguard rejects unsafe external deletion URLs",async()=>{
 const img={...item(0),url:"https://acdn.uk/vansco/i/source.jpeg"};
 const fx=fixture([img],{0:["20261001"]});
 await assert.rejects(planVanscoImageCleanup({stockRows:[row(0,"sold","Sold")],listImpl:fx.listImpl,now:NOW}),/deletion URL did not match/);
 assert.deepEqual(fx.deletions,[]);
});

test("Never delete pre-tracking legacy v1 images; cleanup only inventories v2",async()=>{
 const img=item(0);
 const seen=[];
 const listImpl=async ({prefix})=>{
  seen.push(prefix);
  if(prefix===VANSCO_OWNED_BLOB_PREFIX+"/")return {blobs:[img],hasMore:false};
  return {blobs:[],hasMore:false};
 };
 await cleanConfirmedSoldVanscoImages({stockRows:[row(0,"reserved","Reserved")],listImpl,now:NOW,dryRun:false,delImpl:async()=>{throw Error("would delete reserved")}});
 assert.equal(seen.length,1);
 assert.equal(seen[0],VANSCO_OWNED_BLOB_PREFIX+"/");
});
