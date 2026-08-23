import { createClient } from "@supabase/supabase-js";

const WIX_FEED = "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";
const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const regKey = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
function registration(...values){const text=values.map(clean).join(" ").toUpperCase();const m=text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);return m?regKey(m[1]):"";}
function digitsAfterLabel(value,label,maxChars=32){const text=String(value||"");const upper=text.toUpperCase();const wanted=String(label||"").toUpperCase();const index=upper.indexOf(wanted);if(index<0)return"";const tail=text.slice(index+wanted.length,index+wanted.length+maxChars);let digits="",started=false;for(const ch of tail){if(ch>="0"&&ch<="9"){digits+=ch;started=true;continue;}if(!started)continue;if(ch===","||ch===" "||ch==="\t")continue;break;}return digits;}
function imageUrl(value){if(value&&typeof value==="object"){for(const key of ["src","url","imageUrl","imageURL"]){if(value[key])return imageUrl(value[key]);}}const text=clean(value);if(/^https?:\/\//i.test(text))return text;const wix=text.match(/wix:image:\/\/v1\/([^/#?]+)/i);return wix?`https://static.wixstatic.com/media/${wix[1]}`:"";}

export default async function handler(req,res){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const [stock,wixResp]=await Promise.all([sb.from("facebook_adverts").select("title,price,vanDescription,vanSpec,weblink,picture,is_active").eq("is_active",true).limit(5),fetch(WIX_FEED,{cache:"no-store"})]);
  const payload=await wixResp.json(); const wixMap=new Map((payload.items||[]).map(i=>[regKey(i.registration),i]));
  const samples=(stock.data||[]).map(r=>{const reg=registration(r.title,r.weblink,r.vanDescription,r.vanSpec);const wix=wixMap.get(reg);const raw=Array.isArray(wix?.images)?wix.images.slice(0,2):[];return{reg,wix:!!wix,mileage:digitsAfterLabel(r.vanSpec,"MILEAGE"),rawImageType:raw.map(x=>typeof x),rawImages:raw,parsedImages:raw.map(imageUrl),picture:r.picture,parsedPicture:imageUrl(r.picture)};});
  res.setHeader("Cache-Control","no-store");res.status(200).json({ok:true,stockError:stock.error?.message||null,wixCount:payload.items?.length||0,samples});
}
