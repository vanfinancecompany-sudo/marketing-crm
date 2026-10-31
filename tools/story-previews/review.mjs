// Isolated public read verification. No credentials or production writes.
import {mkdir,writeFile} from "node:fs/promises";
const out=new URL("../../story-preview-output/",import.meta.url);await mkdir(out,{recursive:true});
const urls=[
 "https://www.vanfinancecompany.co.uk/vans/ds69rfo",
 "https://www.rent2buyvans.co.uk/van-pages/fv74bbj",
 "https://marketing-crm-six.vercel.app/api/vansco-google-vehicle-feed",
 "https://marketing-crm-six.vercel.app/api/vansco-dealerkit-google-vehicle-feed",
];
await Promise.all(urls.map(async(url,index)=>{
 try {
 const res=await fetch(url,{method:"GET",signal:AbortSignal.timeout(45000),headers:{Accept:"application/json,text/html,text/tab-separated-values,text/csv","User-Agent":"MarketingCRM-Story-Preview-Review/1.0"}});
 const body=await res.text();await writeFile(new URL("source-"+index+".txt",out),body);
 const data=[...body.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
 const summary=data.length?{data,headings:[...body.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map(x=>x[1].replace(/<[^>]+>/g,"")),images:[...body.matchAll(/(?:src|href)=["']([^"']*(?:wixstatic|acdn)[^"']*)["']/gi)].map(x=>x[1]).slice(0,6),excerpt:body.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,9000)}:body.slice(0,18000);
 console.log(JSON.stringify({url,status:res.status,finalUrl:res.url,bytes:body.length,summary}));
 }catch(e){console.log(JSON.stringify({url,error:e.message}))}
}));
