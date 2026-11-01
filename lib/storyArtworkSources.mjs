import {createHash} from "node:crypto";
import {storyRegistration} from "./storyArtworkPolicy.js";
import {publishedRetailVat} from "../tools/story-previews/sources.mjs";
import {pendingRent2BuySpecialDeal} from "./rent2BuyProtectedSpecialDeals.mjs";
import {verifyRent2BuyQuoteToken} from "./rent2BuyQuoteHandoff.mjs";
import {verifyRent2BuyQuoteAgainstSource} from "./rent2BuyCurrentSourceQuote.mjs";
import {isEligibleVanscoVehicle, vanscoSocialTitle} from "./vanscoFacebookAutomation.js";

export const STORY_PAGE_ORIGINS = Object.freeze({
  vanFinance: "https://www.vanfinancecompany.co.uk",
  rent2buy: "https://www.rent2buyvans.co.uk",
});
const allowed = new Set(["www.vanfinancecompany.co.uk", "www.rent2buyvans.co.uk", "static.wixstatic.com", "acdn.uk"]);
export function checkedStorySourceUrl(value, image = false) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash || !allowed.has(u.hostname))
    throw Error("story_source_url_rejected");
  if (image && !(u.hostname === "static.wixstatic.com" && u.pathname.startsWith("/media/")
    || u.hostname === "acdn.uk" && u.pathname.startsWith("/vansco/i/")))
    throw Error("story_photo_host_rejected");
  if (!image && !Object.values(STORY_PAGE_ORIGINS).includes(u.origin)) throw Error("story_page_host_rejected");
  return u.href;
}
export async function boundedStoryGet(url, {fetchImpl = fetch, image = false, maxBytes = image ? 8_000_000 : 6_000_000} = {}) {
  const requested = checkedStorySourceUrl(url, image);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetchImpl(requested, {method:"GET", redirect:"error", cache:"no-store",
      signal:controller.signal, headers:{Accept:image ? "image/jpeg,image/png" : "text/html"}});
    if (!response.ok || response.url && response.url !== requested) throw Error("story_source_http_" + response.status);
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) throw Error("story_source_too_large");
    if (!response.body?.getReader) throw Error("story_source_stream_unavailable");
    reader = response.body.getReader();
    const parts=[]; let length=0;
    for (;;) {
      const part=await reader.read(); if (part.done) break;
      length+=part.value.byteLength;
      if(length>maxBytes) throw Error("story_source_too_large");
      parts.push(Buffer.from(part.value));
    }
    return {bytes:Buffer.concat(parts,length),type:(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase()};
  } finally { clearTimeout(timer); await reader?.cancel().catch(()=>{}); }
}
export function publishedStoryVehicle(html, brandKey, registration) {
  const reg=storyRegistration(registration);
  const origin=STORY_PAGE_ORIGINS[brandKey];
  if(!origin) throw Error("story_brand_invalid");
  const vehicleUrl=origin+(brandKey==="vanFinance"?"/vans/":"/van-pages/")+reg.toLowerCase();
  const objects=[...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(m=>{try{const v=JSON.parse(m[1]);return Array.isArray(v)?v:[v,...(v["@graph"]||[])]}catch{return []}});
  const matches=objects.filter(v=>v["@type"]==="Vehicle"&&String(v.sku||v.identifier||"").replace(/\s/g,"").toUpperCase()===reg);
  if(matches.length!==1) throw Error("story_page_identity_ambiguous");
  const v=matches[0];
  if(v.url!==vehicleUrl)throw Error("story_page_canonical_mismatch: "+String(v.url||"missing"));
  if(v.offers?.availability && v.offers.availability!=="https://schema.org/InStock")
    throw Error("story_page_not_in_stock");
  if(/archived|previously listed|no longer (?:available|shown)/i.test(v.description||"")
    || /VEHICLE ARCHIVE/.test(html))throw Error("story_page_archived");
  // Both sites serialize the exact StockGallery images array in Vehicle.image.
  // Preserve index 0: never sort, skip a broken primary, or borrow DealerKit order.
  const images=Array.isArray(v.image)?v.image:[v.image];
  if(!images.length||typeof images[0]!=="string") throw Error("story_first_image_missing");
  const first=checkedStorySourceUrl(images[0],true);
  const year=Number(String(v.vehicleModelDate||"").match(/^\d{4}/)?.[0]);
  const price=v.offers?.priceCurrency==="GBP"?Number(v.offers.price):undefined;
  return {registration:reg,vehicleUrl,title:String(v.name||"").replace(/^\d{4}(?:\/\d{2})?\s+/,"").split(/\s+(?:Panel Van|Crew Van|Chassis Cab|Pickup|MPV)\b/i)[0],
    year:Number.isFinite(year)?year:undefined,mileage:v.mileageFromOdometer?.value == null?undefined:Number(v.mileageFromOdometer.value),
    fuel:v.fuelType,transmission:v.vehicleTransmission,price,
    vatLabel:publishedRetailVat(html,price),status:"available",
    imageSource:first,photoRegistration:reg,
    source:{url:vehicleUrl,checkedAt:new Date().toISOString(),kind:"brand_published_gallery_index_0",galleryCount:images.length}};
}
export function verifyStoryStock(registration, snapshot, detail, expectedSupplierId) {
  const reg=storyRegistration(registration);
  if(!snapshot?.complete && !snapshot?.diagnostics?.knownSourceFaults?.baselineOnly) throw Error("story_stock_incomplete");
  const matches=(snapshot.vehicles||[]).filter(v=>v.registration===reg);
  if(matches.length!==1 || snapshot.diagnostics?.duplicateRegistrations?.some(v=>v.registration===reg))
    throw Error("story_stock_identity_ambiguous");
  const indexed=matches[0];
  if(!indexed.supplierStockId || indexed.status!=="available" || detail?.status!=="available")
    throw Error("story_stock_unavailable");
  if(detail.registration!==reg || detail.supplierStockId!==indexed.supplierStockId
    || expectedSupplierId && expectedSupplierId!==indexed.supplierStockId) throw Error("story_supplier_identity_changed");
  return String(indexed.supplierStockId);
}
export function vanscoStoryVehicle(vehicle, detail, checkedAt=new Date().toISOString()) {
  if(!isEligibleVanscoVehicle(vehicle)||!vehicle.vehicleId || vehicle.branchConflict
    || vehicle.registration!==detail.registration || vehicle.vehicleId!==detail.supplierStockId)
    throw Error("story_vansco_identity_unverified");
  const first=vehicle.imageUrls?.[0] || vehicle.imageUrl;
  if(!first || first!==vehicle.imageUrl || first!==vehicle.storyMetaPrimaryImage || vehicle.storyMetaVehicleId!==vehicle.vehicleId) throw Error("story_vansco_primary_conflict");
  // The worker's existing preferLiveMetaImages:true selection is authoritative.
  // Never supplement its first frame from old stock gallery images.
  const imageSource=checkedStorySourceUrl(first,true);
  const raw=String(vehicle.price||"").trim().replace(/,/g,"");
  if(!/^(?:£\s*)?\d+(?:\.\d{1,2})?(?:\s*GBP)?$/.test(raw)) throw Error("story_vansco_price_invalid");
  return {...vehicle,title:vanscoSocialTitle(vehicle),price:Number(raw.replace(/[£\s]|GBP/g,"")),
    year:Number(vehicle.year),mileage:Number(vehicle.mileage),fuel:detail.fuelType,transmission:detail.transmission,
    imageSource,photoRegistration:vehicle.registration,status:"available",
    source:{url:vehicle.vehicleUrl,checkedAt,kind:"eligible_live_meta_first_image",supplierStockId:vehicle.vehicleId}};
}
export function signedStoryRentalPricing(registration, {token,secret,source,manualSpecialStatus,now=Date.now()}={}) {
  if(pendingRent2BuySpecialDeal(registration)) return undefined; // Protected table always wins.
  const quote=verifyRent2BuyQuoteToken(token,secret,{registration,now});
  if(!quote || manualSpecialStatus!=="none" || !verifyRent2BuyQuoteAgainstSource(quote,source).ok) return undefined;
  return {quote,source,manualSpecialStatus:"none"};
}
export function verifiedStoryPhoto({bytes,type}) {
  const jpeg=type==="image/jpeg" && bytes.length>=8 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255 && bytes.at(-2)===255 && bytes.at(-1)===217;
  const png=type==="image/png" && bytes.length>=24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.subarray(-8,-4).toString("ascii")==="IEND";
  if(!jpeg&&!png) throw Error("story_first_image_invalid_or_unsupported");
  let width=0,height=0;
  if(png){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20)}
  if(jpeg){
    let offset=2;
    while(offset+9<bytes.length){
      if(bytes[offset]!==255)break;
      const marker=bytes[offset+1];offset+=2;
      if(marker===0xda||marker===0xd9)break;
      const size=bytes.readUInt16BE(offset);
      if(size<2||offset+size>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;
      } offset+=size;
    }
  }
  if(!width||!height||width>12000||height>12000||width*height>24_000_000)throw Error("story_source_dimensions_unsafe");
  return {bytes,type,sha256:createHash("sha256").update(bytes).digest("hex"),
    dataUrl:"data:"+type+";base64,"+bytes.toString("base64")};
}
