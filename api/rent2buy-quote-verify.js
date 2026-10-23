import crypto from "node:crypto";
import { checkIncomingRent2BuyQuote } from "./_rent2buy-quote-verify-handler.mjs";
import { loadRent2BuyPricingSource } from "./_rent2buy-quote-source.js";

const clean=(v,limit=4096)=>String(v??"").trim().slice(0,limit);
function secureEqual(a,b){
  const left=Buffer.from(clean(a)),right=Buffer.from(clean(b));
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function bodyOf(request){
  if(request.body && typeof request.body==="object" && !Array.isArray(request.body))return request.body;
  if(typeof request.body==="string"){try{return JSON.parse(request.body)}catch{return null}}
  return null;
}

/**
 * Private server-to-server quote verification for both websites and Main CRM.
 * Disabled by default. No side effects or public API key exposures.
 * Do not enable full DealerKit reads without rate-limit/latency approval.
 */
export default async function handler(request,response){
  response.setHeader("Cache-Control","no-store, max-age=0");
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"method_not_allowed"});
  const env=process.env;
  if(env.RENT2BUY_QUOTE_VERIFIER_ENABLED!=="true")
    return response.status(503).json({ok:false,error:"quote_verification_unavailable"});
  const key=clean(env.RENT2BUY_QUOTE_VERIFY_KEY);
  if(!key||key.length<32||
    !secureEqual(request.headers?.["x-rent2buy-quote-verifier-key"],key))
    return response.status(401).json({ok:false,error:"unauthorised"});
  const body=bodyOf(request);
  if(!body||typeof body.token!=="string"||typeof body.registration!=="string")
    return response.status(400).json({ok:false,error:"missing_quote_information"});
  // Both the HMAC and current DealerkIt source revision must pass.
  const result=await checkIncomingRent2BuyQuote({
    token:body.token,registration:body.registration,
  },{env,loadSource:loadRent2BuyPricingSource});
  if(!result.ok)return response.status(409).json({ok:false,current:false,sourceRevisionVerified:false,error:"quote_not_current"});
  return response.status(200).json(result);
}
