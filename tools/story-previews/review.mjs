/**
 * One-shot PR review renderer, not a publishing workflow.
 * Public GETs only; no production keys, database clients or storage writes.
 * Output stays on the GitHub runner and in its review artifact.
 */
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {Resvg} from "@resvg/resvg-js";
import opentype from "opentype.js";
import {buildStoryModel,renderStorySvg,escapeXml} from "./template.mjs";
import {publishedRetailVat} from "./sources.mjs";
import {pendingRent2BuySpecialDeal} from "../../lib/rent2BuyProtectedSpecialDeals.mjs";
import {vatLabelFromText,VANSCO_BRANCHES,parseCsvRecords} from "../../lib/vanscoFacebookAutomation.js";
const require=createRequire(import.meta.url);
const out=new URL("../../story-preview-output/",import.meta.url);
const stockOrigin="https://marketing-crm-six.vercel.app";
const sourceHosts=new Set(["www.vanfinancecompany.co.uk","www.rent2buyvans.co.uk","marketing-crm-six.vercel.app","static.wixstatic.com","acdn.uk"]);
sourceHosts.add("www.vansco.co.uk");
const checkedAt=new Date().toISOString();
await mkdir(out,{recursive:true});

async function publicGet(url,maxBytes=8_000_000) {
 const parsed=new URL(url);
 if(parsed.protocol!=="https:"||!sourceHosts.has(parsed.hostname)||parsed.username||parsed.password||parsed.port)
  throw Error("Unapproved public Story source.");
 const response=await fetch(parsed,{method:"GET",redirect:"error",signal:AbortSignal.timeout(45000),
  headers:{Accept:"application/json,text/html,image/png,image/jpeg,text/tab-separated-values","User-Agent":"MarketingCRM-Story-Preview-Review/1.0"}});
 if(!response.ok)throw Error("Public Story source returned HTTP "+response.status+": "+url);
 const chunks=[];let size=0;
 for await (const chunk of response.body) {size+=chunk.length;if(size>maxBytes)throw Error("Story source is too large.");chunks.push(chunk)}
 return {bytes:Buffer.concat(chunks),type:response.headers.get("content-type")||""};
}
function structuredVehicle(html,registration) {
 const items=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(match=>{
  try{const parsed=JSON.parse(match[1]);return Array.isArray(parsed)?parsed:[parsed,...(parsed["@graph"]||[])]}catch{return []}
 });
 const vehicles=items.filter(v=>v["@type"]==="Vehicle"&&String(v.sku||v.identifier).replace(/\s/g,"").toUpperCase()===registration);
 if(vehicles.length!==1)throw Error("No unique exact vehicle identity on the published page.");
 return vehicles[0];
}
function shortTitle(name,year) {
 const prefix=new RegExp("^"+year+"(?:/\\d{2})?\\s+");
 return String(name).replace(prefix,"").split(/\s+(?:Panel Van|Crew Van|Chassis Cab|Pickup|MPV)\b/i)[0].trim();
}
async function publishedVehicle(url,registration) {
 const {bytes}=await publicGet(url);const html=bytes.toString("utf8");
 const v=structuredVehicle(html,registration);
 if(v.offers?.availability && v.offers.availability!=="https://schema.org/InStock")throw Error("Listing is not in stock.");
 const year=Number(String(v.vehicleModelDate||"").match(/^\d{4}/)?.[0])||undefined;
 const vehicle={registration,title:shortTitle(v.name,year),fullTitle:v.name,year,
  mileage:Number.isFinite(Number(v.mileageFromOdometer?.value))?Number(v.mileageFromOdometer.value):undefined,
  fuel:v.fuelType,transmission:v.vehicleTransmission,vehicleUrl:url,
  price:v.offers?.priceCurrency==="GBP"?Number(v.offers.price):undefined,
  vatLabel:publishedRetailVat(html,Number(v.offers?.price))||vatLabelFromText(v.description),status:"published",
  source:{url,checkedAt,kind:"published_vehicle_structured_data"}};
 return {vehicle,schema:v};
}
async function gallery(registration) {
 const url=stockOrigin+"/api/vehicle-image-suite-stock?registration="+registration;
 const {bytes}=await publicGet(url);const data=JSON.parse(bytes.toString("utf8"));
 assert.equal(data.ok,true);assert.equal(data.registration,registration);
 assert.ok(data.supplierStockId&&data.primaryImage);
 return {...data,sourceUrl:url};
}
async function embedPhoto(vehicle,imageUrl) {
 const {bytes,type}=await publicGet(imageUrl);
 const png=bytes[0]===137&&bytes.toString("ascii",1,4)==="PNG";
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!(png||jpeg)||!/^image\/(png|jpeg)/.test(type))throw Error("Verified photograph is not a supported PNG/JPEG.");
 return {dataUrl:"data:"+(png?"image/png":"image/jpeg")+";base64,"+bytes.toString("base64"),
  imageSource:imageUrl,photoRegistration:vehicle.registration};
}

// Current examples come only from existing public pages and vehicle feeds.
const feedUrl=stockOrigin+"/api/vansco-dealerkit-google-vehicle-feed";
const rows=parseCsvRecords((await publicGet(feedUrl)).bytes.toString("utf8"));
const financePage=await publishedVehicle("https://www.vanfinancecompany.co.uk/vans/fv74bbj","FV74BBJ");
const finance=financePage.vehicle;
const financeGallery=await gallery(finance.registration);
const vanscoPage=financePage;
const selectedRow=rows.find(row=>row.id===financeGallery.supplierStockId);
console.log(JSON.stringify({stockEvidence:finance.registration,galleryCount:financeGallery.images.length,supplierStockId:financeGallery.supplierStockId,matchedVanscoFeed:Boolean(selectedRow)}));
const rentalPage=await publishedVehicle("https://www.rent2buyvans.co.uk/van-pages/fv74bbj","FV74BBJ");
const rental=rentalPage.vehicle;
const fixed=pendingRent2BuySpecialDeal(rental.registration);
assert.ok(fixed,"Preview rental example must be a protected fixed special.");
const rentalDescription=String(rentalPage.schema.description);
const monthly=rentalDescription.match(/monthly rental is £([\d,]+) \+ VAT over (\d+)x monthly payments/i);
const initial=rentalDescription.match(/initial rental of £([\d,]+) \+ VAT/i);
assert.ok(monthly&&initial,"Published special terms are not verifiable.");
assert.equal(Number(monthly[1].replace(/,/g,"")),fixed.monthlyExVat);
assert.equal(Number(monthly[2]),fixed.termMonths);
assert.equal(Number(initial[1].replace(/,/g,"")),fixed.initialExVat);

const branchKeys={"VANSCO-333":"vansco333","VANSCO-AIRPORT":"southamptonAirport","VANSCO-NEWFOREST":"newForest"};
// Exact-registration VAT evidence comes from its public retail-price label.
// Vansco keeps its OWN current feed price; prices may legitimately differ by brand.
// Unknown VAT/branch/price holds the review, with no guessed defaults.
const row=selectedRow;
assert.ok(row,"The exact Vansco example is absent from its current public vehicle feed.");
const feedPrice=Number(String(row.price).match(/^([0-9.]+) GBP$/)?.[1]);
assert.ok(Number.isFinite(feedPrice)&&feedPrice>0,"Vansco current feed price is unresolved.");
assert.ok(vanscoPage.vehicle.vatLabel,"No explicit VAT treatment for the Vansco example.");
const branchKey=branchKeys[row.store_code];
assert.ok(VANSCO_BRANCHES[branchKey],"Vansco feed branch is unresolved.");
const vansco={...vanscoPage.vehicle,title:shortTitle(row.title,vanscoPage.vehicle.year),fullTitle:row.title,price:feedPrice,branchKey,
 vehicleUrl:row.link,status:"available",source:{url:feedUrl,checkedAt,kind:"existing_vansco_vehicle_feed",
 vatEvidenceUrl:vanscoPage.vehicle.vehicleUrl,vatEvidenceRegistration:vanscoPage.vehicle.registration,storeCode:row.store_code}};

const fontPaths=[400,700,900].map(weight=>require.resolve("@fontsource/inter/files/inter-latin-"+weight+"-normal.woff"));
const fonts={};
for (const [index,weight] of [400,700,900].entries()) {
 const bytes=await readFile(fontPaths[index]);
 fonts[weight]=opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
const font=fonts[900];
// Match the existing reel renderer's glyph-by-glyph width measurement.
// Avoid unsupported OpenType substitution tables in the bundled Inter font.
const measure=(text,size)=>Array.from(text).reduce((width,char)=>{
 const glyph=font.charToGlyph(char);
 return width+(glyph.advanceWidth||font.unitsPerEm*.5)*(size/font.unitsPerEm);
},0);
// SVG paths remain self-contained and render identically without installed fonts.
const drawText=(value,x,y,size,fill="#ffffff",weight=700)=>{
 const selected=fonts[weight]||fonts[700];let cursor=x;
 const paths=Array.from(String(value)).map(char=>{
  const glyph=selected.charToGlyph(char);
  const d=glyph.getPath(cursor,y,size).toPathData(2);
  cursor+=(glyph.advanceWidth||selected.unitsPerEm*.5)*(size/selected.unitsPerEm);
  return '<path d="'+d+'"/>';
 }).join("");
 return '<g aria-label="'+escapeXml(value)+'" fill="'+fill+'">'+paths+'</g>';
};
const render=svg=>new Resvg(svg,{font:{fontFiles:fontPaths,loadSystemFonts:false,defaultFontFamily:"Inter"}}).render().asPng();

function trimmedLogo(bytes,mime="image/png",white=false) {
 const uri="data:"+mime+";base64,"+bytes.toString("base64");
 const square=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><image href="'+uri+'" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></svg>').render();
 const pixels=square.pixels;let left=800,top=800,right=0,bottom=0;
 for(let y=0;y<800;y++)for(let x=0;x<800;x++){
  const i=(y*800+x)*4;
  if(pixels[i+3]>32 && (white||Math.min(pixels[i],pixels[i+1],pixels[i+2])<230)){
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
 }
 assert.ok(right>left&&bottom>top,"The genuine logo has no visible artwork.");
 left=Math.max(0,left-8);top=Math.max(0,top-8);right=Math.min(799,right+8);bottom=Math.min(799,bottom+8);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+(right-left+1)+'" height="'+(bottom-top+1)+'" viewBox="'+left+' '+top+' '+(right-left+1)+' '+(bottom-top+1)+'"><image href="'+uri+'" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></svg>';
 return "data:image/png;base64,"+new Resvg(svg).render().asPng().toString("base64");
}
const logoAssets={
 vanFinance:{path:"../../assets/van-finance-company.png"},
 rent2buy:{path:"../../assets/rent2buy-vans.png"},
 vansco:{url:"https://www.vansco.co.uk/dist/img/webp/logo-white.webp"},
};
const snapshots=[];
const held=[];
for(const [brandKey,vehicle] of [
 ["vanFinance",finance],
 ["rent2buy",rental],
 ["vansco",vansco],
]) {
 const logoSource=logoAssets[brandKey];
 if(!logoSource){held.push({brandKey,reason:"Genuine existing logo source required"});continue;}
 const logoBytes=logoSource.path?await readFile(new URL(logoSource.path,import.meta.url)):(await publicGet(logoSource.url)).bytes;
 const logoDataUrl=trimmedLogo(logoBytes,logoSource.url?"image/webp":"image/png",brandKey==="vansco");
 const images=vehicle.registration===finance.registration?financeGallery:await gallery(vehicle.registration);
 // Use the existing raw, exact-registration DealerKit gallery, avoiding
 // legacy branded primaries that may already contain prices/captions.
 // Exact-registration raw photographs; visually reviewed, no stock placeholders.
 const selectedImage=images.primaryImage;
 assert.ok(selectedImage,"Reviewed alternate photograph is unavailable.");
 const photo=await embedPhoto(vehicle,selectedImage);
 const snapshot={...vehicle,photoRegistration:photo.photoRegistration,imageSource:photo.imageSource,
  supplierStockId:images.supplierStockId,gallerySource:images.sourceUrl,photoAssociationSource:images.sourceUrl,logoSource:logoSource.path||logoSource.url};
 const model=buildStoryModel(brandKey,snapshot);
 const options={photoDataUrl:photo.dataUrl,logoDataUrl,measure,drawText};
 const svg=renderStorySvg(model,options);const png=render(svg);
 const withoutCopy=render(renderStorySvg(model,{...options,drawText:()=>""}));
 assert.ok(!png.equals(withoutCopy),"Story copy must be visible in the exported pixels.");
 assert.ok(png.byteLength<4_000_000,"Story PNG exceeds the existing Facebook worker's image limit.");
 assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1920);
 await writeFile(new URL(brandKey+".png",out),png);
 await writeFile(new URL(brandKey+".svg",out),svg);
 await writeFile(new URL(brandKey+"-safe.png",out),render(renderStorySvg(model,{...options,safeGuide:true})));
 const thumbnail=new Resvg(svg,{fitTo:{mode:"width",value:360},font:{fontFiles:fontPaths,loadSystemFonts:false}}).render().asPng();
 snapshots.push({brandKey,snapshot,model,bytes:png.byteLength,thumbnail:thumbnail.toString("base64")});
 console.log(JSON.stringify({preview:brandKey,registration:vehicle.registration,title:model.title,headline:model.headline,details:model.details,bytes:png.byteLength,branch:brandKey==="vansco"?branchKey:undefined}));
}
await writeFile(new URL("held.json",out),JSON.stringify(held,null,2));
console.log("HELD_STORIES="+JSON.stringify(held));
await writeFile(new URL("sources.json",out),JSON.stringify(snapshots.map(({thumbnail,...record})=>record),null,2));
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640">'+
 snapshots.map((x,i)=>'<image x="'+(i*360)+'" width="360" height="640" href="data:image/png;base64,'+x.thumbnail+'"/>').join("")+'</svg>';
const sheetPng=render(sheet);await writeFile(new URL("contact-sheet.png",out),sheetPng);
// Small contact sheet for visual review through GitHub job logs, without any PC files.
console.log("STORY_CONTACT_SHEET_BASE64="+sheetPng.toString("base64"));
const cards=snapshots.map(({brandKey,model})=>'<article><h2>'+escapeXml(model.brand.name)+'</h2><div class="image"><img src="'+brandKey+'.png" data-clean="'+brandKey+'.png" data-safe="'+brandKey+'-safe.png" alt="'+escapeXml(model.title+" "+model.headline)+'"></div><p>'+escapeXml(model.registration+" · "+model.title)+'</p><a href="'+brandKey+'.png" download>Download 1080 × 1920 PNG</a> · <a href="'+escapeXml(model.vehicleUrl)+'">Source listing</a></article>').join("");
await writeFile(new URL("index.html",out),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Branded Story previews · review only</title><style>body{margin:0;background:#eef0f3;color:#172333;font:16px/1.5 Arial,sans-serif}main{max-width:1250px;margin:auto;padding:30px}h1{font-size:30px}header{margin-bottom:30px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{padding:18px;background:white;border-radius:18px}h2{font-size:20px}.image img{display:block;width:100%;height:auto}a{color:#0656b0}button{padding:12px 18px;background:#172333;color:white;border:0;border-radius:8px;font:inherit;cursor:pointer}@media(max-width:850px){.grid{grid-template-columns:1fr}article{max-width:440px;margin:auto}}</style><main><header><p>REVIEW ONLY · NO PUBLISHING CONNECTION</p><h1>Vehicle Stories, designed for the small screen</h1><p>Three revised brand designs. Public data checked '+escapeXml(checkedAt)+'. Existing stock, pricing, schedules and publishing are untouched.</p><button id="guides" aria-pressed="false">Show Story safe areas</button><p>Important copy stays between 250px and 1580px, with 72px side margins. Safe areas are a conservative design guide; platform interfaces vary. The CTA is visual artwork, not a clickable sticker.</p><a href="sources.json">Vehicle facts and source evidence</a></header><section class="grid">'+cards+'</section></main><script>document.querySelector("#guides").onclick=function(){const show=this.getAttribute("aria-pressed")!=="true";this.setAttribute("aria-pressed",show);this.textContent=show?"Hide Story safe areas":"Show Story safe areas";document.querySelectorAll("img[data-clean]").forEach(img=>img.src=show?img.dataset.safe:img.dataset.clean)}</script></html>');
