import { createClient } from "@supabase/supabase-js";
export default async function handler(req,res){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const stock=await sb.from("facebook_adverts").select("title,vanSpec,is_active").eq("is_active",true).limit(1);
  const value=stock.data?.[0]?.vanSpec;
  const text=String(value??"");
  const compact=text.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g,"");
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({ok:true,error:stock.error?.message||null,type:typeof value,text,length:text.length,indexOfMileage:text.toUpperCase().indexOf("MILEAGE"),compact,compactIndex:compact.indexOf("MILEAGE"),chars:Array.from(text).slice(0,100).map(c=>({c,code:c.codePointAt(0)}))});
}
