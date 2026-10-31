// Isolated review tool. Only public GETs; no publishing, CRM clients or credentials.
import { mkdir, writeFile } from "node:fs/promises";
const out = new URL("../../story-preview-output/", import.meta.url);
await mkdir(out, {recursive:true});
const urls = [
 "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages",
 "https://www.vanfinancecompany.co.uk/_functions/marketingRent2BuyImages",
 "https://www.vansco.co.uk/all-stock/",
 "https://www.vansco.co.uk/sitemap/",
];
for (const [index,url] of urls.entries()) {
 try {
  const response=await fetch(url,{method:"GET",signal:AbortSignal.timeout(20000),headers:{Accept:"application/json,text/html","User-Agent":"MarketingCRM-Story-Preview-Review/1.0"}});
  const body=await response.text();
  await writeFile(new URL("source-"+index+".txt",out),body);
  let summary;
  try {const json=JSON.parse(body);summary=JSON.stringify(json).slice(0,12000);}
  catch {summary=body.match(/<title[^>]*>[\s\S]*?<\/title>/i)?.[0]||"";}
  console.log(JSON.stringify({url,status:response.status,finalUrl:response.url,bytes:body.length,summary}));
 } catch(error) { console.log(JSON.stringify({url,error:error.message})); }
}
