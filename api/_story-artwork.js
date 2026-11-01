import {createHash} from "node:crypto";
import {ownedStoryArtworkUrl} from "../lib/storyArtworkPolicy.js";
// Dormant integration only. No endpoint, scheduler, channel discovery or Buffer client.
import {fetchDealerKitStockSnapshot,fetchDealerKitStockDetail} from "./_dealerkit-stock-adapter.js";
import {storyArtworkEnabled,storyRegistration} from "../lib/storyArtworkPolicy.js";
import {STORY_PAGE_ORIGINS,boundedStoryGet,publishedStoryVehicle,verifyStoryStock,
 vanscoStoryVehicle,verifiedStoryPhoto,signedStoryRentalPricing} from "../lib/storyArtworkSources.mjs";
import {buildStoryModel} from "../tools/story-previews/template.mjs";

export async function loadCurrentStoryVehicle({brandKey,registration,vehicle,rentalQuoteToken},{
 getSnapshot=()=>fetchDealerKitStockSnapshot({allowPartial:true}),
 getDetail=id=>fetchDealerKitStockDetail(id,{specifications:false}),fetchImpl=fetch,
 loadRentalSource=async reg=>(await import("./_rent2buy-quote-source.js")).loadRent2BuyPricingSource(reg),
}={}){
 const reg=storyRegistration(registration);
 const snapshot=await getSnapshot();
 const matches=(snapshot?.vehicles||[]).filter(v=>v.registration===reg);
 if(matches.length!==1||!matches[0].supplierStockId)throw Error("story_stock_identity_ambiguous");
 const detail=await getDetail(matches[0].supplierStockId);
 const supplierStockId=verifyStoryStock(reg,snapshot,detail,brandKey==="vansco"?vehicle?.vehicleId:undefined);
 let selected;
 if(brandKey==="vansco") selected=vanscoStoryVehicle(vehicle,detail);
 else {
  const origin=STORY_PAGE_ORIGINS[brandKey];
  if(!origin)throw Error("story_brand_invalid");
  const url=origin+(brandKey==="vanFinance"?"/vans/":"/van-pages/")+reg.toLowerCase();
  const page=await boundedStoryGet(url,{fetchImpl});
  selected=publishedStoryVehicle(page.bytes.toString("utf8"),brandKey,reg);
 }
 if(brandKey==="rent2buy"){
  // The existing worker has no signed quote envelope. Ordinary stock therefore
  // uses approved generic copy. Never parse amounts from the old Facebook caption.
  // A future caller may supply a source-verified signed context; not unsigned prices.
  if(rentalQuoteToken && process.env.RENT2BUY_QUOTE_VERIFIER_ENABLED==="true"){
   try {
    const currentSource=await loadRentalSource(reg);
    if(currentSource.vehicle.supplierStockId===supplierStockId)
     selected.rentalPricing=signedStoryRentalPricing(reg,{token:rentalQuoteToken,
      secret:process.env.RENT2BUY_QUOTE_SIGNING_SECRET,source:currentSource,manualSpecialStatus:"none"});
   } catch { /* Authoritative manual-special / current-source failure: generic copy. */ }
  }
 }
 return {...selected,supplierStockId,source:{...selected.source,supplierStockId,
   stockCheckedAt:snapshot.checkedAt||new Date().toISOString()}};
}
export async function prepareSelectedStoryArtwork(input,{
 env=process.env,loadVehicle=loadCurrentStoryVehicle,fetchImpl=fetch,
 render,host,dryRun=false,
}={}){
 if(!dryRun&&!storyArtworkEnabled(input.brandKey,env))return null;
 const vehicle=await loadVehicle(input);
 const photo=verifiedStoryPhoto(await boundedStoryGet(vehicle.imageSource,{fetchImpl,image:true}));
 const model=buildStoryModel(input.brandKey,vehicle);
 const renderImpl=render||(await import("../lib/storyArtworkRenderer.mjs")).renderApprovedStory;
 const rendered=await renderImpl(model,{photoDataUrl:photo.dataUrl});
 const provenance={source:vehicle.source,firstImageUrl:vehicle.imageSource,firstImageIndex:0,
   sourceSha256:photo.sha256,pricingMode:model.pricingMode,layoutCommit:"db662f517a23b2bfeae2511e274fa163af2694ac"};
 // Freshly composed caption only. In particular, never repeat stale rental prices.
 const text=[model.brand.name+" · TODAY'S STORY",model.registration,model.title,
   model.headline,...model.details,model.vehicleUrl].join("\n");
 const result={...rendered,vehicle,model,text,provenance};
 if(dryRun)return result; // Guaranteed no Blob / Buffer writes, even with rollout flags enabled.
 const hostImpl=host||(await import("../lib/storyArtworkStorage.mjs")).hostStoryArtwork;
 const hosted=await hostImpl({brandKey:input.brandKey,registration:model.registration,supplierStockId:vehicle.supplierStockId,
   png:rendered.png,provenance,dueAt:input.dueAt});
 return {...result,...hosted};
}

// Existing VFC Instagram Story mirror: the FB artwork may have been made hours
// earlier. Recheck availability and exact supplier identity before scheduling it.
export async function assertCurrentStoryArtworkStock(url,brandKey,registration,{
 getSnapshot=()=>fetchDealerKitStockSnapshot({allowPartial:true}),
 getDetail=id=>fetchDealerKitStockDetail(id,{specifications:false}),
}={}){
 const verified=ownedStoryArtworkUrl(url,brandKey,registration);
 if(!verified)throw Error("story_artwork_identity_invalid");
 const snapshot=await getSnapshot();
 const matches=(snapshot?.vehicles||[]).filter(v=>v.registration===registration);
 if(matches.length!==1||!matches[0].supplierStockId)throw Error("story_stock_identity_ambiguous");
 const detail=await getDetail(matches[0].supplierStockId);
 const supplierId=verifyStoryStock(registration,snapshot,detail);
 const supplierHash=createHash("sha256").update(supplierId).digest("hex");
 if(new URL(verified).pathname.split("/").at(-2)!==supplierHash)throw Error("story_artwork_supplier_changed");
 return true;
}
