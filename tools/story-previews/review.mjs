// Isolated review: public GETs only. No production credentials or writes.
import {mkdir,writeFile} from "node:fs/promises";
const out=new URL("../../story-preview-output/",import.meta.url);
await mkdir(out,{recursive:true});
const urls=[
 "https://www.vanfinancecompany.co.uk/",
 "https://www.rent2buyvans.co.uk/",
 "https://vansco.dragon2000.net/",
 ...["FV74BBJ","BT25LVK","CP16AZW"].map(reg=>"https://marketing-crm-six.vercel.app/api/vehicle-image-suite-stock?registration="+reg),
];
await Promise.all(urls.map(async(url,index)=>{
 try {
 const res=await fetch(url,{method:"GET",signal:AbortSignal.timeout(25000),headers:{Accept:"application/json,text/html","User-Agent":"MarketingCRM-Story-Preview-Review/1.0"}});
 const body=await res.text();await writeFile(new URL("source-"+index+".txt",out),body);
 let summary;
 try {summary=JSON.parse(body)}catch {
 const links=[...body.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(x=>x[1]);
 const data=[...body.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1].slice(0,3500));
 summary={title:body.match(/<title[^>]*>[\s\S]*?<\/title>/i)?.[0],links:links.filter(x=>/van|vehicle|stock|logo|rent2buy/i.test(x)).slice(0,100),data};
 }
 console.log(JSON.stringify({url,status:res.status,finalUrl:res.url,bytes:body.length,summary}));
 }catch(e){console.log(JSON.stringify({url,error:e.message}))}
}));
