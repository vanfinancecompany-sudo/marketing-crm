/**
 * Pure server-to-server quote verification. Reads only an approved, current
 * source; no publishing, applications, CRM or customer-data writes.
 */
import { verifyRent2BuyQuoteToken } from "../lib/rent2BuyQuoteHandoff.mjs";
import { verifyRent2BuyQuoteAgainstSource } from "../lib/rent2BuyCurrentSourceQuote.mjs";

const reg=v=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const clean=v=>String(v??"").trim();
const fail=reason=>({ok:false,current:false,sourceRevisionVerified:false,reason});

export async function checkIncomingRent2BuyQuote({token,registration}={},{
  env=process.env,
  loadSource,
  now=Date.now(),
}={}){
  if(env.RENT2BUY_QUOTE_VERIFIER_ENABLED!=="true")return fail("verifier_disabled");
  if(typeof token!=="string"||token.length>4096||!token)
    return fail("missing_quote_token");
  const identity=reg(registration);
  if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(identity))return fail("invalid_registration");
  const signed=verifyRent2BuyQuoteToken(token,env.RENT2BUY_QUOTE_SIGNING_SECRET,{
    registration:identity,now,
  });
  if(!signed)return fail("invalid_or_expired_signature");
  if(typeof loadSource!=="function")return fail("no_authoritative_source");
  let source;
  try{source=await loadSource(identity);}
  catch{return fail("source_unavailable");}
  const verdict=verifyRent2BuyQuoteAgainstSource(signed,source,{now});
  if(!verdict.ok)return fail(verdict.reason||"quote_not_current");
  // Contract comes from the signed issued quote, whose values were just
  // independently recalculated against the current authorised source.
  return {
    ok:true,current:true,sourceRevisionVerified:true,approved:true,
    registration:identity,quoteId:signed.quoteId,
    sourceRevision:signed.sourceRevision,
    quote:{
      ...signed,
      monthlyExVat:verdict.quote.monthlyExVat,
      monthlyIncVat:verdict.quote.monthlyIncVat,
      initialExVat:verdict.quote.initialExVat,
      initialIncVat:verdict.quote.initialIncVat,
    },
  };
}
