
import {list,put} from "@vercel/blob";
import {inspectVanscoBufferAccount,loadVanscoBufferState,vanscoBufferCompatibleImageUrl} from "./_vansco-buffer-runtime.js";
import {BUFFER_CREATE_POST_MUTATION,buildBufferCreatePostInput,parseBufferCreatePostPayload} from "../lib/bufferPublishing.js";
import {guardedBufferGraphql} from "../lib/bufferRuntimeGuard.js";

const prefix="vansco-buffer-v1/instagram-";
const token=()=>String(process.env.VANSCO_BUFFER_API_KEY||process.env.BUFFER_API_KEY||"").trim();
async function read(name) {
 const path=prefix+name+".json";
 const response=await list({prefix:path,limit:10});
 const blob=(response.blobs||[]).find(x=>x.pathname===path);
 if(!blob)return null;
 const result=await fetch(blob.url+"?v="+Date.now(),{cache:"no-store"});
 return result.ok?result.json():null;
}
async function write(name,value) {
 await put(prefix+name+".json",JSON.stringify(value),{
  access:"public",contentType:"application/json",
  allowOverwrite:true,addRandomSuffix:false,cacheControlMaxAge:1
 });
 return value;
}
export async function vanscoInstagramConfig({refresh=false}={}){
 const cached=refresh?null:await read("config");
 if(cached?.channelId&&cached?.organizationId)return cached;
 const accounts=await inspectVanscoBufferAccount();
 const matching=accounts.flatMap(organization=>(organization.channels||[])
  .filter(ch=>String(ch.service||"").toLowerCase()==="instagram"
   &&!ch.isDisconnected&&!ch.isLocked
   &&/vansco[_. -]*limited|^vansco$/i.test(
    [ch.name,ch.displayName,ch.externalLink].join(" ").toLowerCase()))
  .map(channel=>({organization,channel})));
 if(matching.length!==1)throw new Error(matching.length?
  "Ambiguous Vansco Instagram channels. No post was created.":
  "Vansco Instagram channel not found in the connected Buffer organization.");
 const {organization,channel}=matching[0];
 return write("config",{
  channelId:channel.id,channelName:channel.displayName||channel.name,
  organizationId:organization.organizationId,
  scheduledPostsLimit:organization.scheduledPostsLimit||10,
  verifiedAt:new Date().toISOString()
 });
}
export const vanscoInstagramHistory=async()=>await read("history")||{lastPostedByKey:{}};
export const saveVanscoInstagramHistory=lastPostedByKey=>
 write("history",{lastPostedByKey,updatedAt:new Date().toISOString()});
export const vanscoInstagramStatus=async()=>await read("status");
export const saveVanscoInstagramStatus=status=>
 write("status",{...status,checkedAt:new Date().toISOString()});
export async function vanscoInstagramState(config,now=new Date()){
 const londonKey=new Intl.DateTimeFormat("en-CA",{
  timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(now);
 return loadVanscoBufferState(config,londonKey+"T12:00:00.000Z");
}
export async function createVanscoInstagramPost({config,text,imageUrl,dueAt}){
 const url=vanscoBufferCompatibleImageUrl(imageUrl);
 if(!url)throw new Error("Instagram image URL is not a supported public JPEG or PNG.");
 if(!token())throw new Error("Buffer API key is missing");
 const input=buildBufferCreatePostInput({
  channelId:config.channelId,platform:"instagram",
  text,mediaUrl:url,mediaKind:"image",dueAt
 });
 const data=await guardedBufferGraphql({
  url:"https://api.buffer.com",token:token(),
  query:BUFFER_CREATE_POST_MUTATION,variables:{input}
 });
 return parseBufferCreatePostPayload(data);
}
