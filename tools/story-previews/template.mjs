/**
 * Isolated Story artwork only. No scheduler, Buffer, Blob, database or API client.
 * Current production code does not import this module.
 */
import { pendingRent2BuySpecialDeal } from "../../lib/rent2BuyProtectedSpecialDeals.mjs";
import { verifyRent2BuyQuoteAgainstSource } from "../../lib/rent2BuyCurrentSourceQuote.mjs";
import { VANSCO_BRANCHES } from "../../lib/vanscoFacebookAutomation.js";

export const STORY_SIZE = Object.freeze({width:1080,height:1920});
export const STORY_SAFE_AREA = Object.freeze({left:72,top:250,right:1008,bottom:1580});
export const BRANDS = Object.freeze({
 vanFinance: {name:"Van Finance Company",accent:"#ef233c",dark:"#0b1d30",eyebrow:"EXPLORE VAN FINANCE",cta:"EXPLORE FINANCE OPTIONS",website:"vanfinancecompany.co.uk"},
 rent2buy: {name:"Rent2Buy Vans",accent:"#f4213e",dark:"#15151b",eyebrow:"NO CREDIT CHECK VANS",cta:"VIEW RENTAL DETAILS",website:"rent2buyvans.co.uk"},
 vansco: {name:"Vansco",accent:"#ca2638",dark:"#191b1f",eyebrow:"FIND YOUR NEXT VAN",cta:"VIEW THIS VAN",website:"vansco.co.uk"},
});
const clean = value => String(value ?? "").replace(/\s+/g," ").trim();
const reg = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g,"");
const pounds = value => "£" + Number(value).toLocaleString("en-GB",{maximumFractionDigits:2});
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const vatLabels = new Set(["+ VAT","NO VAT","INC VAT"]);
export const escapeXml = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
function checkedUrl(value, hosts) {
 const url = new URL(value);
 if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.includes(url.hostname))
  throw Error("Unverified vehicle link.");
 return url.href;
}

export function rent2BuyStoryPricing(vehicle) {
 const protectedDeal = pendingRent2BuySpecialDeal(vehicle.registration);
 if (protectedDeal) return {mode:"protected_special",monthly:protectedDeal.monthlyExVat,
  initial:protectedDeal.initialExVat,term:protectedDeal.termMonths,miles:null};
 // Ordinary quotes require the existing current-source verifier AND confirmation
 // that no current manual special applies. A public listing/caption is insufficient.
 const context = vehicle.rentalPricing;
 if (context?.manualSpecialStatus !== "none" || !context.quote || !context.source)
  return {mode:"unavailable",reason:"current_rental_quote_not_verified"};
 const verified = verifyRent2BuyQuoteAgainstSource(context.quote,context.source);
 if (!verified.ok || reg(context.source.vehicle.registration) !== reg(vehicle.registration))
  return {mode:"unavailable",reason:verified.reason || "vehicle_mismatch"};
 const quote = verified.quote;
 return {mode:"matrix",monthly:quote.monthlyExVat,initial:quote.initialExVat,
  term:quote.termMonths,miles:quote.milesPerMonth};
}

export function buildStoryModel(brandKey, vehicle) {
 const brand = BRANDS[brandKey];
 if (!brand) throw Error("Unknown Story brand.");
 const registration = reg(vehicle?.registration);
 if (!/^[A-Z0-9]{5,8}$/.test(registration) || !clean(vehicle.title) || !vehicle.source?.checkedAt ||
     !Number.isFinite(Date.parse(vehicle.source.checkedAt)))
  throw Error("Verified vehicle identity, title and source date are required.");
 if (reg(vehicle.photoRegistration) !== registration)
  throw Error("The photograph must belong to this registration.");
 if (["sold","reserved","deposit_taken","awaiting_delivery"].includes(vehicle.status))
  throw Error("Vehicle is unavailable for an advert preview.");
 const title = clean(vehicle.title).replace(new RegExp("\\(?"+registration+"\\)?","ig"),"").trim();
 const facts = [];
 if (Number.isInteger(vehicle.year) && vehicle.year >= 1980 && vehicle.year <= new Date(vehicle.source.checkedAt).getUTCFullYear()+1)
  facts.push(String(vehicle.year));
 if (typeof vehicle.mileage === "number" && Number.isFinite(vehicle.mileage) && vehicle.mileage >= 0)
  facts.push(vehicle.mileage.toLocaleString("en-GB")+" miles");
 for (const key of ["fuel","transmission"]) if (clean(vehicle[key])) facts.push(clean(vehicle[key]).slice(0,30));
 const linkHosts = brandKey === "vansco" ? ["www.vansco.co.uk","vansco.co.uk"] :
  brandKey === "rent2buy" ? ["www.rent2buyvans.co.uk","rent2buyvans.co.uk","www.vanfinancecompany.co.uk","vanfinancecompany.co.uk"] :
  ["www.vanfinancecompany.co.uk","vanfinancecompany.co.uk"];
 const vehicleUrl = checkedUrl(vehicle.vehicleUrl,linkHosts);
 const model = {brandKey,brand,registration,title,facts,vehicleUrl,source:vehicle.source,
  kicker:"EXPLORE THIS VEHICLE",headline:"Your next work van",details:["View photos, specification & details"],pricingMode:"none"};
 if (brandKey === "rent2buy") {
  const pricing = rent2BuyStoryPricing(vehicle);
  model.pricingMode=pricing.mode;
  model.kicker=pricing.mode==="protected_special"?"FIXED RENT2BUY SPECIAL":"RENT2BUY RENTALS";
  model.headline=pricing.mode==="unavailable"?"See rental options":pounds(pricing.monthly)+" + VAT / month";
  model.details=pricing.mode==="unavailable"
   ? ["Check this van's current rental terms","Collection only from Southampton"]
   : [pounds(pricing.initial)+" + VAT initial · "+pricing.term+" months",
      ...(pricing.miles ? [pricing.miles.toLocaleString("en-GB")+" miles per month"] : []),
      "Collection only from Southampton"];
  model.note="Rent-to-own. Agreement terms apply.";
 } else {
  const vat = clean(vehicle.vatLabel).toUpperCase();
  const validPrice = positive(vehicle.price) && vatLabels.has(vat);
  if (brandKey==="vansco") {
   const branch = VANSCO_BRANCHES[vehicle.branchKey];
   if (!branch || vehicle.branchConflict || !validPrice) throw Error("Vansco price, VAT and branch must be resolved.");
   model.kicker="ADVERTISED VEHICLE PRICE";
   model.headline=pounds(vehicle.price)+" "+vat;
   model.details=[branch.label,branch.phone];
   model.branch=branch;
   model.note="See the listing for full vehicle details.";
  } else if (validPrice) {
   model.kicker="VEHICLE CASH PRICE";
   model.headline=pounds(vehicle.price)+" "+vat;
   model.details=["Explore deposit & term options"];
  }
 }
 return model;
}

/** Wrap complete words, reduce type only within a readable range; never crop text. */
export function fitText(text,{width=936,maxLines=3,maxSize=66,minSize=44,measure=(s,size)=>s.length*size*.64}={}) {
 const words=clean(text).split(" ").filter(Boolean);
 for (let size=maxSize;size>=minSize;size-=2) {
  const lines=[];let line="";let tooLong=false;
  for (const word of words) {
   if (measure(word,size)>width) {tooLong=true;break;}
   const candidate=line?line+" "+word:word;
   if (measure(candidate,size)>width) {lines.push(line);line=word;} else line=candidate;
  }
  if (line) lines.push(line);
  if (!tooLong && lines.length<=maxLines) return {lines,size};
 }
 throw Error("Story text cannot fit safely. Review the vehicle title.");
}
function rasterUri(value) {
 if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value||""))
  throw Error("Embed a verified PNG/JPEG photograph. Remote URLs are not rendered.");
 return value;
}
export function renderStorySvg(model,{photoDataUrl,logoDataUrl="",measure,drawText,safeGuide=false}={}) {
 if(model.brandKey==="vansco")return renderVanscoAdvertSvg(model,{photoDataUrl,logoDataUrl,measure,drawText,safeGuide});
 const b=model.brand;
 const title=fitText(model.title,{measure});
 const headline=fitText(model.headline,{maxLines:1,maxSize:66,minSize:44,measure});
 const facts=fitText(model.facts.join(" · ")||model.registration,{maxLines:1,maxSize:34,minSize:30,measure});
 const text=drawText || ((value,x,y,size,fill="#ffffff",weight=700)=>'<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+fill+'" font-weight="'+weight+'">'+escapeXml(value)+'</text>');
 const fitted=(value,y,{size=34,width=936,fill="#243040",weight=500}={})=>{
  const fit=fitText(value,{width,maxLines:1,maxSize:size,minSize:28,measure});
  return text(fit.lines[0],72,y,fit.size,fill,weight);
 };
 if(!logoDataUrl)throw Error("A genuine brand logo is required.");
 const logo='<image href="'+rasterUri(logoDataUrl)+'" x="96" y="258" width="560" height="108" preserveAspectRatio="xMinYMid meet"/>';
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">'+
 '<title>'+escapeXml(b.name+" · "+model.title+" · "+model.registration)+'</title>'+
 '<g font-family="Inter,Arial,sans-serif">'+
 '<rect width="1080" height="1920" fill="'+b.dark+'"/>'+
 '<rect x="72" y="250" width="936" height="124" rx="16" fill="'+(model.brandKey==="vansco"?b.dark:"#ffffff")+'"/>'+logo+
 '<rect x="754" y="288" width="230" height="54" rx="9" fill="'+b.accent+'"/>'+
 text(model.registration,774,326,30,"#ffffff",900)+
 text(b.eyebrow,72,414,model.brandKey==="rent2buy"?51:40,"#ffffff",900)+
 text(facts.lines[0],72,451,facts.size,"#dce4eb",500)+
 '<rect x="0" y="468" width="1080" height="960" fill="#f8f7f3"/>'+
 '<image href="'+rasterUri(photoDataUrl)+'" x="0" y="468" width="1080" height="810" preserveAspectRatio="xMidYMid meet"/>'+
 '<rect x="0" y="1278" width="1080" height="642" fill="#f8f7f3"/>'+
 fitText(model.title,{maxLines:2,maxSize:44,minSize:34,measure}).lines.map((line,i)=>text(line,72,1320+i*44,fitText(model.title,{maxLines:2,maxSize:48,minSize:36,measure}).size,b.dark,800)).join("")+
 text(model.kicker,72,1383,24,b.dark,700)+
 text(headline.lines[0],72,1440,headline.size,b.dark,900)+
 model.details.map((line,i)=>fitted(line,(model.details.length>2?1464:1474)+i*(model.details.length>2?24:32),{size:model.details.length>2?28:32})).join("")+
 '<rect x="72" y="1520" width="936" height="60" rx="'+(model.brandKey==="rent2buy"?26:8)+'" fill="'+b.accent+'"/>'+
 text(b.cta,96,1548,30,"#ffffff",900)+
 text(b.website,96,1574,23,"#ffffff",600)+
 (safeGuide?'<rect x="72" y="250" width="936" height="1330" fill="none" stroke="#09a3be" stroke-width="4" stroke-dasharray="16 12"/><rect width="1080" height="250" fill="#09a3be" opacity=".18"/><rect y="1580" width="1080" height="340" fill="#09a3be" opacity=".18"/>':"")+
 '</g></svg>';
 return svg;
}

/** Vansco-only dealership advert study. Other brand layouts stay unchanged. */
export function renderVanscoAdvertSvg(model,{photoDataUrl,logoDataUrl,measure,drawText,safeGuide=false}={}) {
 if(!logoDataUrl)throw Error("A genuine brand logo is required.");
 const text=drawText||((value,x,y,size,fill="#ffffff",weight=700)=>'<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+fill+'" font-weight="'+weight+'">'+escapeXml(value)+'</text>');
 const measureWidth=measure||((value,size)=>value.length*size*.64);
 const gold="#d6b75a",white="#ffffff";
 const words=model.title.split(" ");
 const name=words.slice(0,2).join(" ");
 const derivative=words.slice(2).join(" ");
 const nameFit=fitText(name,{maxLines:1,maxSize:88,minSize:48,measure});
 const trimFit=fitText(derivative,{maxLines:1,maxSize:38,minSize:28,measure});
 const factFit=fitText(model.facts.join("  ·  "),{maxLines:1,maxSize:32,minSize:28,measure});
 const price=model.headline.match(/^(£[0-9,.]+)\s+(.+)$/);
 if(!price||!model.branch)throw Error("Verified Vansco price, VAT and branch are required.");
 const priceFit=fitText(price[1],{width:650,maxLines:1,maxSize:116,minSize:72,measure});
 const vatX=Math.min(780,72+measureWidth(price[1],priceFit.size)+24);
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">'+
 '<title>'+escapeXml("Vansco · "+model.title+" · "+model.registration)+'</title>'+
 '<defs><linearGradient id="vansco-night" x2="0.8" y2="1"><stop stop-color="#22282b"/><stop offset="1" stop-color="#070b0e"/></linearGradient></defs>'+
 '<rect width="1080" height="1920" fill="url(#vansco-night)"/>'+
 '<path d="M 810 0 H 1080 V 1920 H 960 Z" fill="#d6b75a" opacity=".045"/>'+
 '<path d="M 72 218 H 1008" stroke="'+gold+'" stroke-width="3" opacity=".6"/>'+
 '<image href="'+rasterUri(logoDataUrl)+'" x="72" y="250" width="590" height="106" preserveAspectRatio="xMinYMid meet"/>'+
 '<rect x="792" y="278" width="216" height="58" rx="9" fill="#2a3033" stroke="'+gold+'" stroke-width="2"/>'+
 text(model.registration,813,318,30,white,800)+
 text(nameFit.lines[0],72,425,nameFit.size,white,900)+
 text(trimFit.lines[0],76,477,trimFit.size,gold,500)+
 '<image href="'+rasterUri(photoDataUrl)+'" x="0" y="500" width="1080" height="810" preserveAspectRatio="xMidYMid meet"/>'+
 '<rect x="72" y="1336" width="60" height="4" fill="'+gold+'"/>'+
 text(factFit.lines[0],154,1350,factFit.size,"#dce0e1",500)+
 text(price[1],72,1453,priceFit.size,white,900)+
 text(price[2],vatX,1453,44,gold,700)+
 text(model.branch.label,72,1494,32,"#dce0e1",500)+
 '<rect x="72" y="1520" width="936" height="60" rx="10" fill="#ca2638"/>'+
 text("VIEW THIS VAN",100,1558,36,white,900)+
 '<circle cx="952" cy="1550" r="21" fill="#ffffff" opacity=".12"/>'+
 '<path d="M 942 1540 L 956 1550 L 942 1560 M 930 1550 H 955" stroke="#ffffff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+
 text("vansco.co.uk",590,1558,28,white,500)+
 (safeGuide?'<rect x="72" y="250" width="936" height="1330" fill="none" stroke="#09a3be" stroke-width="4" stroke-dasharray="16 12"/><rect width="1080" height="250" fill="#09a3be" opacity=".18"/><rect y="1580" width="1080" height="340" fill="#09a3be" opacity=".18"/>':"")+
 '</svg>';
}
