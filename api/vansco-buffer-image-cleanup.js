import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { cleanConfirmedSoldVanscoImages } from "../lib/vanscoSoldImageCleanup.js";

// No Buffer API calls. Only explicitly verified sold/awaiting-delivery
// stock rows can authorize deletion of v2-owned Vansco media.
export const config = { maxDuration: 180 };
export default async function handler(request,response) {
  response.setHeader("Cache-Control","no-store");
  if (request.method!=="GET" && request.method!=="POST") return response.status(405).json({ok:false,error:"Method not allowed."});
  const secret=String(process.env.CRON_SECRET||"").trim();
  if (!secret || String(request.headers.authorization||"")!=="Bearer "+secret) {
    return response.status(401).json({ok:false,error:"Vansco cleanup requires cron authorization."});
  }
  const dryRun=String(request.query?.dryRun||"").toLowerCase()==="true";
  try {
    const result=await getSupabaseServiceAdmin().from("dealerkit_stock_state")
      .select("supplier_stock_id,last_status,source_status,last_seen_at,updated_at,source_updated_at")
      .range(0,1499);
    if(result.error) throw result.error;
    if(!Array.isArray(result.data) || result.data.length>=1500) throw new Error("Incomplete stock snapshot: cleanup stopped.");
    const summary=await cleanConfirmedSoldVanscoImages({stockRows:result.data,dryRun});
    return response.status(200).json({...summary,stockRecords:result.data.length,checkedAt:new Date().toISOString()});
  } catch(error) {
    console.error("[vansco-image-cleanup] stopped safely", {message:String(error?.message||error).slice(0,250)});
    return response.status(503).json({ok:false,error:"Vansco sold-image cleanup could not verify required evidence; nothing else was deleted."});
  }
}
