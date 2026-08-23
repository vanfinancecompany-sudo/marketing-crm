import { createClient } from "@supabase/supabase-js";

const WIX_FEED = "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const regKey = (v) => clean(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
function registration(...values){const text=values.map(clean).join(" ").toUpperCase();const m=text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);return m?regKey(m[1]):"";}
function mileageFrom(spec){const d=String(spec||"").match(/MILEAGE\s*:\s*([0-9][0-9,]*)/i);return d?d[1].replace(/,/g,""):"";}
function yearFrom(spec){const d=String(spec||"").match(/YEAR\s*:\s*(20[0-3][0-9])/i);return d?d[1]:"";}
function makeFrom(text){const rules=[["Ford",/\bford\b/i],["Renault",/\brenault\b/i],["Vauxhall",/\bvauxhall\b/i],["Citroen",/\b(citroen|citroën)\b/i],["Toyota",/\btoyota\b/i],["Isuzu",/\bisuzu\b/i],["Volkswagen",/\b(volkswagen|vw)\b/i],["Peugeot",/\bpeugeot\b/i],["Nissan",/\bnissan\b/i],["Mercedes-Benz",/\b(mercedes|benz)\b/i]];return rules.find(([,r])=>r.test(clean(text)))?.[0]||"";}
function modelFrom(make,text){const l=clean(text).toLowerCase();if(make==="Ford"){if(/\bcustom\b/.test(l))return"Transit Custom";if(/\bconnect\b/.test(l))return"Transit Connect";if(/\bcourier\b/.test(l))return"Transit Courier";if(/\branger\b/.test(l))return"Ranger";if(/\btransit\b/.test(l))return"Transit";}const m={Renault:["Trafic","Master","Kangoo"],Vauxhall:["Vivaro","Combo","Movano"],Citroen:["Berlingo","Dispatch","Relay"],Toyota:["Proace","Hilux"],Isuzu:["D-Max"],Volkswagen:["Transporter","Caddy","Crafter","Amarok"],Peugeot:["Partner","Expert","Boxer"],Nissan:["Primastar","NV200","NV300","NV400","Interstar","Navara"],"Mercedes-Benz":["Sprinter","Vito","Citan"]};return (m[make]||[]).find(x=>l.includes(x.toLowerCase()))||"";}

export default async function handler(req,res){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const [stock,wixResp]=await Promise.all([sb.from("facebook_adverts").select("title,price,vanDescription,vanSpec,weblink,picture,is_active").eq("is_active",true).limit(20),fetch(WIX_FEED,{cache:"no-store"})]);
  const wixPayload=await wixResp.json(); const wixMap=new Map((wixPayload.items||[]).map(i=>[regKey(i.registration),i]));
  const samples=(stock.data||[]).map(r=>{const reg=registration(r.title,r.weblink,r.vanDescription,r.vanSpec);const wix=wixMap.get(reg);const title=clean(wix?.title);const combined=[title,clean(r.vanDescription),String(r.vanSpec||"")].join(" ");const make=makeFrom(combined),model=modelFrom(make,combined);const mileage=mileageFrom(r.vanSpec),year=yearFrom(r.vanSpec);return{reg,wix:!!wix,title,make,model,mileage,year,price:r.price,imageCount:Array.isArray(wix?.images)?wix.images.length:0,vanSpec:r.vanSpec};});
  res.setHeader("Cache-Control","no-store");res.status(200).json({ok:true,stockError:stock.error?.message||null,wixCount:wixPayload.items?.length||0,samples});
}
