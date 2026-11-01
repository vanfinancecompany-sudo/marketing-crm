import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Resvg} from "@resvg/resvg-js";
import {storyArtworkEnabled,ownedStoryArtworkUrl} from "../lib/storyArtworkPolicy.js";
import {publishedStoryVehicle,verifyStoryStock,vanscoStoryVehicle,boundedStoryGet,verifiedStoryPhoto,signedStoryRentalPricing} from "../lib/storyArtworkSources.mjs";
import {prepareSelectedStoryArtwork,loadCurrentStoryVehicle,assertCurrentStoryArtworkStock} from "../api/_story-artwork.js";
import {hostStoryArtwork,inspectOwnedStoryArtwork} from "../lib/storyArtworkStorage.mjs";
import {renderApprovedStory} from "../lib/storyArtworkRenderer.mjs";
import {buildStoryModel} from "../tools/story-previews/template.mjs";
import {signRent2BuyQuote} from "../lib/rent2BuyQuoteHandoff.mjs";
import {rent2BuyPricingSourceRevision} from "../lib/rent2BuyCurrentSourceQuote.mjs";
import {quoteRent2BuyMatrix} from "../lib/rent2BuyFlexiblePricing.mjs";
import {BUFFER_FACEBOOK_CHANNELS} from "../lib/bufferPublishing.js";
import * as guard from "../lib/bufferRuntimeGuard.js";
const reg="AB12CDE",id="supplier1234",first="https://acdn.uk/vansco/i/first.jpeg",second="https://acdn.uk/vansco/i/second.jpeg";
const photo=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#68a"/></svg>').render().asPng();
const response=(bytes=photo,type="image/png")=>new Response(bytes,{headers:{"content-type":type}});
const vehicle={registration:reg,supplierStockId:id,title:"Nissan Primastar 2.0 dCi 30 Visia",
 year:2024,mileage:40000,fuel:"Diesel",transmission:"Manual",price:14695,vatLabel:"+ VAT",
 imageSource:first,photoRegistration:reg,status:"available",vehicleUrl:"https://www.vanfinancecompany.co.uk/vans/ab12cde",
 source:{checkedAt:new Date().toISOString()}};
const schema=(brand="vanFinance",changes={})=>'<script type="application/ld+json">'+JSON.stringify({
 "@type":"Vehicle",sku:reg,url:brand==="vanFinance"?vehicle.vehicleUrl:"https://www.rent2buyvans.co.uk/van-pages/ab12cde",
 name:vehicle.title,vehicleModelDate:"2024",image:[first,second],...changes})+'</script>';
const snapshot={complete:true,vehicles:[{registration:reg,supplierStockId:id,status:"available"}]};
const detail={registration:reg,supplierStockId:id,status:"available"};
const vansco={...vehicle,vehicleId:id,vehicleKey:id,availability:"AVAILABLE",imageUrl:first,imageUrls:[first,second],
 storyMetaPrimaryImage:first,storyMetaVehicleId:id,branchKey:"southamptonAirport",vehicleUrl:"https://www.vansco.co.uk/used-vans/test",price:"14695 GBP"};
const hash=x=>createHash("sha256").update(x).digest("hex");
const hostedUrl=(brand= "vanFinance",r=reg,png=photo)=>"https://test.public.blob.vercel-storage.com/story-artwork/v1/"+brand+"/"+r+"/"+hash(id)+"/"+hash(png)+".png";

test("per-brand rollout defaults OFF and requires exact true",()=>{
 for(const brand of ["vanFinance","rent2buy","vansco"]){assert.equal(storyArtworkEnabled(brand,{}),false)}
 assert.equal(storyArtworkEnabled("vanFinance",{STORY_ARTWORK_VFC_ENABLED:"TRUE"}),false);
 assert.equal(storyArtworkEnabled("vanFinance",{STORY_ARTWORK_VFC_ENABLED:"true"}),true);
 assert.equal(storyArtworkEnabled("rent2buy",{STORY_ARTWORK_VFC_ENABLED:"true"}),false);
});
for(const brand of ["vanFinance","rent2buy"]){
 test(brand+" uses that site's image[0], not image[1] or shared DealerKit primary",async()=>{
  const result=await loadCurrentStoryVehicle({brandKey:brand,registration:reg},{
   getSnapshot:async()=>snapshot,getDetail:async()=>({...detail,images:[{url:second}]}),
   fetchImpl:async()=>response(schema(brand),"text/html")});
  assert.equal(result.imageSource,first);assert.equal(result.supplierStockId,id);
  assert.equal(result.source.galleryCount,2);
 });
}
test("website first frame cannot be skipped when invalid; duplicate/wrong/archive pages hold",()=>{
 assert.throws(()=>publishedStoryVehicle(schema("vanFinance",{image:["http://127.0.0.1/a",second]}),"vanFinance",reg));
 for(const html of [schema()+schema(),schema("vanFinance",{sku:"XY34ZZZ"}),schema("vanFinance",{description:"Previously listed vehicle"}),
 schema("vanFinance",{offers:{availability:"https://schema.org/OutOfStock"}})]){
  assert.throws(()=>publishedStoryVehicle(html,"vanFinance",reg));
 }
});
test("Vansco current Meta first wins and never old stored/secondary photos",()=>{
 assert.equal(vanscoStoryVehicle(vansco,detail).imageSource,first);
 assert.throws(()=>vanscoStoryVehicle({...vansco,imageUrls:[second,first]},detail));
 assert.throws(()=>vanscoStoryVehicle({...vansco,storyMetaPrimaryImage:""},detail));
 assert.throws(()=>vanscoStoryVehicle({...vansco,vehicleId:"other"},detail));
});
test("sold, reserved, deposit and ambiguous supplier identities fail closed",()=>{
 for(const status of ["sold","reserved","deposit_taken","due_in","unknown"]){
  assert.throws(()=>verifyStoryStock(reg,snapshot,{...detail,status}));
  assert.throws(()=>verifyStoryStock(reg,{...snapshot,vehicles:[{...snapshot.vehicles[0],status}]},detail));
 }
 assert.throws(()=>verifyStoryStock(reg,{complete:false,vehicles:snapshot.vehicles},detail));
 assert.throws(()=>verifyStoryStock(reg,{...snapshot,vehicles:[...snapshot.vehicles,...snapshot.vehicles]},detail));
 assert.throws(()=>verifyStoryStock(reg,snapshot,{...detail,supplierStockId:"other"}));
 assert.throws(()=>verifyStoryStock(reg,snapshot,detail,"other"));
});
test("bounded fetch rejects SSRF, unsafe redirects, oversize, non-raster/incomplete bytes",async()=>{
 for(const url of ["http://acdn.uk/vansco/i/a.jpg","https://127.0.0.1/x","https://acdn.uk/elsewhere/a.jpg","https://static.wixstatic.com@evil.test/media/a"]){
  await assert.rejects(boundedStoryGet(url,{image:true,fetchImpl:()=>{throw Error("must not fetch")}}));
 }
 let options;
 await boundedStoryGet(first,{image:true,fetchImpl:async(_,o)=>{options=o;return response()}});
 assert.equal(options.redirect,"error");assert.equal(options.method,"GET");
 await assert.rejects(boundedStoryGet(first,{image:true,maxBytes:10,fetchImpl:async()=>response()}),/too_large/);
 assert.throws(()=>verifiedStoryPhoto({bytes:Buffer.from("<svg/>"),type:"image/png"}));
 assert.throws(()=>verifiedStoryPhoto({bytes:photo.subarray(0,30),type:"image/png"}));
 assert.equal(verifiedStoryPhoto({bytes:photo,type:"image/png"}).sha256,hash(photo));
});
test("ordinary rental amounts need signed quote AND current source, otherwise generic; protected table wins",()=>{
 assert.equal(signedStoryRentalPricing(reg,{token:"unsigned",manualSpecialStatus:"none"}),undefined);
 const ordinary=buildStoryModel("rent2buy",{...vehicle,vehicleUrl:"https://www.rent2buyvans.co.uk/van-pages/ab12cde"});
 assert.equal(ordinary.headline,"See rental options");
 for(const [registration,monthly]of [["FV74BBJ",545],["FV74BEO",595],["BT25LVK",595],["BJ74HTL",595]]){
  const m=buildStoryModel("rent2buy",{...vehicle,registration,photoRegistration:registration,
   rentalPricing:{quote:{monthlyExVat:1}},vehicleUrl:"https://www.rent2buyvans.co.uk/van-pages/"+registration.toLowerCase()});
  assert.match(m.headline,new RegExp("£"+monthly));assert.ok(m.details.includes("£2,000 + VAT initial · 48 months"));
  assert.ok(!m.details.some(x=>/miles per month/.test(x)));
 }
});
test("Vansco unresolved VAT, branch, conflict and invalid price hold; VFC has no invented finance figures",()=>{
 for(const change of [{vatLabel:""},{branchKey:"unknown"},{branchConflict:true},{price:0}]){
  assert.throws(()=>buildStoryModel("vansco",{...vehicle,...vansco,...change,price:change.price??14695}));
 }
 const m=buildStoryModel("vanFinance",vehicle);
 assert.doesNotMatch(JSON.stringify(m),/guaranteed|approved|APR|£99|per month/i);
});
test("disabled path does no source/render/hosting work; dry run NEVER writes Blob",async()=>{
 const fail=()=>{throw Error("unexpected write/read")};
 assert.equal(await prepareSelectedStoryArtwork({brandKey:"vanFinance"},{env:{},loadVehicle:fail,render:fail,host:fail}),null);
 const rendered=await prepareSelectedStoryArtwork({brandKey:"vanFinance",dueAt:new Date().toISOString()},
  {dryRun:true,loadVehicle:async()=>vehicle,fetchImpl:async()=>response(),host:fail});
 assert.equal(rendered.png.readUInt32BE(16),1080);assert.equal(rendered.png.readUInt32BE(20),1920);
 assert.ok(rendered.png.length<=4_000_000);assert.equal(rendered.provenance.firstImageIndex,0);
 assert.ok(rendered.svg.includes("Van Finance Company"));
});
test("source/renderer/hosting errors do not return publishable URLs",async()=>{
 const opts={env:{STORY_ARTWORK_VFC_ENABLED:"true"},loadVehicle:async()=>vehicle,fetchImpl:async()=>response(),
  render:async()=>({png:photo}),host:async()=>{throw Error("storage failed")}};
 await assert.rejects(prepareSelectedStoryArtwork({brandKey:"vanFinance"},opts),/storage failed/);
 await assert.rejects(prepareSelectedStoryArtwork({brandKey:"vanFinance"},{...opts,fetchImpl:async()=>response("bad")}));
});
test("immutable hosting verifies all bytes, records exact brand/vehicle provenance and leases; caps/outages fail closed",async()=>{
 const {png}=await renderApprovedStory(buildStoryModel("vanFinance",vehicle),{photoDataUrl:verifiedStoryPhoto({bytes:photo,type:"image/png"}).dataUrl});
 const args={brandKey:"vanFinance",registration:reg,supplierStockId:id,png,provenance:{firstImageIndex:0,firstImageUrl:first},dueAt:new Date().toISOString()};
 const puts=[];
 const opts={headImpl:async()=>{const e=Error("missing");e.name="BlobNotFoundError";throw e},
  listImpl:async()=>({blobs:[],hasMore:false}),
  putImpl:async(path,body,options)=>{puts.push({path,body,options});return {url:"https://test.public.blob.vercel-storage.com/"+path}},
  fetchImpl:async()=>response(png)};
 const result=await hostStoryArtwork(args,opts);
 assert.equal(puts.length,3);assert.ok(puts.every(p=>p.options.allowOverwrite===false));
 assert.equal(result.sha256,hash(png));assert.match(puts[1].body,/firstImageIndex/);assert.match(puts[2].body,/retainUntil/);
 assert.equal(ownedStoryArtworkUrl(result.url,"rent2buy",reg),"");
 assert.equal(ownedStoryArtworkUrl(result.url,"vanFinance","XY34ZZZ"),"");
 await assert.rejects(inspectOwnedStoryArtwork(result.url,"vanFinance",reg,{fetchImpl:async()=>response(photo)}),/bytes_changed/);
 let writes=0;
 await assert.rejects(hostStoryArtwork(args,{...opts,listImpl:async()=>({blobs:[{pathname:"story-artwork/v1/vanFinance/x",size:1_000_000_000}],hasMore:false}),
  putImpl:async()=>{writes++}}),/cap_reached/);
 assert.equal(writes,0);
 await assert.rejects(hostStoryArtwork(args,{...opts,headImpl:async()=>{throw Error("permissions")}}),/permissions/);
 await assert.rejects(hostStoryArtwork(args,{...opts,listImpl:async()=>({blobs:[],hasMore:true})}),/incomplete/);
});

// Actual existing Facebook worker, with Buffer and artwork boundaries mocked.
// Existing slot / duplicate / queue functions remain real.
let bufferInputs=[],artworkCalls=[],artworkFails=false,handoffSkips=[];
mock.module("../api/_story-artwork.js",{namedExports:{
 loadCurrentStoryVehicle,assertCurrentStoryArtworkStock,
 prepareSelectedStoryArtwork:async input=>{
  artworkCalls.push(input);if(artworkFails)throw Error("story_stock_unavailable");
  return {url:hostedUrl(input.brandKey,input.registration),text:"CURRENT STORY\nREGISTRATION: "+input.registration+"\nSee rental options",
   provenance:{firstImageIndex:0}};
 },
}});
mock.module("../lib/bufferRuntimeGuard.js",{namedExports:{...guard,
 guardedBufferGraphql:async({variables,skipImageHandoff})=>{
  handoffSkips.push(skipImageHandoff);
  const input=variables.input;bufferInputs.push(input);
  return {data:{createPost:{post:{...input,id:"new"+bufferInputs.length,status:"scheduled",assets:[{mimeType:"image/png",source:input.assets[0].image.url}]}}}};
 },
}});
const {createNextStory}=await import("../api/buffer-facebook-story-automation.js");
for(const productKey of ["vanFinance","rent2buy"]){
 test("actual "+productKey+" worker replaces only selected Story media/caption, at most one slot",async()=>{
  process.env.BUFFER_API_KEY="mock";
  const flag=productKey==="vanFinance"?"STORY_ARTWORK_VFC_ENABLED":"STORY_ARTWORK_RENT2BUY_ENABLED";
  process.env[flag]="true";bufferInputs=[];artworkCalls=[];artworkFails=false;
  const channelId=BUFFER_FACEBOOK_CHANNELS[productKey==="vanFinance"?"Van Finance Facebook":"Rent2Buy Facebook"];
  const post={id:"source",text:"OLD £693 RENTAL\nREGISTRATION: AB12CDE\n",channelId,status:"scheduled",
    dueAt:"2026-11-02T09:00:00.000Z",assets:[{mimeType:"image/jpeg",source:second}]};
  const args={posts:[post],productKey,dateKey:"2026-11-02",now:Date.parse("2026-11-02T08:00:00Z"),storyTarget:3};
  const result=await createNextStory(args);
  assert.equal(result.created,true);assert.equal(bufferInputs.length,1);assert.equal(artworkCalls.length,1);
  assert.equal(artworkCalls[0].registration,reg);assert.equal(bufferInputs[0].channelId,channelId);
  assert.equal(bufferInputs[0].dueAt,productKey==="vanFinance"?"2026-11-02T10:15:00.000Z":"2026-11-02T10:25:00.000Z");
  assert.equal(bufferInputs[0].metadata.facebook.type,"story");assert.equal(handoffSkips.at(-1),true);assert.doesNotMatch(bufferInputs[0].text,/693/);
  assert.equal(bufferInputs[0].assets[0].image.url,hostedUrl(productKey,reg));
  artworkFails=true;bufferInputs=[];
  const held=await createNextStory({...args,posts:[post]});
  assert.equal(held.skipped,"story_artwork_held");assert.equal(bufferInputs.length,0);
  bufferInputs=[];artworkCalls=[];
  const full=await createNextStory({...args,posts:Array.from({length:35},()=>post)});
  assert.equal(full.skipped,"buffer_queue_full");assert.equal(artworkCalls.length,0);
  delete process.env[flag];
 });
}
test("integration preserves approved designs, schedules, non-Story publishing and explicit deployment block",async()=>{
 const config=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
 assert.equal(config.git.deploymentEnabled["codex/story-artwork-publishing-integration"],false);
 const runtime=await readFile(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
 assert.match(runtime,/storyArtwork = null/);
 const worker=await readFile(new URL("../api/vansco-facebook-story-automation-worker.js",import.meta.url),"utf8");
 assert.match(worker,/storyPrimaryProof: storyArtworkEnabled\("vansco"\)/);
 assert.match(worker,/MIN_SCHEDULE_LEAD_MS = 8 \* 60 \* 1000/);
 const instagram=await readFile(new URL("../api/buffer-instagram-mirror.js",import.meta.url),"utf8");
 assert.match(instagram,/mirror.mediaKind === "story" && ownedStoryArtworkUrl/);
 assert.match(instagram,/\[original, mirror.mediaUrl\]/);
});

test("actual Vansco Story runtime preserves channel/date and bypasses raw-image handoff only for verified owned artwork",async()=>{
 const {createVanscoFacebookStory}=await import("../api/_vansco-buffer-runtime.js");
 let inputs=[],raw=0;
 const request=async(_,vars)=>{inputs.push(vars.input);return {data:{createPost:{post:{id:"vansco-new"}}}}};
 const args={config:{channelId:"existing-vansco"},text:"Current van",imageUrl:first,vehicleId:id,
  dueAt:"2026-11-02T12:45:00.000Z",request,prepareImages:async urls=>{raw++;return urls}};
 await createVanscoFacebookStory(args);assert.equal(raw,1);
 await createVanscoFacebookStory({...args,storyArtwork:{url:hostedUrl("vansco"),model:{registration:reg},vehicle:{supplierStockId:id}}});
 assert.equal(raw,1);assert.equal(inputs.length,2);
 assert.equal(inputs[1].channelId,args.config.channelId);assert.equal(inputs[1].dueAt,args.dueAt);
 assert.equal(inputs[1].metadata.facebook.type,"story");assert.equal(inputs[1].assets[0].image.url,hostedUrl("vansco"));
 await assert.rejects(createVanscoFacebookStory({...args,storyArtwork:{url:hostedUrl("rent2buy"),model:{registration:reg},vehicle:{supplierStockId:id}}}),/unverified/);
 assert.equal(inputs.length,2);
});
test("actual Instagram resolver retains owned Story artwork, never changes feed/Reel source preference",async()=>{
 const {resolveUsableMedia}=await import("../api/buffer-instagram-mirror.js");
 const {png}=await renderApprovedStory(buildStoryModel("vanFinance",vehicle),{photoDataUrl:verifiedStoryPhoto({bytes:photo,type:"image/png"}).dataUrl});
 const original=globalThis.fetch;
 const raw="https://static.wixstatic.com/media/original.jpg";
 const db={from:()=>({select(){return this},eq(){return this},ilike(){return this},limit:async()=>({data:[{title:reg,picture:raw,is_active:true}]})})};
 const calls=[];
 try {
  globalThis.fetch=async(url)=>{calls.push(url);return response(url===hostedUrl("vanFinance",reg,png)?png:photo)};
  const result=await resolveUsableMedia({from:()=>{throw Error("must not read raw CRM")}},
   {mediaKind:"story",registration:reg,mediaUrl:hostedUrl("vanFinance",reg,png)});
  assert.equal(result.source,"approved_first_image_story_artwork");assert.deepEqual(calls,[hostedUrl("vanFinance",reg,png)]);
  calls.length=0;
  const feed=await resolveUsableMedia(db,{mediaKind:"image",registration:reg,mediaUrl:first});
  assert.equal(feed.source,"original_crm");assert.equal(calls[0],raw);
  await assert.rejects(resolveUsableMedia(db,{mediaKind:"story",registration:"XY34ZZZ",mediaUrl:hostedUrl()}),/identity mismatch/);
 } finally {globalThis.fetch=original}
});

test("ordinary numeric rental pricing requires valid signature, matching current revision and no manual special",()=>{
 const now=Date.now(),secret="test-only-signing-key-".repeat(3);
 const source={vehicle:{registration:reg,supplierStockId:id,title:"Test van",year:2025,mileage:12000,
  vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T12:00:00Z"},sourceRetailPrice:12000,sourceMode:"dealerkit_current_stock"};
 const result=quoteRent2BuyMatrix({retailPrice:12000,registrationYear:2025,vehicleMileage:12000});
 assert.equal(result.status,"ok");
 const quote={...result,quoteId:"test-quote-0001",registration:reg,vehicleTitle:"Test van",sourceRevision:rent2BuyPricingSourceRevision(source),issuedAt:now,expiresAt:now+3600000};
 const token=signRent2BuyQuote(quote,secret,now);
 const context={token,secret,source,manualSpecialStatus:"none",now};
 assert.ok(signedStoryRentalPricing(reg,context)?.quote);
 assert.equal(signedStoryRentalPricing(reg,{...context,manualSpecialStatus:"unknown"}),undefined);
 assert.equal(signedStoryRentalPricing(reg,{...context,manualSpecialStatus:"active"}),undefined);
 assert.equal(signedStoryRentalPricing(reg,{...context,token:token+"x"}),undefined);
 assert.equal(signedStoryRentalPricing(reg,{...context,now:now+3600001}),undefined);
 assert.equal(signedStoryRentalPricing(reg,{...context,source:{...source,sourceRetailPrice:13000}}),undefined);
});
test("actual VFC worker with flags off retains raw post and default media handoff",async()=>{
 delete process.env.STORY_ARTWORK_VFC_ENABLED;process.env.BUFFER_API_KEY="mock";
 const before=globalThis.fetch;bufferInputs=[];artworkCalls=[];
 try{
  globalThis.fetch=async()=>response();
  const post={id:"source-off",text:"REGISTRATION: AB12CDE\nORIGINAL CAPTION",channelId:BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"],status:"scheduled",
   dueAt:"2026-11-02T09:00:00Z",assets:[{mimeType:"image/jpeg",source:second}]};
  const result=await createNextStory({posts:[post],productKey:"vanFinance",dateKey:"2026-11-02",now:Date.parse("2026-11-02T08:00:00Z"),storyTarget:3});
  assert.equal(result.created,true);assert.equal(artworkCalls.length,0);
  assert.equal(bufferInputs[0].assets[0].image.url,second);assert.match(bufferInputs[0].text,/ORIGINAL CAPTION/);
  assert.equal(handoffSkips.at(-1),false);
 }finally{globalThis.fetch=before}
});

test("owned Story mirror rechecks available stock and supplier identity before scheduling",async()=>{
 const deps={getSnapshot:async()=>snapshot,getDetail:async()=>detail};
 assert.equal(await assertCurrentStoryArtworkStock(hostedUrl(),"vanFinance",reg,deps),true);
 await assert.rejects(assertCurrentStoryArtworkStock(hostedUrl(),"vanFinance",reg,{...deps,getDetail:async()=>({...detail,status:"sold"})}),/unavailable/);
 const nextId="replacement-supplier";
 await assert.rejects(assertCurrentStoryArtworkStock(hostedUrl(),"vanFinance",reg,{
  getSnapshot:async()=>({...snapshot,vehicles:[{...snapshot.vehicles[0],supplierStockId:nextId}]}),
  getDetail:async()=>({...detail,supplierStockId:nextId})}),/supplier_changed/);
});
