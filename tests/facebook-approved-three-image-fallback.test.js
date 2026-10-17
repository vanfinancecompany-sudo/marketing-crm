import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { reviewedFacebookSecondaryImages, loadReviewedFacebookSecondaryImages } from "../lib/facebookApprovedImageFallback.js";
import { facebookVehicleImageUrls } from "../api/buffer-facebook-automation-worker.js";
import { buildBufferCreatePostInput } from "../lib/bufferPublishing.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID } from "../lib/dealerKitRent2BuyWixPlan.js";

const reg = "BD73DXK";
const primary = "https://static.wixstatic.com/media/branded-primary.jpg";
const media = ["one","two","three","four"].map((x,i) => ({
  supplier_stock_id: "stock-1", registration: reg, wix_site_id: VAN_FINANCE_RENT2BUY_WIX_SITE_ID,
  dealerkit_image_id: x, wix_url: "https://static.wixstatic.com/media/" + x + ".jpg",
  operation_status: i % 2 ? "PENDING" : "READY",
}));
const review = {
  registration: reg, supplier_stock_id: "stock-1", review_status: "reviewed",
  finance_enabled: true, rent2buy_enabled: true,
  image_order_ids: ["__VFC_PRODUCT_IMAGES__", "three","one","two","four","__R2B_PRODUCT_IMAGES__","two","one","four","three"],
  excluded_image_ids: ["__VFC_PRODUCT_IMAGES__", "four","__R2B_PRODUCT_IMAGES__","three"],
  primary_image_id: "three",
};

test("Finance standard Facebook post uses branded image plus first two reviewed eligible photos", () => {
  const approved = reviewedFacebookSecondaryImages({ productKey: "vanFinance", registration: reg, reviews: [review], importedMedia: media });
  assert.deepEqual(approved.slice(0,3), ["three","one","two"].map(x => "https://static.wixstatic.com/media/"+x+".jpg"));
  const postImages = facebookVehicleImageUrls({reg,picture:primary}, new Map([[reg,approved]]));
  assert.deepEqual(postImages, [primary, ...approved.slice(0,2)]);
  const payload = buildBufferCreatePostInput({destination:"Van Finance Facebook",text:"Van",mediaUrl:primary,mediaUrls:postImages,mediaKind:"image",draft:false});
  assert.equal(payload.assets.length,3);
  assert.deepEqual(payload.assets.map(a=>a.image.url),postImages);
});

test("Rent2Buy uses independent image exclusions and verified provenance", () => {
  const approved = reviewedFacebookSecondaryImages({ productKey: "rent2buy", registration: reg, reviews: [review], importedMedia: media });
  assert.deepEqual(approved.slice(0,3),["two","one","four"].map(x=>"https://static.wixstatic.com/media/"+x+".jpg"));
  const images = facebookVehicleImageUrls({reg,picture:primary},new Map([[reg,approved]]),approved);
  assert.deepEqual(images,[primary,...approved.slice(0,2)]);
});

test("Does not use another vehicle, Wix site, disabled lane, unreviewed data, excluded or unsafe media", () => {
  const opts={productKey:"vanFinance",registration:reg,reviews:[review],importedMedia:media};
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, reviews:[review,review]}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, reviews:[{...review,review_status:"needs_review"}]}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, reviews:[{...review,finance_enabled:false}]}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, registration:"XX99ZZZ"}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, importedMedia:media.map(m=>({...m,registration:"XX99ZZZ"}))}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, importedMedia:media.map(m=>({...m,wix_site_id:"another-site"}))}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, importedMedia:media.map(m=>({...m,operation_status:"UNVERIFIED"}))}),[]);
  assert.deepEqual(reviewedFacebookSecondaryImages({...opts, importedMedia:media.map(m=>({...m,wix_url:"http://invalid.local/x.jpg"}))}),[]);
});

test("Safe single-image fallback when only one real image exists", () => {
  const approved=reviewedFacebookSecondaryImages({productKey:"vanFinance",registration:reg,reviews:[review],importedMedia:[]});
  assert.deepEqual(approved,[]);
  assert.deepEqual(facebookVehicleImageUrls({reg,picture:primary},new Map()),[primary]);
});

test("Approved gallery loader is read-only, queries one reviewed vehicle only", async () => {
  const calls=[];
  const supabase={from(table){
    calls.push({table,filters:[]});
    const current=calls.at(-1);
    const query={
      select(){return query;},
      eq(k,v){current.filters.push([k,v]);return query;},
      limit(){return Promise.resolve({data:table==="dealerkit_review_decisions"?[review]:media,error:null});},
    };
    return query;
  }};
  const result=await loadReviewedFacebookSecondaryImages(supabase,"vanFinance",reg);
  assert.equal(result.length,3);
  assert.deepEqual(calls.map(c=>c.table),["dealerkit_review_decisions","dealerkit_wix_imported_media"]);
  assert.deepEqual(calls[1].filters,[["supplier_stock_id","stock-1"],["wix_site_id",VAN_FINANCE_RENT2BUY_WIX_SITE_ID]]);
});

test("Reel, story and Google Business posting paths remain untouched", () => {
  const source=fs.readFileSync(new URL("../api/buffer-facebook-automation-worker.js",import.meta.url),"utf8");
  assert.match(source,/loadReviewedFacebookSecondaryImages\(supabase, productKey, registration\)/);
  assert.match(source,/if \(mediaUrls\.length < 3\)/);
  assert.match(source,/async function createNextImagePost/);
  assert.match(source,/async function createNextReel/);
  assert.match(source,/async function createNextGoogleBusinessPost/);
  assert.doesNotMatch(fs.readFileSync(new URL("../api/youtube-daily-batch.js",import.meta.url),"utf8"), /facebookApprovedImageFallback/);
});
