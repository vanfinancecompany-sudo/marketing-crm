import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {selectVerifiedPhotoReadyRecords} from "../lib/photoReadyVisibleRecords.js";

const records=["LO71OZK","HG21VPP","VK71PKE"].map((registration)=>({
 registration,pipeline:"finance",displayStatus:"images_ready",imageReadinessAlert:true
}));
const healthy={sourceAvailable:true,complete:true};

test("all three independently verified Finance alerts remain available when stock comparison is paused",()=>{
 const photo=selectVerifiedPhotoReadyRecords({records,summary:healthy,pipeline:"finance"});
 const positiveComparisonPaused=true;
 const stockRecords=positiveComparisonPaused?[]:[{registration:"STOCK"}];
 const displayed=[...photo,...stockRecords];
 assert.deepEqual(displayed.map(item=>item.registration),["LO71OZK","HG21VPP","VK71PKE"]);
});

test("photo alert remains fail-closed when DealerKit or Wix evidence is unavailable",()=>{
 for(const summary of [null,{sourceAvailable:false},{complete:false}]){
  assert.deepEqual(selectVerifiedPhotoReadyRecords({records,summary,pipeline:"finance"}),[]);
 }
 assert.deepEqual(selectVerifiedPhotoReadyRecords({records,summary:healthy,error:"Wix unavailable",pipeline:"finance"}),[]);
});

test("Finance, Rent2Buy and Cars photo-ready records do not leak into one another's lane",()=>{
 assert.equal(selectVerifiedPhotoReadyRecords({records,summary:healthy,pipeline:"rent2buy"}).length,0);
 assert.equal(selectVerifiedPhotoReadyRecords({records,summary:healthy,pipeline:"cars"}).length,0);
 assert.equal(selectVerifiedPhotoReadyRecords({records,summary:healthy,pipeline:"finance"}).length,3);
});

test("only confirmed photo-ready alerts are admitted, including saved workflow statuses",()=>{
 const mix=[
  {...records[0],displayStatus:"hidden"},
  {...records[1],imageReadinessAlert:false},
  {...records[2],pipeline:"rent2buy"},
 ];
 const filtered=selectVerifiedPhotoReadyRecords({records:mix,summary:healthy,pipeline:"finance"});
 assert.deepEqual(filtered.map(x=>x.registration),["LO71OZK"]);
 assert.equal(filtered[0].displayStatus,"hidden");
});

test("generated Stock Watch page renders verified photos independently and refreshes when clicked",()=>{
 const page=fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx",import.meta.url),"utf8");
 assert.match(page,/const visiblePhotoReadyRecords = useMemo\(\(\) => selectVerifiedPhotoReadyRecords/);
 assert.match(page,/\[\.\.\.visiblePhotoReadyRecords, \.\.\.\(positiveComparisonPaused \? \[\] : \[\.\.\.activeRecords/);
 assert.match(page,/void loadImageReadiness\(selectedPipeline\)/);
 assert.match(page,/value=\{imageReadyError \|\| imageReadySummary\?\.sourceAvailable === false/);
 assert.match(page,/filter.value === "images_ready" \?/);
 assert.match(page,/Stock comparison cards and dependent counts are paused/);
});
