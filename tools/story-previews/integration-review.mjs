/**
 * Credential-free public-source rehearsal: no Buffer/Blob writes, no secrets.
 * --authoritative optionally uses the EXISTING private stock/Meta credentials
 * in an approved environment; still dry-run, never uploads or creates posts.
 */
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {Resvg} from "@resvg/resvg-js";
import {prepareSelectedStoryArtwork,loadCurrentStoryVehicle} from "../../api/_story-artwork.js";
import {publishedStoryVehicle} from "../../lib/storyArtworkSources.mjs";
import {parseCsvRecords,VANSCO_BRANCHES} from "../../lib/vanscoFacebookAutomation.js";
const out=new URL("../../story-integration-output/",import.meta.url);
await mkdir(out,{recursive:true});
const hosts=new Set(["marketing-crm-six.vercel.app","www.vanfinancecompany.co.uk","www.rent2buyvans.co.uk"]);
async function get(url){
 const u=new URL(url);
 if(u.protocol!=="https:"||!hosts.has(u.hostname)||u.username||u.password||u.port)throw Error("unapproved_review_source");
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 let reader;
 try{
  const r=await fetch(u,{method:"GET",redirect:"error",signal:controller.signal});
  if(!r.ok)throw Error("public_source_http_"+r.status);
  reader=r.body.getReader();let length=0;const chunks=[];
  for(;;){const x=await reader.read();if(x.done)break;length+=x.value.length;if(length>8_000_000)throw Error("review_source_too_large");chunks.push(Buffer.from(x.value))}
  return Buffer.concat(chunks).toString("utf8");
 }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{})}
}
const stockOrigin="https://marketing-crm-six.vercel.app";
const feedUrl=stockOrigin+"/api/vansco-dealerkit-google-vehicle-feed";
const rows=parseCsvRecords(await get(feedUrl));
const branchKeys={"VANSCO-333":"vansco333","VANSCO-AIRPORT":"southamptonAirport","VANSCO-NEWFOREST":"newForest"};
const authoritative=process.argv.includes("--authoritative");
const specs=[["vanFinance","FV74BEO"],["rent2buy","BT25LVK"],["vansco","FV74BBJ"]];
let meta=[];
if(authoritative){
 const {fetchVanscoMetaCatalogue}=await import("../../api/_vansco-facebook-source.js");
 meta=await fetchVanscoMetaCatalogue({preferLiveMetaImages:true,storyPrimaryProof:true});
}
const reports=[],thumbs=[];
for(const [brandKey,registration]of specs){
 const pageBrand=brandKey==="vansco"?"vanFinance":brandKey;
 const pageUrl=pageBrand==="vanFinance"?"https://www.vanfinancecompany.co.uk/vans/":"https://www.rent2buyvans.co.uk/van-pages/";
 const html=await get(pageUrl+registration.toLowerCase());
 const published=publishedStoryVehicle(html,pageBrand,registration);
 const galleryUrl=stockOrigin+"/api/vehicle-image-suite-stock?registration="+registration;
 const gallery=JSON.parse(await get(galleryUrl));
 assert.equal(gallery.ok,true);assert.equal(gallery.registration,registration);
 const matches=rows.filter(r=>r.id===gallery.supplierStockId);
 assert.equal(matches.length,1,"Exact supplier must be in current eligible public feed.");
 const row=matches[0];
 let selected={...published,supplierStockId:gallery.supplierStockId};
 let evidence="Public brand page: Vehicle.image[0] is the displayed StockGallery[0]. Supplier matched to current filtered DealerKit feed.";
 if(brandKey==="vansco"){
  // Public Google feed is NOT claimed to prove the private Meta catalogue order.
  // This is an explicitly labelled real-vehicle rehearsal until authoritative dry-run.
  const price=Number(String(row.price).match(/^([0-9.]+) GBP$/)?.[1]);
  assert.equal(price,published.price,"No cross-brand VAT inference if retail prices differ.");
  assert.ok(published.vatLabel);assert.ok(VANSCO_BRANCHES[branchKeys[row.store_code]]);
  selected={...selected,vehicleUrl:row.link,price,vatLabel:published.vatLabel,branchKey:branchKeys[row.store_code],
   imageSource:row.image_link,source:{url:feedUrl,checkedAt:new Date().toISOString(),kind:"public_google_feed_first_image_rehearsal",
    vatEvidenceUrl:published.vehicleUrl,privateMetaOrderVerified:false}};
  evidence="Real Vansco public DealerKit Google-feed primary. Private Meta order is separately tested with mocks; live Meta dry-run needs existing server credentials.";
 }
 const noWrite=()=>{throw Error("DRY RUN MUST NOT WRITE")};
 const result=await prepareSelectedStoryArtwork({brandKey,registration,dueAt:new Date(Date.now()+3600000).toISOString(),
  vehicle:brandKey==="vansco"?meta.find(v=>v.registration===registration):undefined},{
  dryRun:true,host:noWrite,
  loadVehicle:authoritative?loadCurrentStoryVehicle:async()=>selected,
 });
 assert.equal(result.provenance.firstImageIndex,0);
 await writeFile(new URL(brandKey+".png",out),result.png);
 await writeFile(new URL(brandKey+".svg",out),result.svg);
 const images=[...result.svg.matchAll(/<image href="(data:image\/(?:png|jpeg);base64,[^"]+)"/g)];
 const {renderApprovedStory}=await import("../../lib/storyArtworkRenderer.mjs");
 const safe=await renderApprovedStory(result.model,{photoDataUrl:images[brandKey==="vansco"?1:0][1],safeGuide:true});
 await writeFile(new URL(brandKey+"-safe.png",out),safe.png);
 const thumbnail=new Resvg(result.svg,{fitTo:{mode:"width",value:360}}).render().asPng();
 thumbs.push(thumbnail);
 const report={brandKey,registration,supplierStockId:result.vehicle.supplierStockId,firstImageUrl:result.vehicle.imageSource,
  currentGalleryFirst:gallery.primaryImage,brandGalleryFirst:published.imageSource,
  bytes:result.png.length,model:result.model,provenance:result.provenance,evidence,
  mode:authoritative?"authoritative_read_only_dry_run":"credential_free_public_rehearsal"};
 reports.push(report);console.log(JSON.stringify(report));
}
assert.equal(new Set(reports.map(x=>x.registration)).size,3);
await writeFile(new URL("provenance.json",out),JSON.stringify(reports,null,2));
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640">'+thumbs.map((b,i)=>'<image x="'+i*360+'" width="360" height="640" href="data:image/png;base64,'+b.toString("base64")+'"/>').join("")+'</svg>';
const png=new Resvg(sheet).render().asPng();await writeFile(new URL("contact-sheet.png",out),png);
console.log("STORY_CONTACT_SHEET_BASE64="+png.toString("base64"));
await writeFile(new URL("index.html",out),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Story integration review</title><style>body{background:#e8e8e8;font:16px Arial;margin:24px}.grid{display:flex;gap:20px;flex-wrap:wrap}article{max-width:360px}img{width:100%}</style><h1>Story integration · review only</h1><p>No Buffer writes, uploads, deployment or live activation. See provenance.json for first-photo evidence and private Meta verification limitation.</p><a href="provenance.json">Full source evidence</a><div class="grid">'+reports.map(r=>'<article><h2>'+r.model.brand.name+' · '+r.registration+'</h2><img src="'+r.brandKey+'.png"><p>'+r.evidence+'</p><a href="'+r.brandKey+'-safe.png">Story-safe guide</a></article>').join("")+'</div>');
