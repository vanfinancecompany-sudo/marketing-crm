import { loadRent2BuyPricingSource } from "./_rent2buy-quote-source.js";
import { approvedRent2BuySelectorChoices } from "../lib/rent2BuyQuoteChoices.mjs";

const checks=[
  {registration:"AF22SYZ",expect:"matrix"},
  {registration:"CA22MGV",expect:"matrix"},
  {registration:"FV74BBJ",expect:"fixed"},
  {registration:"EK22LOD",expect:"source_check"},
];

export default async function handler(request,response){
  response.setHeader("Cache-Control","no-store, max-age=0");
  if(process.env.VERCEL_ENV!=="preview")
    return response.status(404).json({ok:false,error:"not_found"});
  if(request.method!=="GET")
    return response.status(405).json({ok:false,error:"method_not_allowed"});

  const results=[];
  for(const item of checks){
    try{
      const source=await loadRent2BuyPricingSource(item.registration);
      const choices=approvedRent2BuySelectorChoices(source);
      results.push({
        registration:item.registration,
        expect:item.expect,
        ok:choices?.ok===true,
        sourceMode:source.sourceMode,
        defaultMiles:choices?.allowedMileageTerms?.[0]?.milesPerMonth??null,
        maxTermAt1000:choices?.allowedMileageTerms?.find(row=>row.milesPerMonth===1000)?.termMonths?.at(-1)??null,
        minimumInitialExVat:choices?.minimumInitialExVat??null,
        error:choices?.ok===true?null:(choices?.error||"choices_unavailable"),
      });
    }catch(error){
      results.push({
        registration:item.registration,
        expect:item.expect,
        ok:false,
        error:error?.code||"source_unavailable",
      });
    }
  }

  const af=results.find(x=>x.registration==="AF22SYZ");
  const ca=results.find(x=>x.registration==="CA22MGV");
  const fixed=results.find(x=>x.registration==="FV74BBJ");
  return response.status(200).json({
    ok:Boolean(
      af?.ok&&af?.sourceMode==="dealerkit_current_stock"&&
      ca?.ok&&ca?.sourceMode==="dealerkit_current_stock"&&
      fixed?.error==="fixed_legacy_special_not_customisable"
    ),
    results,
    noWrite:true,
  });
}
