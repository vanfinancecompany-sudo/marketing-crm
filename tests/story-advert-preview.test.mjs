import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildStoryModel,rent2BuyStoryPricing,renderStorySvg,fitText,STORY_SIZE,STORY_SAFE_AREA} from "../tools/story-previews/template.mjs";
import {quoteRent2BuyMatrix} from "../lib/rent2BuyFlexiblePricing.mjs";
import {rent2BuyPricingSourceRevision} from "../lib/rent2BuyCurrentSourceQuote.mjs";
const photo="data:image/png;base64,iVBORw0KGgo=";
const base=(extra={})=>({registration:"ZZ25XYZ",photoRegistration:"ZZ25XYZ",title:"Ford Transit Custom",
 year:2025,mileage:24500,fuel:"Diesel",transmission:"Manual",status:"available",
 vehicleUrl:"https://www.vanfinancecompany.co.uk/vans/zz25xyz",
 source:{checkedAt:"2026-10-31T12:00:00Z",url:"https://www.vanfinancecompany.co.uk/vans/zz25xyz"},...extra});
const vansco=(extra={})=>base({vehicleUrl:"https://www.vansco.co.uk/vehicle-details/verified-van",
 price:14995,vatLabel:"+ VAT",branchKey:"newForest",...extra});

test("four protected specials override stale captions, monthlies, terms and matrix inputs",()=>{
 for(const [registration,monthly] of [["BT25LVK",595],["FV74BBJ",545],["FV74BEO",595],["BJ74HTL",595]]){
  const vehicle=base({registration,photoRegistration:registration,monthly:693,initialRental:2079,
   rentalPricing:{manualSpecialStatus:"none",quote:{termMonths:36,monthlyExVat:999},source:{}}});
  assert.deepEqual(rent2BuyStoryPricing(vehicle),{mode:"protected_special",monthly,initial:2000,term:48,miles:null});
  const model=buildStoryModel("rent2buy",vehicle);
  assert.equal(model.headline,"£"+monthly+" + VAT / month");
  assert.match(model.details[0],/£2,000 \+ VAT initial · 48 months/);
  assert.ok(!model.details.some(x=>/miles per month/.test(x)));
 }
});

function verifiedVehicle(){
 const source={vehicle:{registration:"ZZ25XYZ",supplierStockId:"real-source-id",year:2024,mileage:25000,vatStatus:"plus_vat"},
  sourceRetailPrice:12000,sourceMode:"dealerkit_current_stock"};
 const quote={...quoteRent2BuyMatrix({retailPrice:12000,registrationYear:2024,vehicleMileage:25000,currentYear:2026}),
  registration:"ZZ25XYZ",sourceRevision:rent2BuyPricingSourceRevision(source),quoteId:"review-quote"};
 return base({rentalPricing:{manualSpecialStatus:"none",source,quote}});
}
test("ordinary pricing is verified by the existing calculator/current-source verifier",()=>{
 const vehicle=verifiedVehicle();
 const result=rent2BuyStoryPricing(vehicle);
 assert.equal(result.mode,"matrix");assert.equal(result.monthly,400);
 assert.equal(result.initial,1750);assert.equal(result.term,48);assert.equal(result.miles,1000);
});
test("unverified, forged, changed-source and manual-special prices never become rental claims",()=>{
 const vehicle=verifiedVehicle();
 for(const change of [
  v=>{delete v.rentalPricing},
  v=>{v.rentalPricing.manualSpecialStatus="unknown"},
  v=>{v.rentalPricing.manualSpecialStatus="active"},
  v=>{v.rentalPricing.quote.monthlyExVat=1},
  v=>{v.rentalPricing.source.sourceRetailPrice=13000},
  v=>{v.rentalPricing.source.vehicle.registration="AB12CDE"},
 ]){
  const copy=structuredClone(vehicle);change(copy);
  assert.equal(rent2BuyStoryPricing(copy).mode,"unavailable");
  const model=buildStoryModel("rent2buy",copy);
  assert.equal(model.headline,"See rental options");
  assert.doesNotMatch(model.headline+model.details.join(" "),/£|\bAPR\b/);
 }
});

test("Vansco retains exact cash price, all three VAT treatments and canonical branch",()=>{
 for(const vatLabel of ["+ VAT","NO VAT","INC VAT"]){
  const model=buildStoryModel("vansco",vansco({vatLabel}));
  assert.equal(model.headline,"£14,995 "+vatLabel);
  assert.deepEqual(model.details,["Vansco New Forest","02380 813 119"]);
 }
 for(const key of ["vansco333","newForest","southamptonAirport"])
  assert.equal(buildStoryModel("vansco",vansco({branchKey:key})).branch.key,key);
});
test("missing or ambiguous Vansco facts hold rendering instead of defaulting VAT, price or branch",()=>{
 for(const extra of [{branchKey:""},{branchKey:"other"},{branchConflict:true},{vatLabel:"unknown"},{price:0},{price:"14995"}])
  assert.throws(()=>buildStoryModel("vansco",vansco(extra)),/must be resolved/);
});
test("VFC never infers payments, deposits, APR or approval claims",()=>{
 const model=buildStoryModel("vanFinance",base({monthly:"£99",salePrice:"Guaranteed approval",price:14995,vatLabel:"unknown"}));
 assert.equal(model.headline,"Your next work van");
 const svg=renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:photo});
 assert.doesNotMatch(svg,/Guaranteed|approval|APR|deposit|£99/i);
 assert.equal(buildStoryModel("vanFinance",base({price:14995,vatLabel:"+ VAT"})).headline,"£14,995 + VAT");
});
test("wrong-photo identity, sold stock, missing provenance and cross-brand URLs are rejected",()=>{
 for(const extra of [{photoRegistration:"AB12CDE"},{status:"sold"},{status:"reserved"},{source:{}},
  {vehicleUrl:"https://www.vansco.co.uk/vehicle-details/other"}])
  assert.throws(()=>buildStoryModel("vanFinance",base(extra)));
});
test("long titles fit as whole words or require review; no hidden text/cropped claims",()=>{
 const fit=fitText("Mercedes-Benz Sprinter 315 CDI Progressive L3 H2 Panel Van Automatic");
 assert.ok(fit.lines.length<=3);assert.ok(fit.size>=44);
 assert.equal(fit.lines.join(" "),"Mercedes-Benz Sprinter 315 CDI Progressive L3 H2 Panel Van Automatic");
 assert.throws(()=>fitText("Unbreakable".repeat(100)),/cannot fit safely/);
});
test("all three SVGs use the correct canvas, embedded photos and text-safe geometry",()=>{
 assert.deepEqual(STORY_SIZE,{width:1080,height:1920});
 for(const [key,vehicle] of [["vanFinance",base()],["rent2buy",base({registration:"FV74BBJ",photoRegistration:"FV74BBJ"})],["vansco",vansco()]]){
  const model=buildStoryModel(key,vehicle);
  const svg=renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:photo});
  assert.match(svg,/width="1080" height="1920"/);
  assert.match(svg,/preserveAspectRatio="xMidYMid meet"/);
  assert.doesNotMatch(svg,/<image[^>]*href="https?:/);
  for(const match of svg.matchAll(/<text x="(\d+)" y="(\d+)"/g)){
   assert.ok(Number(match[1])>=STORY_SAFE_AREA.left);
   assert.ok(Number(match[2])>=STORY_SAFE_AREA.top&&Number(match[2])<=STORY_SAFE_AREA.bottom);
  }
  assert.ok(svg.includes(model.registration));
  assert.match(renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:photo,safeGuide:true}),/stroke-dasharray/);
 }
});
test("untrusted text is escaped and external/SVG image payloads cannot enter the artwork",()=>{
 const model=buildStoryModel("vanFinance",base({title:'Ford <script>alert("x")</script> & Transit'}));
 const svg=renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:photo});
 assert.ok(svg.includes("&lt;script&gt;"));assert.doesNotMatch(svg,/<script>/);
 for(const image of ["https://example.com/a.jpg","data:image/svg+xml;base64,PHN2Zz4="])
  assert.throws(()=>renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:image}),/Embed a verified/);
});
test("preview code has no production client, publication or scheduling dependency",()=>{
 for(const file of ["template.mjs","review.mjs","sources.mjs"]){
  const source=readFileSync(new URL("../tools/story-previews/"+file,import.meta.url),"utf8");
  assert.doesNotMatch(source,/from ["'][^"']*(?:supabase|@vercel\/blob|buffer.*runtime|bufferPublishing|automation-worker)/i);
  assert.doesNotMatch(source,/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(source,/process\.env\.(?:BUFFER|SUPABASE|DEALERKIT|WIX)/);
 }
});

test("vector text adapter receives every visible claim and its safe-area position",()=>{
 const model=buildStoryModel("rent2buy",base({registration:"FV74BBJ",photoRegistration:"FV74BBJ"}));
 const drawn=[];
 const svg=renderStorySvg(model,{logoDataUrl:photo,photoDataUrl:photo,drawText:(value,x,y)=>{drawn.push({value,x,y});return '<g aria-label="'+value+'"><path d="M0 0L1 1"/></g>'}});
 assert.ok(drawn.some(x=>x.value===model.headline.split(" ")[0]));
 assert.ok(drawn.some(x=>x.value===model.brand.cta));
 assert.ok(drawn.some(x=>x.value===model.registration));
 for(const row of drawn)assert.ok(row.x>=72&&row.y>=250&&row.y<=1580);
 assert.doesNotMatch(svg,/<text /);
});

test("public retail VAT is tied to the exact cash price, not finance/old price or page-wide VAT words",async()=>{
 const {publishedRetailVat}=await import("../tools/story-previews/sources.mjs");
 const html='<nav>NO VAT vans</nav><p>Was £14,995 +VAT</p><div>Retail price <b>£14,695</b><span>+VAT</span></div><p>From £309 monthly</p>';
 assert.equal(publishedRetailVat(html,14695),"+ VAT");
 assert.equal(publishedRetailVat(html,14995),"");
 assert.equal(publishedRetailVat('<div>Retail price £9,995 NO VAT</div>',9995),"NO VAT");
 assert.equal(publishedRetailVat('<div>Retail price £9,995 INC VAT</div>',9995),"INC VAT");
 assert.equal(publishedRetailVat(html+html,14695),"");
 assert.equal(publishedRetailVat('<script>Retail price £14,695 NO VAT</script><p>VAT vans</p>',14695),"");
 assert.equal(publishedRetailVat('<p>Finance from £309 +VAT</p>',309),"");
});

test("brand adaptations reuse the approved hero geometry with rental text branding",()=>{
 const model=buildStoryModel("rent2buy",base({registration:"FV74BBJ",photoRegistration:"FV74BBJ"}));
 const fallback=renderStorySvg(model,{photoDataUrl:photo});
 assert.match(fallback,/Rent2Buy Vans/);
 const svg=renderStorySvg(model,{photoDataUrl:photo,logoDataUrl:photo});
 assert.match(svg,/width="1080" height="786" preserveAspectRatio="xMidYMid meet"/);
 assert.match(svg,/NO CREDIT CHECK VANS/);
 assert.match(svg,/Rent2Buy Vans/);
 assert.equal([...svg.matchAll(/<image /g)].length,1,"Rent2Buy must not embed a logo even when supplied");
 assert.doesNotMatch(svg,/fill="#f8f7f3"/);
});
test("VFC uses text branding even when a logo is supplied, with finance-led factual copy",()=>{
 const model=buildStoryModel("vanFinance",base({price:14695,vatLabel:"+ VAT"}));
 const svg=renderStorySvg(model,{photoDataUrl:photo,logoDataUrl:photo});
 assert.match(svg,/Van Finance Company/);
 assert.equal([...svg.matchAll(/<image /g)].length,1);
 assert.match(svg,/EXPLORE VAN FINANCE/);
 assert.match(svg,/EXPLORE FINANCE OPTIONS/);
 assert.match(svg,/VEHICLE CASH PRICE/);
 assert.doesNotMatch(svg,/APR|guaranteed|approved/i);
});

test("Vansco advert study keeps the genuine logo, uncropped hero, safe copy and earlier arrow CTA",()=>{
 const model=buildStoryModel("vansco",vansco());
 const svg=renderStorySvg(model,{photoDataUrl:photo,logoDataUrl:photo});
 assert.match(svg,/vansco-night/);
 assert.match(svg,/width="1080" height="786" preserveAspectRatio="xMidYMid meet"/);
 assert.match(svg,/VIEW THIS VAN/);
 assert.match(svg,/stroke-linejoin="round"/);
 assert.doesNotMatch(svg,/fill="#f8f7f3"/);
 assert.ok(svg.includes(model.headline.split(" ")[0]));
 assert.ok(svg.includes(model.branch.label));
});
