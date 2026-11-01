import {createHash} from "node:crypto";
import {head,put,list} from "@vercel/blob";
import {ownedStoryArtworkUrl,storyRegistration} from "./storyArtworkPolicy.js";
export const STORY_STORAGE_PREFIX="story-artwork/v1";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const missing=e=>e?.name==="BlobNotFoundError"||e?.code==="blob_not_found"
 || /^(?:Vercel Blob: )?The requested blob does not exist\.?$/i.test(String(e?.message||""));
export async function inspectOwnedStoryArtwork(url,brandKey,registration,{fetchImpl=fetch,expectedBytes}={}) {
 const verified=ownedStoryArtworkUrl(url,brandKey,registration);
 if(!verified)throw Error("story_hosted_identity_invalid");
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 let reader;
 try{
  const r=await fetchImpl(verified,{method:"GET",redirect:"error",cache:"no-store",signal:controller.signal});
  if(!r.ok||r.url&&r.url!==verified||r.headers.get("content-type")?.split(";")[0]!=="image/png"
    ||Number(r.headers.get("content-length"))>4_000_000||!r.body?.getReader)throw Error("story_hosted_image_unverified");
  reader=r.body.getReader();const chunks=[];let length=0;
  for(;;){const p=await reader.read();if(p.done)break;length+=p.value.length;if(length>4_000_000)throw Error("story_hosted_image_too_large");chunks.push(Buffer.from(p.value))}
  const bytes=Buffer.concat(chunks,length),digest=new URL(verified).pathname.split("/").at(-1).slice(0,-4);
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ||bytes.readUInt32BE(16)!==1080||bytes.readUInt32BE(20)!==1920
    ||hash(bytes)!==digest||expectedBytes&&!bytes.equals(expectedBytes))throw Error("story_hosted_bytes_changed");
  return {url:verified,contentType:"image/png",sizeBytes:bytes.length,sha256:digest};
 }finally{clearTimeout(timer);await reader?.cancel().catch(()=>{})}
}
async function usage(prefix,listImpl){
 let cursor,count=0,bytes=0;
 for(let page=0;page<4;page++){
  const r=await listImpl({prefix,limit:1000,...(cursor?{cursor}:{})});
  if(!Array.isArray(r?.blobs)||typeof r.hasMore!=="boolean")throw Error("story_storage_inventory_unknown");
  for(const b of r.blobs){
   if(!b.pathname?.startsWith(prefix)||!Number.isSafeInteger(b.size)||b.size<0)throw Error("story_storage_inventory_invalid");
   count++;bytes+=b.size;
  }
  if(!r.hasMore)return {count,bytes};
  if(!r.cursor||r.cursor===cursor)throw Error("story_storage_inventory_incomplete");
  cursor=r.cursor;
 }
 throw Error("story_storage_cap_reached");
}
export async function hostStoryArtwork({brandKey,registration,supplierStockId,png,provenance,dueAt},{
 headImpl=head,putImpl=put,listImpl=list,fetchImpl=fetch,now=Date.now(),
}={}){
 const reg=storyRegistration(registration);
 if(!["vanFinance","rent2buy","vansco"].includes(brandKey)||!supplierStockId
   ||!Buffer.isBuffer(png)||png.length>4_000_000||png.length<24
   ||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
   ||png.readUInt32BE(16)!==1080||png.readUInt32BE(20)!==1920)throw Error("story_storage_input_invalid");
 const due=Date.parse(dueAt);
 if(!Number.isFinite(due)||due<now-86400000||due>now+7*86400000)throw Error("story_storage_schedule_invalid");
 const prefix=STORY_STORAGE_PREFIX+"/"+brandKey+"/";
 const root=prefix+reg+"/"+hash(String(supplierStockId))+"/";
 const digest=hash(png),pathname=root+digest+".png";
 let existing;
 try{existing=await headImpl(pathname)}
 catch(e){if(!missing(e))throw e}
 if(existing&&(existing.pathname!==pathname||existing.size!==png.length||existing.contentType!=="image/png"))throw Error("story_storage_collision");
 // Count PNGs, provenance and day leases. Fail closed; never delete live media.
 const budget=await usage(prefix,listImpl);
 const metadata=JSON.stringify({version:1,brandKey,registration:reg,supplierStockId,sha256:digest,
   ...provenance,retainUntil:new Date(due+90*86400000).toISOString()});
 if(metadata.length>16000)throw Error("story_provenance_too_large");
 // Leave headroom for races and metadata; reused objects remain usable at cap.
 if(!existing&&(budget.count+3>1000||budget.bytes+png.length+32000>1_000_000_000))throw Error("story_storage_cap_reached");
 const upload=async(path,body,contentType)=> {
  try{return await putImpl(path,body,{access:"public",contentType,addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:31536000})}
  catch(e){if(e?.name!=="BlobAlreadyExistsError")throw e;return headImpl(path)}
 };
 const stored=existing||await upload(pathname,png,"image/png");
 const verified=await inspectOwnedStoryArtwork(stored?.url,brandKey,reg,{fetchImpl,expectedBytes:png});
 // Immutable per-artwork provenance and per-day leases; retries cannot shorten retention.
 // No automatic expiry/deletion: a separate owner-reviewed cleanup must check Buffer refs.
 if(!existing || budget.count+2<=1000&&budget.bytes+32000<=1_000_000_000) {
  await upload(root+digest+".json",metadata,"application/json");
  await upload(root+"leases/"+new Date(due).toISOString().slice(0,10)+".json",
    JSON.stringify({dueDay:new Date(due).toISOString().slice(0,10),retainUntil:new Date(due+90*86400000).toISOString()}),"application/json");
 } else throw Error("story_storage_lease_cap_reached");
 return {...verified,pathname,provenance};
}
