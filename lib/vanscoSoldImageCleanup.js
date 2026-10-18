import { del, list } from "@vercel/blob";
import { vanscoVehicleMediaToken, VANSCO_OWNED_BLOB_PREFIX, VANSCO_LEASE_PREFIX } from "./vanscoSocialMediaHandoff.js";

export const VANSCO_SOLD_IMAGE_RETENTION_DAYS = 30;
const RETENTION_MS = VANSCO_SOLD_IMAGE_RETENTION_DAYS * 86400000;
const MAX_DELETE_PER_RUN = 20;
const MAX_STOCK_ROWS = 1500;

export function vanscoSoldEquivalentStatus(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[\s-]+/g,"_");
  return status === "awaiting_delivery" || status === "sold";
}

export function vanscoCleanupEligibleStock(row, now = Date.now()) {
  // Both DealerKit status fields must explicitly agree. Never treat a
  // missing, unadvertised, reserved or awaiting-stock vehicle as sold.
  if (!vanscoSoldEquivalentStatus(row?.last_status)
    || !vanscoSoldEquivalentStatus(row?.source_status)) return false;
  const values = [row?.last_seen_at, row?.updated_at, row?.source_updated_at]
    .filter(Boolean).map(value=>new Date(value).getTime());
  if (!values.length || values.some(time=>!Number.isFinite(time)||time>now)) return false;
  return Math.max(...values) <= now - RETENTION_MS;
}

export async function listCompleteVanscoPrefix(prefix, listImpl = list, limit = 5000) {
  const items = [];
  let cursor;
  for (let page=0;page<30;page++) {
    const batch = await listImpl({prefix,limit:1000,...(cursor?{cursor}:{})});
    if (!Array.isArray(batch?.blobs) || typeof batch?.hasMore !== "boolean") {
      throw new Error("Vansco storage inventory could not be verified.");
    }
    for (const item of batch.blobs) {
      if (!String(item?.pathname || "").startsWith(prefix)) {
        throw new Error("Vansco storage returned an unrelated file; no deletion allowed.");
      }
      items.push(item);
    }
    if (items.length > limit) throw new Error("Vansco inventory too large for safe automatic cleanup.");
    if (!batch.hasMore) return items;
    if (!batch.cursor || batch.cursor === cursor) throw new Error("Incomplete Vansco storage pagination.");
    cursor = batch.cursor;
  }
  throw new Error("Incomplete Vansco storage pagination.");
}

export function vanscoLeaseSafeToRemove(leases, now=Date.now()) {
  for (const lease of leases) {
    const match=String(lease.pathname||"").match(/\/(\d{8})\.json$/);
    if(!match) return false;
    const d=match[1];
    const ts=Date.parse(d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,8)+"T23:59:59.999Z");
    if(!Number.isFinite(ts) || new Date(ts).toISOString().slice(0,10).replaceAll("-","")!==d
       || now < ts + RETENTION_MS) return false;
  }
  return true;
}

export async function planVanscoImageCleanup({
  stockRows, listImpl=list, now=Date.now(), maxDelete=MAX_DELETE_PER_RUN,
}={}) {
  if(!Array.isArray(stockRows) || stockRows.length>=MAX_STOCK_ROWS) {
    throw new Error("Complete DealerKit stock status snapshot is required for Vansco cleanup.");
  }
  const byToken=new Map();
  const collisions=new Set();
  for (const row of stockRows) {
    let token;
    try { token=vanscoVehicleMediaToken(row?.supplier_stock_id); }
    catch { continue; }
    if(byToken.has(token)) collisions.add(token);
    else byToken.set(token,row);
  }
  const blobs=await listCompleteVanscoPrefix(VANSCO_OWNED_BLOB_PREFIX+"/",listImpl,4000);
  const byVehicle=new Map();
  for(const item of blobs){
    const match=String(item.pathname||"").match(/^vansco-buffer-images\/v2\/([a-f0-9]{64})\/([a-f0-9]{64})\.(?:jpg|png)$/);
    if(!match) throw new Error("Unexpected Vansco media pathname; refusing cleanup.");
    const token=match[1];
    if(!byVehicle.has(token))byVehicle.set(token,[]);
    byVehicle.get(token).push(item);
  }
  const ready=[],held=[];
  for(const [token,images] of byVehicle){
    const row=byToken.get(token);
    if(!row || collisions.has(token) || !vanscoCleanupEligibleStock(row,now)){
      held.push({token,reason:"status_not_confirmed_sold_or_within_30_days",images:images.length});
      continue;
    }
    const leases=await listCompleteVanscoPrefix(VANSCO_LEASE_PREFIX+"/"+token+"/",listImpl,1500);
    if(!vanscoLeaseSafeToRemove(leases,now)){
      held.push({token,reason:"scheduled_post_still_protected",images:images.length});
      continue;
    }
    for(const image of images){
      const createdAt=new Date(image.uploadedAt||"").getTime();
      if(!Number.isFinite(createdAt) || createdAt>now-RETENTION_MS) {
        held.push({token,reason:"image_younger_than_30_days",images:images.length});
        break;
      }
      const url=String(image.url||"");
      let parsed;
      try {parsed=new URL(url);}catch{}
      if(!parsed || parsed.protocol!=="https:"
        || !parsed.hostname.endsWith(".public.blob.vercel-storage.com")
        || parsed.pathname!=="/"+image.pathname) {
        throw new Error("Vansco deletion URL did not match a verified owned image.");
      }
      ready.push({token,url,pathname:image.pathname});
    }
    // Keep a vehicle's group together; no partial cleanup based on file age.
    if(held.some(item=>item.token===token)){
      for(let i=ready.length-1;i>=0;i--) if(ready[i].token===token)ready.splice(i,1);
    }
    if(ready.length>maxDelete) {
      ready.splice(maxDelete);
      break;
    }
  }
  return {ready,held,totalImages:blobs.length};
}

export async function cleanConfirmedSoldVanscoImages({
  stockRows,listImpl=list,delImpl=del,now=Date.now(),dryRun=true,
}={}) {
  const plan=await planVanscoImageCleanup({stockRows,listImpl,now});
  const deleted=[];
  if(!dryRun) {
    // ONLY immutable v2 Vansco images; never v1 legacy, Buffer assets,
    // Wix media or other brands.
    for(const item of plan.ready){
      await delImpl(item.url);
      deleted.push(item.pathname);
    }
  }
  return {
    ok:true,dryRun,
    retentionDays:VANSCO_SOLD_IMAGE_RETENTION_DAYS,
    scanned:plan.totalImages,
    eligible:plan.ready.length,
    deleted:deleted.length,
    heldCount:plan.held.length,
    reasons:Object.fromEntries([...new Set(plan.held.map(x=>x.reason))].map(reason=>[
      reason,plan.held.filter(x=>x.reason===reason).length
    ])),
  };
}
