/**
 * Fail-closed read-only Rent2Buy pricing source adapter.
 * No pricing writes, Wix changes or database mutations.
 * A complete live DealerKit snapshot is required: NEVER use partial/known-fault
 * snapshots for real-time quotations because duplicate/absent stock is unsafe.
 *
 * This full scan is intentionally expensive and MUST NOT be enabled for customer
 * traffic until rate-limit/caching validation is completed. Feature flags OFF.
 */
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { loadLatestVerifiedRent2BuyQuoteSnapshot } from "./_rent2buy-complete-quote-snapshot.mjs";
import { loadDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { RENT2BUY_SPECIAL_DEALS_TABLE } from "../lib/rent2BuySpecialDealPolicy.mjs";

export const RETAIL_APPROVALS_TABLE = "dealerkit_rent2buy_retail_approvals";
const TERMS = new Set([12,18,24,30,36,42,48]);
const reg = v => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const positive = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v)>0;
const exact = (a,b) => String(a ?? "") === String(b ?? "");
const money = (a,b) => positive(a) && positive(b) && Math.abs(Number(a)-Number(b))<0.001;

export class Rent2BuySourceUnavailable extends Error {
  constructor(code) {
    super("Approved Rent2Buy pricing is not currently available.");
    this.name="Rent2BuySourceUnavailable";
    this.code=code;
  }
}
function reject(code) { throw new Rent2BuySourceUnavailable(code); }

function oneMatchingVehicle(snapshot,registration) {
  if(snapshot?.diagnostics?.complete!==true ||
     snapshot?.refresh?.status!=="complete" ||
     !Array.isArray(snapshot.vehicles)) reject("incomplete_stock_snapshot");
  const matches=snapshot.vehicles.filter(v=>reg(v.registration)===registration);
  if(matches.length!==1 || !matches[0].supplierStockId)reject("missing_or_duplicate_stock");
  return matches[0];
}
async function readByStockId(db,table,stockId){
  const {data,error}=await db.from(table).select("*").eq("supplier_stock_id",stockId).limit(2);
  if(error)reject("unavailable_pricing_table");
  if(!Array.isArray(data) || data.length>1)reject("ambiguous_pricing_record");
  return data[0]||null;
}

export function buildApprovedRent2BuySource({
 registration,
 snapshot,
 detail,
 reviewDecision,
 retailApproval,
 specialDeal=null,
}={}){
  const target=reg(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(target))reject("invalid_registration");
  const listed=oneMatchingVehicle(snapshot,target);
  if(listed.status!=="available"||detail?.status!=="available")
    reject("vehicle_not_available");
  if(reg(detail?.registration)!==target ||
    !exact(listed.supplierStockId,detail?.supplierStockId) ||
    !money(listed.retailPrice,detail?.retailPrice) ||
    !exact(listed.vatStatus,detail?.vatStatus) ||
    !exact(listed.year,detail?.year) ||
    !exact(listed.mileage,detail?.mileage) ||
    !exact(listed.sourceUpdatedAt,detail?.sourceUpdatedAt))
    reject("stock_snapshot_detail_mismatch");
  if(!reviewDecision?.persisted ||
     reviewDecision.reviewStatus!=="reviewed" ||
     reviewDecision.rent2buyEnabled!==true ||
     reg(reviewDecision.registration)!==target ||
     !exact(reviewDecision.supplierStockId,detail.supplierStockId) ||
     !detail.sourceUpdatedAt ||
     !exact(reviewDecision.reviewedSourceUpdatedAt,detail.sourceUpdatedAt))
    reject("review_not_current");

  const approval=retailApproval||{};
  const terms=approval.allowed_terms;
  if(approval.status!=="approved" ||
     reg(approval.registration)!==target ||
     !exact(approval.supplier_stock_id,detail.supplierStockId) ||
     !money(approval.source_retail_amount,detail.retailPrice) ||
     !exact(approval.source_vat_status,detail.vatStatus) ||
     !exact(approval.source_updated_at,detail.sourceUpdatedAt) ||
     !positive(approval.approved_retail_ex_vat) ||
     !Number.isInteger(Number(approval.revision)) || Number(approval.revision)<1 ||
     !approval.approved_at || Number.isNaN(new Date(approval.approved_at).valueOf()) ||
     !String(approval.approved_by||"").trim() ||
     !Array.isArray(terms) || terms.length===0 ||
     terms.some(t=>!TERMS.has(t)) || new Set(terms).size!==terms.length)
    reject("retail_or_contract_terms_not_approved");
  if(detail.vatStatus==="unknown")reject("unknown_retail_vat_status");
  if(specialDeal && (reg(specialDeal.registration)!==target ||
     !exact(specialDeal.supplier_stock_id,detail.supplierStockId)))
    reject("special_deal_identity_mismatch");

  return {
    vehicle:detail,
    decision:reviewDecision,
    retailApproval:approval,
    approvedRetailExVat:Number(approval.approved_retail_ex_vat),
    approvedTermMonths:[...terms].sort((a,b)=>a-b),
    retailVatBasisApproved:true,
    commercialTermsApproved:true,
    stockVerifiedCurrent:true,
    activeSpecial:specialDeal?.status==="active"?specialDeal:null,
    verifiedAt:snapshot.checkedAt||null,
  };
}

export async function loadApprovedRent2BuySource(registration,{
  getSnapshot=loadLatestVerifiedRent2BuyQuoteSnapshot,
  getDetail=id=>fetchDealerKitStockDetail(id,{specifications:false}),
  getDb=getSupabaseServiceAdmin,
  getReview=loadDealerKitReviewDecision,
}={}){
  const target=reg(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(target))reject("invalid_registration");
  const db=getDb();
  const snapshot=await getSnapshot(db);
  const listed=oneMatchingVehicle(snapshot,target);
  if(listed.status!=="available")reject("vehicle_not_available");
  const detail=await getDetail(listed.supplierStockId);
  const [reviewDecision,retailApproval,specialDeal]=await Promise.all([
    getReview(db,listed.supplierStockId),
    readByStockId(db,RETAIL_APPROVALS_TABLE,listed.supplierStockId),
    readByStockId(db,RENT2BUY_SPECIAL_DEALS_TABLE,listed.supplierStockId),
  ]);
  return buildApprovedRent2BuySource({registration:target,snapshot,detail,reviewDecision,retailApproval,specialDeal});
}
