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
import { dealerKitPublishedVehicleUrl } from "../utils/dealerKitSubmitVehicle.js";
import { controlledWixCreateId, controlledWixRequest, WIX_CMS_ITEM_LIMIT_MESSAGE } from "../api/_dealerkit-controlled-publish-state.js";
import { reconcileControlledTargets } from "../api/dealerkit-controlled-publish.js";
import { orderCarsManualMedia } from "../lib/dealerKitWixManualMedia.js";

test("publish success links use the three public vehicle routes", () => {
  assert.equal(dealerKitPublishedVehicleUrl("cars", "PE71 YTG"), "https://www.vanfinancecompany.co.uk/cars/pe71ytg");
  assert.equal(dealerKitPublishedVehicleUrl("finance", "BP73XHB"), "https://www.vanfinancecompany.co.uk/vans/bp73xhb");
  assert.equal(dealerKitPublishedVehicleUrl("rent2buy", "BJ72PLF"), "https://www.vanfinancecompany.co.uk/rent2buy/vans/bj72plf");
  assert.equal(dealerKitPublishedVehicleUrl("cars", "../admin"), null);
});

test("stable Wix create IDs collide only for the same site, collection and plate", () => {
  const id = controlledWixCreateId("site", "CARFINANCE", "AB22 CDE");
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(controlledWixCreateId("site", "CARFINANCE", "ab22cde"), id);
  assert.notEqual(controlledWixCreateId("site", "CARPAGES", "AB22CDE"), id);
  assert.notEqual(controlledWixCreateId("site", "CARFINANCE", "AB22CDF"), id);
  assert.notEqual(controlledWixCreateId("other-site", "CARFINANCE", "AB22CDE"), id);
});

test("Wix CMS capacity errors stop writes, preserve rollback and exclude rate limits", async () => {
  const configuration = {apiBaseUrl:"https://fixture.test",siteId:"fixture",apiKey:"fixture"};
  const target = {collectionId:"CARFINANCE",operation:"create"};
  let requests=0;
  const quota = () => controlledWixRequest(configuration,"/wix-data/v2/items",{
    request:async()=>{requests++;return Response.json({details:{applicationError:{code:"ITEM_COUNT_QUOTA_EXCEEDED",description:"Maximum number of data items reached"}}},{status:429});}
  });
  let rolledBack=false;
  await assert.rejects(reconcileControlledTargets({configuration},"AB22CDE",[target,target,target],{
    applyTarget:async()=>{if(!requests++){return {itemId:"new-row"};}return quota();},
    rollbackCreatedAndUpdated:async(_state,writes)=>{assert.equal(writes.length,1);rolledBack=true;return [{rolledBack:true}];},
    rollbackPublishStatuses:async()=>[],
  }),error=>error.message===WIX_CMS_ITEM_LIMIT_MESSAGE&&error.details.code==="wix_cms_item_limit");
  assert.equal(requests,3);
  assert.equal(rolledBack,true);
  await assert.rejects(controlledWixRequest(configuration,"/wix-data/v2/items",{
    request:async()=>Response.json({message:"WDE0014: Requests per minute quota exceeded."},{status:429})
  }),error=>error.status===429&&error.details.code!=="wix_cms_item_limit");
});

test("Cars preserves staged order as new images append, only promoting the selected READY primary", () => {
  const item = (id, date, extra={})=>({id,createdAt:date,ready:true,url:"https://fixture.test/"+id,...extra});
  const older=item("old","2026-11-15T10:00:00Z");
  const previous=item("previous","2026-11-15T10:01:00Z");
  const latest=item("latest","2026-11-16T10:01:00Z");
  const primary=item("primary","2026-11-16T10:02:00Z",{selected:true});
  const processing=item("processing","2026-11-16T10:03:00Z",{ready:false});
  const rows=[processing,primary,latest,previous,older];
  assert.deepEqual(orderCarsManualMedia(rows).map(row=>row.id),["old","previous","latest","primary","processing"]);
  const {imageSet}=buildCarImageSet({}, {}, [], rows);
  assert.equal(imageSet.listingImageUrl,primary.url);
  assert.deepEqual(imageSet.galleryUrls,[primary.url,older.url,previous.url,latest.url]);
});

test("a DealerKit source change discovered after photo staging aborts publication", async () => {
  let reads=0;
  const harness=runHarness({read:async()=>++reads===1
    ? {plan:{canPublish:true,confirmation}}
    : {plan:{blockers:[{code:"stale_review",message:"DealerKit changed after the saved review."}]}}});
  await assert.rejects(harness.result,/DealerKit changed/);
  assert.deepEqual(harness.events,["save","upload"]);
});
