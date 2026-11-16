import test from "node:test";
import assert from "node:assert/strict";
import { submitDealerKitVehicle } from "../utils/dealerKitSubmitVehicle.js";
import { buildCarImageSet, controlledCarWixConfiguration } from "../api/_dealerkit-car-controlled-publish-state.js";
import { buildDealerKitCarWixPlan } from "../lib/dealerKitCarWixPlan.js";
import { manualMediaSiteConfiguration } from "../lib/dealerKitWixManualMedia.js";

const confirmation = { fingerprint: "server-confirmation" };
function runHarness(overrides = {}) {
  const events = [];
  const steps = [];
  const ready = { plan: { canPublish: true, confirmation }, media: {} };
  return {
    events,
    steps,
    result: submitDealerKitVehicle({
      save: async () => events.push("save"),
      upload: async () => events.push("upload"),
      read: async () => { events.push("read"); return ready; },
      prepare: async () => events.push("prepare"),
      publish: async plan => { events.push("publish"); assert.equal(plan.confirmation, confirmation); return { verified: true }; },
      status: message => steps.push(message),
      wait: async () => events.push("wait"),
      isCurrent: () => true,
      ...overrides,
    }),
  };
}

for (const lane of ["finance", "rent2buy", "cars"]) {
  for (const writeIntent of ["create_new_vehicle", "update_existing_vehicle"]) {
    test(lane + " submits " + writeIntent + " exactly once through a fresh confirmed plan", async () => {
      let calls = 0;
      const runner = runHarness({
        read: async () => ({plan:{mode:lane,writeIntent,canPublish:true,confirmation}}),
        publish: async plan => { calls++; assert.equal(plan.writeIntent, writeIntent); assert.equal(plan.mode,lane); return {verified:true}; },
      });
      await runner.result;
      assert.equal(calls,1);
      assert.deepEqual(runner.steps,["Saving vehicle","Preparing photographs","Publishing and verifying advert"]);
    });
  }
}

test("missing imports prepare once and processing is polled before publishing", async () => {
  const states = [
    { plan: { blockers:[{code:"vfc_media_not_prepared"}] }, media: {unpreparedDealerKitImageIds:["1"]} },
    { plan: { blockers:[{code:"vfc_media_not_prepared"}] }, media: {unpreparedDealerKitImageIds:["1"]} },
    { plan: { blockers:[{code:"vfc_media_not_ready"}] }, media: {processingDealerKitImageIds:["1"]} },
    { plan: { canPublish:true, confirmation }, media:{} },
  ];
  const runner=runHarness({read:async()=>states.shift()});
  await runner.result;
  assert.deepEqual(runner.events,["save","upload","prepare","wait","publish"]);
});

test("a duplicate, upload failure, capacity error or failed rollback does not trigger a second publish", async()=>{
  let writes=0;
  const duplicate=runHarness({read:async()=>({plan:{blockers:[{code:"car_listing_ambiguous",message:"Duplicate Wix record"}]}}),publish:async()=>{writes++;}});
  await assert.rejects(duplicate.result,/Duplicate Wix record/);
  const upload=runHarness({upload:async()=>{throw Error("Primary photo failed");},publish:async()=>{writes++;}});
  await assert.rejects(upload.result,/Preparing photographs: Primary photo failed/);
  for(const message of ["Wix CMS item limit reached","Reconciliation unsuccessful. At least one rollback needs manual attention."]){
    await assert.rejects(runHarness({publish:async()=>{writes++;throw Error(message);}}).result, {message:"Publishing and verifying advert: "+message});
  }
  assert.equal(writes,2);
});

test("a verified advert with partial secondary media is surfaced as such", async()=>{
  const result=await runHarness({publish:async()=>({verified:true,galleryComplete:false})}).result;
  assert.equal(result.galleryComplete,false);
  await assert.rejects(runHarness({publish:async()=>({verified:false,message:"Could not verify publication"})}).result,/Could not verify/);
});

test("manual Cars primary reaches both new and existing records and never falls back while pending",()=>{
  const vehicle={registration:"AB22CDE",supplierStockId:"car-1",make:"Ford",model:"Focus",year:2022,mileage:26000,retailPrice:13000,status:"available"};
  const decision={registration:vehicle.registration,persisted:true,reviewStatus:"reviewed"};
  const cover="https://static.wixstatic.com/media/car-cover.jpg";
  const other="https://static.wixstatic.com/media/car-other.jpg";
  const manual=[{ready:true,url:other},{ready:true,url:cover,selected:true}];
  const {imageSet}=buildCarImageSet(vehicle,decision,[],manual);
  assert.deepEqual(imageSet.galleryUrls,[cover,other]);
  assert.equal(imageSet.mainSource,"manual_replacement");
  for(const update of [false,true]){
    const listing=update?[{id:"listing"}]:[];
    const details=update?[{id:"detail"}]:[];
    const plan=buildDealerKitCarWixPlan({vehicle,decision,imageSet,carListingRows:listing,carDetailRows:details});
    assert.equal(plan.canPublish,true,JSON.stringify(plan.blockers));
    assert.equal(plan.targets.find(item=>item.collectionId==="CARFINANCE").data.picture,cover);
    assert.deepEqual(plan.targets.find(item=>item.collectionId==="CARPAGES").data.mainImages,[cover,other]);
    assert.equal(plan.writeIntent,update?"update_existing_vehicle":"create_new_vehicle");
  }
  assert.equal(buildCarImageSet(vehicle,decision,[],[{selected:true,ready:false,url:cover}]).imageSet.ready,false);
  const env={WIX_API_KEY:"van-key",WIX_SITE_ID:"van-site",WIX_CAR_API_KEY:"car-key",WIX_CAR_SITE_ID:"car-site"};
  assert.equal(manualMediaSiteConfiguration("cars_replacement",env).siteId,controlledCarWixConfiguration(env).siteId);
  assert.equal(manualMediaSiteConfiguration("van_finance_replacement",env).siteId,"van-site");
});
