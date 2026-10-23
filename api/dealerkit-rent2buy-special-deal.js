import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  RENT2BUY_SPECIAL_DEALS_TABLE,
  allowedSpecialDraftWrite,
  canonicalRent2BuyRegistration,
  normaliseRent2BuySpecialDraft,
  specialDealToClient,
} from "../lib/rent2BuySpecialDealPolicy.mjs";

const clean = (value, len = 300) => String(value ?? "").trim().slice(0, len);
const KEY_HEADER = "x-marketing-customer-database-key";

function authorised(request, env=process.env) {
  const expected=clean(env.MARKETING_CUSTOMER_DATABASE_API_KEY,2000);
  const header=clean(request.headers?.[KEY_HEADER],2000);
  const bearer=clean(request.headers?.authorization,2200).replace(/^Bearer\s+/i,"");
  return Boolean(expected && (header===expected || bearer===expected));
}
function bodyOf(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body);
  return {};
}
async function loadByStockId(db, stockId) {
  const {data,error}=await db.from(RENT2BUY_SPECIAL_DEALS_TABLE).select("*")
    .eq("supplier_stock_id",stockId).limit(2);
  if(error) throw new Error("Special-deal storage unavailable. No changes made.");
  if(data?.length>1) throw new Error("Ambiguous deal records; no changes made.");
  return data?.[0] || null;
}

export default async function handler(request,response) {
  response.setHeader("Cache-Control","no-store, max-age=0");
  if(!authorised(request)) return response.status(401).json({ok:false,message:"Marketing CRM access required."});
  if(!["GET","PUT"].includes(request.method)) return response.status(405).json({ok:false,message:"Method not allowed."});
  let body={};
  try {
    body=request.method==="PUT" ? bodyOf(request) : request.query||{};
    const supplierStockId=clean(body.supplierStockId||body.stockId,300);
    const registration=canonicalRent2BuyRegistration(body.registration);
    if(!supplierStockId || !registration) return response.status(400).json({ok:false,message:"DealerKit stock ID and registration required."});
    if(request.method==="PUT" && !allowedSpecialDraftWrite()) {
      return response.status(423).json({ok:false,message:"Special-deal draft saving is locked pending migration review. No prices were changed."});
    }
    // Before the schema is reviewed/migrated, GET is an informational preview
    // of the known manual-price hold. No query against an uncreated table.
    if(request.method==="GET" && !allowedSpecialDraftWrite()) {
      return response.status(200).json({ok:true,enabled:false,
        deal:specialDealToClient({},registration),
        message:"Special-deal draft storage is not yet enabled. Existing Wix prices are unchanged."});
    }
    const db=getSupabaseServiceAdmin();
    const existing=await loadByStockId(db,supplierStockId);
    if(existing && canonicalRent2BuyRegistration(existing.registration)!==registration)
      return response.status(409).json({ok:false,message:"The saved deal belongs to a different registration. No changes made."});
    if(request.method==="GET") return response.status(200).json({ok:true,
      enabled:allowedSpecialDraftWrite(), deal:specialDealToClient(existing||{},registration)});

    if(body.action!=="save_draft") return response.status(400).json({ok:false,message:"Only saving a draft special deal is supported."});
    const source=await fetchDealerKitStockDetail(supplierStockId,{specifications:false});
    const parsed=normaliseRent2BuySpecialDraft(body,source);
    if(normalizeRegistration(source.registration)!==registration)
      return response.status(409).json({ok:false,message:"Vehicle registration changed in DealerKit. No changes made."});
    // Existing active/retired specials must never be silently replaced by a draft.
    if(existing?.status && existing.status!=="draft")
      return response.status(409).json({ok:false,message:"Approved or inactive special deals cannot be changed through draft saving."});
    const expectedRevision=Number(body.expectedRevision);
    if(!Number.isInteger(expectedRevision)||expectedRevision<0)
      return response.status(400).json({ok:false,message:"Expected pricing revision required."});
    if(Number(existing?.revision||0)!==expectedRevision)
      return response.status(409).json({ok:false,message:"Special deal changed since it was opened. Reload and review."});
    let saved,error;
    if(existing) {
      const result=await db.from(RENT2BUY_SPECIAL_DEALS_TABLE)
        .update({...parsed,revision:expectedRevision+1,updated_at:new Date().toISOString()})
        .eq("supplier_stock_id",supplierStockId).eq("revision",expectedRevision)
        .eq("status","draft").select("*").maybeSingle();
      saved=result.data;error=result.error;
    } else {
      const result=await db.from(RENT2BUY_SPECIAL_DEALS_TABLE)
        .insert({...parsed,revision:1}).select("*").single();
      saved=result.data;error=result.error;
    }
    if(error || !saved) return response.status(error?502:409).json({ok:false,message:error?"Draft could not be saved. No Wix price was changed.":"Draft changed concurrently. Reload before saving."});
    return response.status(200).json({ok:true,draftSaved:true,deal:specialDealToClient(saved,registration),
      message:"Special deal DRAFT saved for review. Existing Wix prices and adverts are unchanged."});
  } catch (err) {
    return response.status(400).json({ok:false,message:clean(err?.message||"Special-deal draft operation failed.",500)});
  }
}
