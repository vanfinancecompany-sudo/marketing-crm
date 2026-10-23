/**
 * Shared complete Stock Watch manifest for PRIVATE Rent2Buy quote verification.
 *
 * Do not use dealerkit_stock_state: it intentionally preserves last-known rows
 * even when a vehicle disappears or is de-advertised.
 *
 * Only a complete, stable DealerKit snapshot may be captured. Database reads
 * never cause a bulk DealerKit fetch or serve stale/partial fallback data.
 */
import { createHash } from "node:crypto";

export const RENT2BUY_QUOTE_SNAPSHOT_TABLE = "dealerkit_rent2buy_quote_snapshots";
export const RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS = 90_000;
const STOCK_MAX = 2000;
const reg=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const text=value=>String(value??"").trim();
const positiveDate=value=>{
  const time=Date.parse(String(value??""));
  return Number.isFinite(time)?time:null;
};
const numberOrNull=value=>{
  if(value===null||value===undefined||value==="")return null;
  const valueAsNumber=Number(value);
  return Number.isFinite(valueAsNumber)?valueAsNumber:null;
};
const digest=manifest=>createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

export class Rent2BuySnapshotUnavailable extends Error{
  constructor(code){
    super("Current verified DealerKit stock is unavailable.");
    this.name="Rent2BuySnapshotUnavailable";
    this.code=code;
  }
}
const deny=code=>{throw new Rent2BuySnapshotUnavailable(code)};

export function verifiedRent2BuyManifest(snapshot,{now=Date.now()}={}){
  if(snapshot?.complete!==true||
     snapshot?.diagnostics?.complete!==true||
     snapshot?.diagnostics?.stableReportedTotal!==true||
     snapshot?.refresh?.status!=="complete"||
     !Array.isArray(snapshot?.vehicles)||
     snapshot.vehicles.length===0||
     snapshot.vehicles.length>STOCK_MAX||
     snapshot?.diagnostics?.failedPositions?.length||
     snapshot?.diagnostics?.invalidRecords?.length||
     snapshot?.diagnostics?.duplicateRegistrations?.length||
     snapshot?.diagnostics?.duplicateSupplierStockIds?.length)
    deny("incomplete_or_ambiguous_snapshot");

  const reported=Number(snapshot.diagnostics.apiReportedTotal);
  if(!Number.isInteger(reported)||reported!==snapshot.vehicles.length)
    deny("inconsistent_source_total");
  const checked=positiveDate(snapshot.checkedAt);
  if(checked===null||checked>now+5000||now-checked>120_000)
    deny("invalid_source_timestamp");

  const registrations=new Set(),ids=new Set(),manifest=[];
  for(const vehicle of snapshot.vehicles){
    const registration=reg(vehicle?.registration);
    const supplierStockId=text(vehicle?.supplierStockId);
    if(!registration||!supplierStockId||
       registrations.has(registration)||ids.has(supplierStockId))
       deny("ambiguous_stock_identity");
    registrations.add(registration);ids.add(supplierStockId);
    manifest.push({
      registration,supplierStockId,
      status:text(vehicle?.status)||"unknown",
      sourceStatus:text(vehicle?.sourceStatus)||"unknown",
      year:numberOrNull(vehicle?.year),
      mileage:numberOrNull(vehicle?.mileage),
      retailPrice:numberOrNull(vehicle?.retailPrice),
      vatStatus:text(vehicle?.vatStatus)||"unknown",
      sourceUpdatedAt:text(vehicle?.sourceUpdatedAt)||null,
    });
  }
  // Stable ordering produces the same digest regardless of feed row ordering.
  manifest.sort((a,b)=>a.registration.localeCompare(b.registration));
  const checkedAt=new Date(checked).toISOString();
  return {snapshot_checked_at:checkedAt,stock_count:manifest.length,
    vehicle_manifest:manifest,snapshot_digest:digest(manifest)};
}

export async function captureCompleteRent2BuyQuoteSnapshot(db,snapshot, {
  now=Date.now(),
}={}){
  const proposed=verifiedRent2BuyManifest(snapshot,{now});
  const {error}=await db.from(RENT2BUY_QUOTE_SNAPSHOT_TABLE).insert(proposed);
  // The same immutable generation may be safely submitted twice.
  if(error && String(error.code)!=="23505")
    deny("snapshot_storage_unavailable");
  return {captured:!error,duplicate:Boolean(error),stockCount:proposed.stock_count,
    checkedAt:proposed.snapshot_checked_at};
}

export function decodeVerifiedRent2BuyQuoteSnapshot(row,{
  now=Date.now(),maxAgeMs=RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS,
}={}){
  if(!row||!Array.isArray(row.vehicle_manifest)||!Number.isInteger(Number(row.stock_count)))
    deny("missing_snapshot");
  const checked=positiveDate(row.snapshot_checked_at);
  const captured=positiveDate(row.captured_at);
  // A row inserted after the fact does not make an old DealerKit generation fresh.
  if(checked===null||captured===null||checked>now+5000||captured>now+5000||
     captured<checked-5000||now-checked>Math.min(90_000,Math.max(1,maxAgeMs)))
    deny("stale_snapshot");
  const manifest=row.vehicle_manifest;
  if(manifest.length===0||manifest.length>STOCK_MAX||
    manifest.length!==Number(row.stock_count)||digest(manifest)!==row.snapshot_digest)
    deny("corrupt_snapshot");
  const ids=new Set(),regs=new Set();
  for(const v of manifest){
    if(!v||!text(v.supplierStockId)||!reg(v.registration)||
       ids.has(text(v.supplierStockId))||regs.has(reg(v.registration)))
      deny("ambiguous_stock_identity");
    ids.add(text(v.supplierStockId));regs.add(reg(v.registration));
  }
  return {
    complete:true,checkedAt:new Date(checked).toISOString(),
    vehicleCount:manifest.length,
    refresh:{status:"complete"},
    diagnostics:{complete:true,stableReportedTotal:true,apiReportedTotal:manifest.length,
      failedPositions:[],invalidRecords:[],duplicateRegistrations:[],duplicateSupplierStockIds:[]},
    vehicles:manifest,
  };
}

export async function loadLatestVerifiedRent2BuyQuoteSnapshot(db,{
  now=Date.now(),maxAgeMs=RENT2BUY_QUOTE_SNAPSHOT_MAX_AGE_MS,
}={}){
  const {data,error}=await db.from(RENT2BUY_QUOTE_SNAPSHOT_TABLE)
    .select("snapshot_checked_at,captured_at,stock_count,snapshot_digest,vehicle_manifest")
    .order("snapshot_checked_at",{ascending:false}).limit(1).maybeSingle();
  if(error)deny("snapshot_storage_unavailable");
  return decodeVerifiedRent2BuyQuoteSnapshot(data,{now,maxAgeMs});
}
