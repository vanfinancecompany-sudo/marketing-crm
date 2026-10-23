import { loadRent2BuyPricingSource } from "./_rent2buy-quote-source.js";
import { approvedRent2BuySelectorChoices } from "../lib/rent2BuyQuoteChoices.mjs";

const normalRegistrations=["AF22SYZ","CA22MGV","CU22HVD","DK22CXN","DK22CYA","DY22XVX","EA21TTE","EA73FGG","EX22ZFA","GC16WHH","GV72LZN","HJ22LTX","LA23FHK","LD22XTN","MF20ZNR","MM21BDX","MT71KRV","NX18YGL","OU21CNE","VE23CJF","VK72RFY","VO23RGX","WN22AFO","WV72PFU","YF19FSZ","YN17SDV","YR22TMO","YS21XUN"];
const fixedRegistrations=["BT25LVK","FV74BBJ","FV74BEO","BJ74HTL"];
const missingSourceRegistrations=["EK22LOD","NX73VPZ"];

async function check(registration,expect){
  try{
    const source=await loadRent2BuyPricingSource(registration);
    const choices=approvedRent2BuySelectorChoices(source);
    return {
      registration,expect,ok:choices?.ok===true,
      sourceMode:source.sourceMode,
      defaultMiles:choices?.allowedMileageTerms?.[0]?.milesPerMonth??null,
      maxTermAt1000:choices?.allowedMileageTerms?.find(row=>row.milesPerMonth===1000)?.termMonths?.at(-1)??null,
      minimumInitialExVat:choices?.minimumInitialExVat??null,
      error:choices?.ok===true?null:(choices?.error||"choices_unavailable"),
    };
  }catch(error){
    return {registration,expect,ok:false,error:error?.code||"source_unavailable"};
  }
}

export default async function handler(request,response){
  response.setHeader("Cache-Control","no-store, max-age=0");
  if(process.env.VERCEL_ENV!=="preview")
    return response.status(404).json({ok:false,error:"not_found"});
  if(request.method!=="GET")
    return response.status(405).json({ok:false,error:"method_not_allowed"});

  const results=[];
  for(const registration of normalRegistrations) results.push(await check(registration,"matrix"));
  for(const registration of fixedRegistrations) results.push(await check(registration,"fixed"));
  for(const registration of missingSourceRegistrations) results.push(await check(registration,"source_check"));

  const normal=results.filter(x=>x.expect==="matrix");
  const fixed=results.filter(x=>x.expect==="fixed");
  const missing=results.filter(x=>x.expect==="source_check");
  return response.status(200).json({
    ok:normal.every(x=>x.ok&&x.sourceMode==="dealerkit_current_stock")&&
       fixed.every(x=>!x.ok&&x.error==="fixed_legacy_special_not_customisable"),
    summary:{
      normalMatrixOk:normal.filter(x=>x.ok).length,
      normalMatrixTotal:normal.length,
      fixedProtectedOk:fixed.filter(x=>x.error==="fixed_legacy_special_not_customisable").length,
      fixedProtectedTotal:fixed.length,
      missingSourceResults:missing.map(x=>({registration:x.registration,error:x.error||null,ok:x.ok})),
    },
    failures:results.filter(x=>x.expect==="matrix"&&!x.ok),
    results,
    noWrite:true,
  });
}
