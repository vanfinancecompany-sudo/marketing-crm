import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  verifiedRent2BuyManifest,
  decodeVerifiedRent2BuyQuoteSnapshot,
  loadLatestVerifiedRent2BuyQuoteSnapshot,
  captureCompleteRent2BuyQuoteSnapshot,
  Rent2BuySnapshotUnavailable,
} from "../api/_rent2buy-complete-quote-snapshot.mjs";

const now=Date.UTC(2026,9,23,15,0,0);
const checked=new Date(now-12_000).toISOString();
const cars=[
  {registration:"ZZ25 XYZ",supplierStockId:"a1",status:"available",sourceStatus:"In stock",
   year:2025,mileage:12000,retailPrice:12000,vatStatus:"plus_vat",sourceUpdatedAt:checked},
  {registration:"FV74 BBJ",supplierStockId:"b2",status:"reserved",sourceStatus:"Reserved",
   year:2024,mileage:50000,retailPrice:14695,vatStatus:"plus_vat",sourceUpdatedAt:checked},
];
const original=()=>({
  complete:true,checkedAt:checked,vehicleCount:2,
  diagnostics:{complete:true,stableReportedTotal:true,apiReportedTotal:2,
   failedPositions:[],invalidRecords:[],duplicateRegistrations:[],duplicateSupplierStockIds:[]},
  refresh:{status:"complete"},vehicles:cars,
});
const row=()=>({...verifiedRent2BuyManifest(original(),{now}),captured_at:new Date(now-8000).toISOString()});
const rejection=(f,code)=>assert.throws(f,e=>e instanceof Rent2BuySnapshotUnavailable&&e.code===code);

test("a complete stable Stock Watch snapshot creates a minimal reproducible manifest",()=>{
 const result=verifiedRent2BuyManifest(original(),{now});
 assert.equal(result.stock_count,2);
 assert.equal(result.vehicle_manifest[0].registration,"FV74BBJ");
 assert.equal(result.vehicle_manifest[1].registration,"ZZ25XYZ");
 assert.match(result.snapshot_digest,/^[a-f0-9]{64}$/);
 assert.equal(result.vehicle_manifest[0].status,"reserved");
 assert.equal(Object.hasOwn(result.vehicle_manifest[0],"images"),false);
});

test("capture refuses incomplete, duplicate or inconsistent stock without a DB write",async()=>{
 for(const bad of [
  {...original(),complete:false},
  {...original(),diagnostics:{...original().diagnostics,complete:false}},
  {...original(),diagnostics:{...original().diagnostics,apiReportedTotal:201}},
  {...original(),diagnostics:{...original().diagnostics,duplicateRegistrations:[{registration:"ZZ25XYZ"}]}},
  {...original(),vehicles:[cars[0],{...cars[1],registration:cars[0].registration}]},
 ]){
  rejection(()=>verifiedRent2BuyManifest(bad,{now}),
    bad.diagnostics?.apiReportedTotal!==2?"inconsistent_source_total":
    bad.complete===true&&bad.diagnostics?.complete===true&&
    (!bad.diagnostics.duplicateRegistrations?.length)?"ambiguous_stock_identity":"incomplete_or_ambiguous_snapshot");
 }
 let writes=0;
 const fakeDb={from:()=>({insert:async()=>{writes++;return {error:null}}})};
 await assert.rejects(captureCompleteRent2BuyQuoteSnapshot(fakeDb,
   {...original(),refresh:{status:"partial"}},{now}));
 assert.equal(writes,0);
});

test("short-lived snapshot round-trips without making another full DealerKit request",()=>{
 const decoded=decodeVerifiedRent2BuyQuoteSnapshot(row(),{now});
 assert.equal(decoded.diagnostics.complete,true);
 assert.equal(decoded.refresh.status,"complete");
 assert.equal(decoded.vehicles[0].registration,"FV74BBJ");
 assert.equal(decoded.vehicles[1].status,"available");
});
test("stale, future, corrupt and duplicate rows fail closed instead of serving last-known stock",()=>{
 rejection(()=>decodeVerifiedRent2BuyQuoteSnapshot(row(),{now:now+91_000}),"stale_snapshot");
 rejection(()=>decodeVerifiedRent2BuyQuoteSnapshot({...row(),snapshot_checked_at:new Date(now+60_000).toISOString()},{now}),"stale_snapshot");
 rejection(()=>decodeVerifiedRent2BuyQuoteSnapshot({...row(),stock_count:10},{now}),"corrupt_snapshot");
 rejection(()=>decodeVerifiedRent2BuyQuoteSnapshot({...row(),snapshot_digest:"x".repeat(64)},{now}),"corrupt_snapshot");
 const dup={...row()};
 dup.vehicle_manifest=[dup.vehicle_manifest[0],dup.vehicle_manifest[0]];
 rejection(()=>decodeVerifiedRent2BuyQuoteSnapshot(dup,{now}),"corrupt_snapshot");
});
test("read-only latest snapshot requires database table and fresh committed record",async()=>{
 const captured=row();let ordered=false,limit=0;
 const db={from:table=>{
  assert.equal(table,"dealerkit_rent2buy_quote_snapshots");
  return {select:()=>{
   return {order:(field,opts)=>{assert.equal(field,"snapshot_checked_at");
    assert.equal(opts.ascending,false);ordered=true;
    return {limit:n=>{limit=n;return {maybeSingle:async()=>({data:captured,error:null})}}}
   }};
  }};
 }};
 const found=await loadLatestVerifiedRent2BuyQuoteSnapshot(db,{now});
 assert.equal(found.vehicles.length,2);assert.ok(ordered);assert.equal(limit,1);
 const missing={from:()=>({select:()=>({order:()=>({limit:()=>({maybeSingle:async()=>({data:null,error:{code:"PGRST205"}})})})})})};
 await assert.rejects(loadLatestVerifiedRent2BuyQuoteSnapshot(missing,{now}),e=>e.code==="snapshot_storage_unavailable");
});
test("Stock Watch capture is feature-flagged and quote reads cannot call bulk DealerKit",()=>{
 const watch=fs.readFileSync(new URL("../api/dealerkit-stock-watch-session.js",import.meta.url),"utf8");
 const source=fs.readFileSync(new URL("../api/_rent2buy-quote-source.js",import.meta.url),"utf8");
 assert.match(watch,/RENT2BUY_QUOTE_SNAPSHOT_CAPTURE_ENABLED === "true"/);
 assert.match(watch,/captureQuoteSnapshot\(supabase, snapshot\)/);
 assert.match(watch,/snapshot.complete !== true/);
 assert.match(source,/getSnapshot=loadLatestVerifiedRent2BuyQuoteSnapshot/);
 assert.doesNotMatch(source,/fetchDealerKitStockSnapshot|fetchStableDealerKitStockSnapshot/);
 assert.match(source,/fetchDealerKitStockDetail/);
});
