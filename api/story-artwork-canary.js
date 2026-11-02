// One-off owner-authorised rollout tool. PREVIEW BRANCH ONLY; never merge.
import {prepareSelectedStoryArtwork,loadCurrentStoryVehicle} from "./_story-artwork.js";
import {fetchVanscoMetaCatalogue,enrichVanscoVehicleFromPage} from "./_vansco-facebook-source.js";
import {createStory,storySlotForRun} from "./buffer-facebook-story-automation.js";
import {createVanscoFacebookStory,loadVanscoBufferConfig} from "./_vansco-buffer-runtime.js";
import {BUFFER_API_URL,BUFFER_FACEBOOK_CHANNELS,bufferDestinationForProduct} from "../lib/bufferPublishing.js";
import {guardedBufferGraphql} from "../lib/bufferRuntimeGuard.js";
import {loadBufferAutomationConfig} from "../lib/bufferAutomationConfig.js";
import {facebookStoryTargetForProduct,bufferPostDateKey,isBufferFacebookStory,londonDateKeyForValue,isBufferPostReserved} from "../lib/bufferAutomation.js";
import {vanscoFacebookStorySlots,isVanscoVatResolved} from "../lib/vanscoFacebookAutomation.js";
import {STORY_ARTWORK_FLAGS,ownedStoryArtworkUrl} from "../lib/storyArtworkPolicy.js";
export const config={maxDuration:180};
const BRANCH="ops/story-rollout-canary-20261102";
const REGS={vanFinance:"CA74WVU",rent2buy:"FV74BEO",vansco:"CK24NRO"};
async function readPosts(channelId){
 const payload=await guardedBufferGraphql({url:BUFFER_API_URL,token:process.env.BUFFER_API_KEY,
  query:`query { posts(first:100,input:{organizationId:"6a8720b714b19791c7f51e13",sort:[{field:createdAt,direction:desc}],filter:{status:[draft,scheduled,sending,sent,error],channelIds:[${JSON.stringify(channelId)}]}}){edges{node{id text status dueAt sentAt createdAt channelId metadata{... on FacebookPostMetadata{type}} assets{id mimeType source}}}}}`});
 if(payload.errors?.length)throw Error(payload.errors[0].message);
 if(!Array.isArray(payload.data?.posts?.edges))throw Error("canary_queue_unverified");
 return payload.data.posts.edges.map(e=>e.node);
}
async function source(brandKey,registration){
 let vehicle;
 if(brandKey==="vansco"){
  const matches=(await fetchVanscoMetaCatalogue({preferLiveMetaImages:true,storyPrimaryProof:true})).filter(v=>v.registration===registration);
  if(matches.length!==1)throw Error("canary_meta_identity_ambiguous");
  vehicle=matches[0];
  if(!vehicle.branchKey||vehicle.branchConflict||!isVanscoVatResolved(vehicle))vehicle=await enrichVanscoVehicleFromPage(vehicle);
 }
 return loadCurrentStoryVehicle({brandKey,registration,vehicle});
}
export function createCanaryHandler({env=process.env,read=readPosts,load=source,compose=prepareSelectedStoryArtwork,
 settings=loadBufferAutomationConfig,vanscoConfig=loadVanscoBufferConfig,publish=createStory,publishVansco=createVanscoFacebookStory,now=Date.now}={}){
 return async(request,response)=>{
  response.setHeader("Cache-Control","no-store");response.setHeader("X-Robots-Tag","noindex, nofollow");
  if(env.VERCEL_ENV!=="preview"||env.VERCEL_PROJECT_ID!=="prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl"||env.VERCEL_GIT_COMMIT_REF!==BRANCH||
   !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL||"")||request.headers?.host!==env.VERCEL_URL)return response.status(404).json({ok:false});
  if(!["GET","POST"].includes(request.method))return response.status(405).json({ok:false});
  let body=request.body||{};if(typeof body==="string"){try{body=JSON.parse(body)}catch{return response.status(400).json({ok:false})}}
  const brandKey=request.method==="GET"?request.query?.brandKey:body.brandKey;
  if(!REGS[brandKey]||request.method==="POST"&&body.confirmOneStory!==true)return response.status(400).json({ok:false});
  try{
   const vc=brandKey==="vansco"?await vanscoConfig():null;
   const channelId=vc?.channelId||BUFFER_FACEBOOK_CHANNELS[bufferDestinationForProduct(brandKey)];
   const posts=await read(channelId);
   const owned=posts.filter(p=>(p.assets||[]).some(a=>ownedStoryArtworkUrl(a.source,brandKey,REGS[brandKey])));
   if(request.method==="GET"||owned.length)return response.status(200).json({ok:true,brandKey,existing:owned.map(p=>({id:p.id,status:p.status,dueAt:p.dueAt,sentAt:p.sentAt,assets:p.assets}))});
   const time=now(),today=londonDateKeyForValue(new Date(time));
   const cfg=await settings({dateKey:today});
   if(!cfg.enabled)throw Error("canary_automation_paused");
   const cap=brandKey==="vansco"?(Number(vc.scheduledPostsLimit)||10):35;
   if(posts.filter(isBufferPostReserved).length>=cap)throw Error("canary_queue_full");
   const target=brandKey==="vansco"?5:facebookStoryTargetForProduct(cfg,brandKey);
   let slot;
   for(let day=0;day<2&&!slot;day++){
    const dateKey=new Date(Date.parse(today+"T12:00:00Z")+day*86400000).toISOString().slice(0,10);
    const stories=posts.filter(p=>p.status!=="error"&&isBufferFacebookStory(p)&&bufferPostDateKey(p)===dateKey);
    if(stories.length>=target)continue;
    if(brandKey==="vansco")slot=vanscoFacebookStorySlots(dateKey,target).find(s=>Date.parse(s.dueAt)>time+10*60000&&!stories.some(p=>p.dueAt===s.dueAt));
    else {
     // Use the real worker's slot/target rules. A tomorrow rehearsal uses that
     // day's normal morning window only for slot selection, never to backdate.
     slot=storySlotForRun(posts,brandKey,dateKey,day?Date.parse(dateKey+"T08:00:00Z"):time,target).slot;
    }
   }
   if(!slot)throw Error("canary_no_capacity");
   const selected=await load(brandKey,REGS[brandKey]);
   const artwork=await compose({brandKey,registration:REGS[brandKey],dueAt:slot.dueAt},{env:{...env,[STORY_ARTWORK_FLAGS[brandKey]]:"true"},loadVehicle:async()=>selected});
   if(!artwork?.url)throw Error("canary_artwork_unverified");
   const post=brandKey==="vansco"?await publishVansco({config:vc,text:artwork.text,imageUrl:selected.imageSource,dueAt:slot.dueAt,
    vehicleId:artwork.vehicle.supplierStockId,storyArtwork:artwork}):await publish({productKey:brandKey,
     sourcePost:{text:artwork.text},dueAt:slot.dueAt,artwork});
   return response.status(200).json({ok:true,brandKey,registration:REGS[brandKey],created:true,id:post.id,status:post.status,dueAt:post.dueAt||slot.dueAt,
    imageUrl:artwork.url,bytes:artwork.sizeBytes,sha256:artwork.sha256});
  }catch(error){return response.status(422).json({ok:false,brandKey,error:String(error.message).slice(0,250)})}
 };
}
export default createCanaryHandler();
