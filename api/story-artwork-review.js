// Protected preview rehearsal only. Never publishes, uploads, changes rollout
// flags or returns supplier IDs/credentials. Production always returns 404.
import {createHash} from "node:crypto";
import {fetchDealerKitStockSnapshot,fetchDealerKitStockDetail} from "./_dealerkit-stock-adapter.js";
import {fetchVanscoMetaCatalogue} from "./_vansco-facebook-source.js";
import {loadCurrentStoryVehicle,prepareSelectedStoryArtwork} from "./_story-artwork.js";
import {storyRegistration} from "../lib/storyArtworkPolicy.js";

export const config={maxDuration:180};
const PROJECT="prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";
export function createStoryArtworkReview({env=process.env,
 getSnapshot=()=>fetchDealerKitStockSnapshot({allowPartial:true}),
 getDetail=id=>fetchDealerKitStockDetail(id,{specifications:false}),
 getMeta=()=>fetchVanscoMetaCatalogue({preferLiveMetaImages:true,storyPrimaryProof:true}),
 loadVehicle=loadCurrentStoryVehicle,compose=prepareSelectedStoryArtwork,
}={}){
 return async function handler(request,response){
  response.setHeader("Cache-Control","no-store");
  response.setHeader("X-Robots-Tag","noindex, nofollow");
  response.setHeader("X-Content-Type-Options","nosniff");
  // Preview URLs are Vercel-auth protected for this project. Restrict access to
  // the immutable deployment hostname, not custom/production/branch aliases.
  if(env.VERCEL_ENV!=="preview"||env.VERCEL_PROJECT_ID!==PROJECT||
   !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL||"")||
   request.headers?.host!==env.VERCEL_URL)
   return response.status(404).json({ok:false});
  if(request.method!=="GET"){
   response.setHeader("Allow","GET");return response.status(405).json({ok:false});
  }
  const brandKey=request.query?.brandKey;
  let registration;
  try{
   if(!["vanFinance","rent2buy","vansco"].includes(brandKey))throw Error();
   registration=storyRegistration(request.query?.registration);
  }catch{return response.status(400).json({ok:false,reason:"invalid_review_vehicle"})}
  try{
   const snapshot=await getSnapshot();
   let vehicle;
   if(brandKey==="vansco"){
    const matches=(await getMeta()).filter(v=>v.registration===registration);
    if(matches.length!==1)throw Error("story_meta_identity_ambiguous");
    vehicle=matches[0];
   }
   const selected=await loadVehicle({brandKey,registration,vehicle},{getSnapshot:async()=>snapshot,getDetail});
   const result=await compose({brandKey,registration},{dryRun:true,
    loadVehicle:async()=>selected,host:()=>{throw Error("review_upload_forbidden")}});
   const sha256=createHash("sha256").update(result.png).digest("hex");
   const proof={ok:true,dryRun:true,brandKey,registration,title:result.model.title,
    checkedAt:new Date().toISOString(),commit:env.VERCEL_GIT_COMMIT_SHA,
    sourceKind:selected.source.kind,firstImageIndex:0,firstImageUrl:selected.imageSource,
    metaPrimaryMatches:brandKey==="vansco"?selected.imageSource===vehicle.storyMetaPrimaryImage:undefined,
    sourceSha256:result.provenance.sourceSha256,pricingMode:result.model.pricingMode,
    png:{sha256,bytes:result.png.length,width:1080,height:1920},
    uploads:0,bufferWrites:0};
   if(request.query?.format==="png"){
    response.setHeader("Content-Type","image/png");
    response.setHeader("X-Story-Artwork-Sha256",sha256);
    return response.status(200).send(result.png);
   }
   return response.status(200).json(proof);
  }catch(error){
   // Return bounded categories only; adapter errors may contain private context.
   const reason=String(error?.message||"").match(/^story_[a-z0-9_]+\b/)?.[0]||"story_review_held";
   return response.status(422).json({ok:false,dryRun:true,brandKey,registration,reason,uploads:0,bufferWrites:0});
  }
 };
}
export default createStoryArtworkReview();
