
import {bufferDormantPayload,isBufferScheduledRunDue} from "../lib/bufferActiveWindow.js";
import {bufferDeferredPayload,isBufferRateLimitCooldownError} from "../lib/bufferRuntimeGuard.js";
import {
 buildVanscoFacebookCaption,chooseVanscoCandidate,extractVanscoVehicleUrl,
 isEligibleVanscoVehicle,isVanscoVatResolved,
 vanscoFacebookImageUrls,vanscoDailySlots,vanscoNextDateKey,
} from "../lib/vanscoFacebookAutomation.js";
import {fetchVanscoMetaCatalogue,enrichVanscoVehicleFromPage} from "./_vansco-facebook-source.js";
import {deleteVanscoBufferPost} from "./_vansco-buffer-runtime.js";
import {
 vanscoInstagramConfig,vanscoInstagramState,vanscoInstagramHistory,
 saveVanscoInstagramHistory,saveVanscoInstagramStatus,createVanscoInstagramPost
} from "./_vansco-instagram-runtime.js";
import {londonDateKeyForValue} from "../lib/bufferAutomation.js";

const TARGET=20;
const MAX_CREATE_PER_RUN=6;
const MAX_REMOVE_PER_RUN=4;
const MIN_LEAD_MS=12*60*1000;
const clean=x=>String(x||"").trim();
const dateOf=x=>{const d=new Date(x||0);return Number.isNaN(d.getTime())?"":londonDateKeyForValue(d)};
const scheduled=posts=>(posts||[]).filter(p=>["scheduled","sending"].includes(clean(p.status).toLowerCase()));
const due=post=>new Date(post?.dueAt||0).getTime();
export const config={maxDuration:180};
function authorised(req){
 const supplied=clean(req.headers["x-marketing-customer-database-key"]);
 const auth=clean(req.headers.authorization);
 const key=clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
 const cron=clean(process.env.CRON_SECRET);
 return Boolean((key&&(supplied===key||auth==="Bearer "+key))||(cron&&auth==="Bearer "+cron));
}
export function instagramBufferSlots({day,now=Date.now(),posts=[],limit=TARGET,remaining=TARGET}){
 const occupied=new Set(posts.map(p=>due(p)).filter(Boolean));
 return vanscoDailySlots(day,Math.min(TARGET,limit)).filter(p=>{
   const t=new Date(p.dueAt).getTime();
   return t>now+MIN_LEAD_MS&&!occupied.has(t);
 }).slice(0,Math.max(0,remaining));
}
export function instagramRemainingCapacity({state,target=TARGET,organisationCapacity=100}){
 const sent=Number(state?.limit?.sent||0);
 const providerScheduled=Number(state?.limit?.scheduled||0);
 // A newly connected channel can have no dailyPostingLimits row yet.
 // Number(null) is zero, which previously blocked every initial post.
 // Unknown capacity is conservatively bounded by our 20-post target;
 // a genuine reported limit of 0 still blocks publishing.
 const hasProviderLimit=state?.limit?.limit!==null
   &&state?.limit?.limit!==undefined
   &&state?.limit?.limit!=="";
 const providerLimit=hasProviderLimit?Number(state.limit.limit):null;
 const livePosts=scheduled(state?.posts||[]);
 const seen=livePosts.length;
 const providerRemaining=hasProviderLimit&&Number.isFinite(providerLimit)&&providerLimit>=0
   ?Math.max(0,providerLimit-sent-providerScheduled):target;
 return Math.max(0,Math.min(
  target-sent-providerScheduled,
  providerRemaining,
  organisationCapacity-seen,
  MAX_CREATE_PER_RUN
 ));
}
export default async function handler(request,response){
 response.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(request.method))return response.status(405).json({ok:false,error:"Method not allowed"});
 if(!authorised(request))return response.status(401).json({ok:false,error:"Not authorised"});
 const dryRun=clean(request.query?.dryRun).toLowerCase()==="true";
 const verifyBuffer=dryRun&&clean(request.query?.verifyBuffer).toLowerCase()==="true";
 // Only an explicit, authorised POST can override the scheduled-run window.
 const force=request.method==="POST"&&clean(request.query?.force).toLowerCase()==="true";
 const enabled=clean(process.env.VANSCO_INSTAGRAM_AUTOMATION_ENABLED).toLowerCase()==="true";
 console.info("[Vansco Instagram] Worker invoked", {
  enabled,dryRun,force,ukDate:londonDateKeyForValue(new Date()),scheduledRunDue:isBufferScheduledRunDue("status")
 });
 // The Vercel cron runs hourly in UTC, which shifts against London's local
 // two-hour windows during BST. Refill at each eligible hourly tick instead.
 // The six-post batch cap, current stock checks and Buffer quota guard remain.
 if(!isBufferScheduledRunDue("status")&&!dryRun&&!force)
  return response.status(200).json(bufferDormantPayload({job:"vansco-instagram"}));
 if(!enabled&&!dryRun)return response.status(200).json({ok:true,enabled:false,message:"Vansco Instagram worker built but disabled."});
 const now=Date.now(),today=londonDateKeyForValue(new Date(now));
 let stage="load_stock";
 try{
  const stock=await fetchVanscoMetaCatalogue({ preferLiveMetaImages: true });
  const vehicles=stock.filter(isEligibleVanscoVehicle);
  stage="load_instagram_history";
  const history=await vanscoInstagramHistory();
  if(dryRun){
   const preview=vehicles
    .filter(v=>v.branchKey&&!v.branchConflict&&isVanscoVatResolved(v))
    .slice(0,20).map(v=>({registration:v.registration,title:v.title,
     branch:v.branchKey,vehicleUrl:v.vehicleUrl,
     photo:vanscoFacebookImageUrls(v)[0]||"",caption:buildVanscoFacebookCaption(v)}));
   if(!verifyBuffer) return response.status(200).json({ok:true,dryRun:true,enabled,target:TARGET,stock:stock.length,
    eligible:vehicles.length,preview});
   stage="discover_instagram_channel";
   const config=await vanscoInstagramConfig({onStage:next=>{stage=next;}});
   stage="read_instagram_queue";
   const state=await vanscoInstagramState(config,new Date(now));
   if(state.hasNextPage)throw new Error("Cannot confirm Instagram queue safely: too many posts.");
   return response.status(200).json({ok:true,dryRun:true,enabled,target:TARGET,
    stock:stock.length,eligible:vehicles.length,channelName:config.channelName,
    queueNow:scheduled(state.posts).length,sentToday:Number(state?.limit?.sent||0),
    scheduledToday:Number(state?.limit?.scheduled||0),
    providerLimit:state?.limit?.limit??null,organisationQueueLimit:config.scheduledPostsLimit,
    availableToQueue:instagramRemainingCapacity({state,organisationCapacity:Number(config.scheduledPostsLimit)||100}),
    preview:preview.slice(0,3)});
 
  }
  stage="discover_instagram_channel";
  const settings=await vanscoInstagramConfig({onStage:next=>{stage=next;}});
  stage="read_instagram_queue";
  const todayState=await vanscoInstagramState(settings,new Date(now));
  if(todayState.hasNextPage)throw new Error("Instagram queue is too large to confirm safe deduplication.");
  const liveUrls=new Set(vehicles.map(v=>v.vehicleUrl));
  const removed=[];
  let todaysQueue=scheduled(todayState.posts);
  stage="check_queued_stock";
  for(const p of todaysQueue){
   if(removed.length>=MAX_REMOVE_PER_RUN)break;
   const vehicleUrl=extractVanscoVehicleUrl(p.text);
   if(!vehicleUrl||liveUrls.has(vehicleUrl))continue;
   try{stage="delete_unavailable_post";await deleteVanscoBufferPost(p.id);stage="check_queued_stock";removed.push({postId:p.id,reason:"no_longer_available",vehicleUrl})}
   catch(e){removed.push({postId:p.id,reason:"delete_failed",error:clean(e.message).slice(0,160)})}
  }
  todaysQueue=todaysQueue.filter(p=>!removed.some(v=>v.postId===p.id&&v.reason!=="delete_failed"));
  let date=today;
  const todaySlots=instagramBufferSlots({day:date,now,posts:todaysQueue,limit:TARGET});
  // When today's daypart is over, refill tomorrow rather than leaving the queue empty.
  if(!todaySlots.length)date=vanscoNextDateKey(today);
  const future=date!==today;
  stage="read_future_queue";
  const state=future?await vanscoInstagramState(settings,new Date(date+"T12:00:00Z")):todayState;
  if(state.hasNextPage)throw new Error("Instagram queue pagination requires attention; refusing to double post.");
  const activePosts=scheduled(state.posts);
  const remaining=instagramRemainingCapacity({
   state:{...state,posts:future?activePosts:todaysQueue},
   organisationCapacity:Number(settings.scheduledPostsLimit)||100
  });
  const slots=instagramBufferSlots({day:date,now,posts:activePosts,remaining,limit:TARGET});
  const excluded=new Set(activePosts.map(p=>extractVanscoVehicleUrl(p.text)).filter(Boolean));
  const created=[],held=[];
  for(const slot of slots){
   let success=false;
   for(let retry=0;retry<5;retry++){
    stage="select_stock";
    let candidate=chooseVanscoCandidate({vehicles,lastPostedByKey:history.lastPostedByKey,excludedUrls:[...excluded]});
    if(!candidate)break;
    if(!candidate.branchKey||candidate.branchConflict||!isVanscoVatResolved(candidate)){
     candidate=await enrichVanscoVehicleFromPage(candidate);
    }
    if(!candidate.branchKey||candidate.branchConflict||!isVanscoVatResolved(candidate)){
     excluded.add(candidate.vehicleUrl);
     held.push({vehicleUrl:candidate.vehicleUrl,reason:"unresolved_branch_or_vat"});
     continue;
    }
    const media=vanscoFacebookImageUrls(candidate)[0];
    if(!media){excluded.add(candidate.vehicleUrl);continue;}
    try{
     stage="create_instagram_post";
     const p=await createVanscoInstagramPost({
      config:settings,text:buildVanscoFacebookCaption(candidate),
      imageUrl:media,vehicleId:candidate.vehicleId,dueAt:slot.dueAt
     });
     excluded.add(candidate.vehicleUrl);
     history.lastPostedByKey[candidate.vehicleKey]=slot.dueAt;
     created.push({registration:candidate.registration,vehicleUrl:candidate.vehicleUrl,
      postId:p.id,dueAt:p.dueAt||slot.dueAt});
     success=true;break;
    }catch(e){
     if(isBufferRateLimitCooldownError(e))throw e;
     excluded.add(candidate.vehicleUrl);
     held.push({vehicleUrl:candidate.vehicleUrl,error:clean(e?.message).slice(0,180)});
     if(!/duplicate|media|image|format/i.test(clean(e?.message)))throw e;
    }
   }
   if(!success)break;
  }
  stage="save_instagram_history";
  if(created.length)await saveVanscoInstagramHistory(history.lastPostedByKey);
  const result={ok:true,enabled:true,target:TARGET,date:today,scheduleDate:date,
   sentToday:Number(todayState?.limit?.sent||0),
   scheduledToday:Number(todayState?.limit?.scheduled||0),
   providerLimit:Number(todayState?.limit?.limit||0),
   queued:activePosts.length+created.length,
   created:created.length,items:created,removed,held:held.slice(0,12),
   stockCount:stock.length,eligibleCount:vehicles.length,
   channelName:settings.channelName,
   channelId:settings.channelId,
   state:"healthy"};
  stage="save_instagram_status";
  await saveVanscoInstagramStatus(result);
  console.info("[Vansco Instagram] Queue update",{
   created:result.created, queued:result.queued, sentToday:result.sentToday,
   scheduledToday:result.scheduledToday, held:result.held.length
  });
  return response.status(200).json(result);
 }catch(e){
  if(isBufferRateLimitCooldownError(e)){
   const state=bufferDeferredPayload(e,{job:"vansco-instagram",enabled,stage});
   await saveVanscoInstagramStatus({date:today,target:TARGET,state:"cooldown",...state}).catch(()=>{});
   return response.status(202).json(state);
  }
  const message=clean(e?.message)||"Vansco Instagram worker failed";
  console.error("[Vansco Instagram] Worker failed",{stage,message:message.slice(0,200)});
  await saveVanscoInstagramStatus({date:today,target:TARGET,state:"failed",stage,error:message}).catch(()=>{});
  return response.status(500).json({ok:false,enabled,stage,error:message.slice(0,250)});
 }
}
