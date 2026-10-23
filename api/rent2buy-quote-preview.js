import crypto from "node:crypto";
import { loadRent2BuyPricingSource } from "./_rent2buy-quote-source.js";
import { approvedRent2BuySelectorChoices } from "../lib/rent2BuyQuoteChoices.mjs";
import { issueApprovedRent2BuyQuote } from "../lib/rent2BuyQuoteIssue.mjs";

const registration=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const secureEqual=(provided,expected)=>{
  if(typeof provided!=="string"||typeof expected!=="string"||expected.length<32)return false;
  const x=Buffer.from(provided),y=Buffer.from(expected);
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
function parseRequest(raw){
  let value=raw;
  if(typeof raw==="string"){try{value=JSON.parse(raw)}catch{return null}}
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const reg=registration(value.registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(reg))return null;
  if(value.action!=="choices"&&value.action!=="issue")return null;
  if(value.action==="choices")return {action:"choices",registration:reg};
  if(!value.selection||typeof value.selection!=="object"||Array.isArray(value.selection))
    return null;
  const values={};
  for(const [field,valid] of [
    ["termMonths",[12,18,24,30,36,42,48]],
    ["milesPerMonth",[1000,1500,2000,2500,3000,3500,4000]],
  ]){
    const n=Number(value.selection[field]);
    if(!valid.includes(n))return null;
    values[field]=n;
  }
  const rawInitial=value.selection.initialExVat;
  const initial=Number(rawInitial);
  if(rawInitial===null||rawInitial===undefined||rawInitial===""||
     !Number.isFinite(initial)||initial<1000||initial>100000||
     Math.abs(initial*100-Math.round(initial*100))>0.00001)
    return null;
  values.initialExVat=initial;
  return {action:"issue",registration:reg,selection:values};
}

export function issuedQuotePreviewResponse(issued,registration){
  const id=String(registration??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!issued?.ok||!issued?.quote||typeof issued.token!=="string"||
     !issued.token||issued.quote.registration!==id)
    return null;
  return {ok:true,registration:id,quote:issued.quote,token:issued.token};
}

/**
 * Private, strictly preview-only server-to-server pricing endpoint.
 * No public/browser secret. This is deliberately distinct from the live
 * quote-verification route and NEVER changes a Wix price or stored approval.
 * Completely unusable in Vercel production, even if a flag is set.
 */
export default async function handler(request,response){
  response.setHeader("Cache-Control","no-store, max-age=0");
  if(request.method!=="POST")return response.status(405).json({ok:false,error:"method_not_allowed"});
  if(process.env.VERCEL_ENV!=="preview"||
     process.env.RENT2BUY_QUOTE_PREVIEW_ENDPOINT_ENABLED!=="true")
    return response.status(503).json({ok:false,error:"preview_service_off"});
  if(!secureEqual(request.headers?.["x-rent2buy-quote-verifier-key"],
                  process.env.RENT2BUY_QUOTE_VERIFY_KEY))
    return response.status(401).json({ok:false,error:"unauthorised"});
  const data=parseRequest(request.body);
  if(!data)return response.status(400).json({ok:false,error:"invalid_selection"});
  let source;
  try {source=await loadRent2BuyPricingSource(data.registration);}
  catch{return response.status(409).json({ok:false,error:"approved_quote_unavailable"});}
  if(data.action==="choices"){
    const options=approvedRent2BuySelectorChoices(source);
    return response.status(options.ok?200:409).json(
      options.ok?options:{ok:false,error:"approved_quote_unavailable"}
    );
  }
  const quote=issueApprovedRent2BuyQuote({
    source,selection:data.selection,
    secret:process.env.RENT2BUY_QUOTE_SIGNING_SECRET,
  });
  if(!quote.ok)return response.status(409).json({ok:false,error:"approved_quote_unavailable"});
  // The website BFFs validate this same top-level identity for both actions.
  const result=issuedQuotePreviewResponse(quote,data.registration);
  if(!result)return response.status(409).json({ok:false,error:"quote_identity_mismatch"});
  return response.status(200).json(result);
}
