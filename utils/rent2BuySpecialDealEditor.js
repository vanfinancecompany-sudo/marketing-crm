import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";

/** Collapsed admin draft controls. Never writes Wix; server defaults to locked. */
export function renderRent2BuySpecialDealEditor(vehicle={}) {
  const reg=String(vehicle.registration||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  const legacy=pendingRent2BuySpecialDeal(reg);
  const stockId=String(vehicle.supplierStockId||"");
  const section=document.createElement("details");
  section.className="dealerkit-review__section r2b-special-editor";
  section.dataset.rent2buySpecialEditor="true";
  const summary=document.createElement("summary");
  summary.textContent=legacy ? "Special deal · manual Wix price protected" : "Rent2Buy pricing · special deal";
  section.appendChild(summary);

  const intro=document.createElement("p");
  intro.className="dealerkit-review__section-note";
  intro.textContent=legacy
    ? "Existing Wix listing £"+legacy.publishedMonthlyExVat+" + VAT is identified for migration protection. The vehicle-detail price can differ; confirm all agreed terms before changing anything."
    : "Standard matrix applies by default. Only use a special deal for an approved, registration-specific promotion.";
  section.appendChild(intro);
  const status=document.createElement("p");
  status.className="dealerkit-review__section-note";
  status.setAttribute("role","status");
  status.textContent="Loading draft settings…";
  section.appendChild(status);
  const form=document.createElement("form");
  form.className="r2b-special-editor__form";
  form.noValidate=true;
  const fields=[
    ["monthlyExVat","Monthly rental + VAT","number","0.01","1"],
    ["initialExVat","Initial rental + VAT","number","0.01","1000"],
    ["termMonths","Contract term (months)","select","", ""],
    ["milesPerMonth","Contract allowance (miles/month)","select","", ""],
    ["expiresAt","Deal expires (optional)","date","", ""],
    ["reason","Reason for special deal","text","", ""],
    ["confirmRegistration","Confirm vehicle registration","text","", ""],
  ];
  const inputs={};
  for(const [name,title,type,step,min] of fields){
    const label=document.createElement("label");
    label.className="r2b-special-editor__field";
    const caption=document.createElement("span");
    caption.textContent=title;
    let input;
    if(type==="select") {
      input=document.createElement("select");
      const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Choose";input.appendChild(placeholder);
      const choices=name==="termMonths"?[12,18,24,30,36,42,48]:[1000,1500,2000,2500,3000,3500,4000];
      for(const n of choices){const opt=document.createElement("option");opt.value=String(n);opt.textContent=name==="termMonths"?n+" months":n.toLocaleString("en-GB")+" miles";input.appendChild(opt);}
    } else {
      input=document.createElement("input");input.type=type;
      if(step)input.step=step;if(min)input.min=min;
      if(name==="reason")input.maxLength=1000;
    }
    input.name=name;input.autocomplete="off";
    inputs[name]=input;
    label.append(caption,input);form.appendChild(label);
  }
  inputs.reason.placeholder="Why is this special deal approved?";
  inputs.confirmRegistration.placeholder=reg;
  const action=document.createElement("button");
  action.type="submit";action.className="dealerkit-review__save";
  action.textContent="Save special-deal draft";action.disabled=true;
  form.appendChild(action);section.appendChild(form);
  let revision=0;
  let enabled=false;
  if(stockId && reg){
    const qs=new URLSearchParams({stockId,registration:reg});
    fetch("/api/dealerkit-rent2buy-special-deal?"+qs,{
      headers:buildMarketingAccessHeaders({accept:"application/json"}),cache:"no-store",
    }).then(r=>parseMarketingJsonResponse(r,"Cannot read special-deal settings."))
      .then(result=>{
        enabled=result.enabled===true;
        const stored=result.deal;
        revision=stored?.revision||0;
        if(stored?.persisted){
          for(const field of ["monthlyExVat","initialExVat","termMonths","milesPerMonth","reason"]){
            if(stored[field]!==undefined && stored[field]!==null)inputs[field].value=String(stored[field]);
          }
          if(stored.expiresAt)inputs.expiresAt.value=String(stored.expiresAt).slice(0,10);
        }else if(legacy)inputs.monthlyExVat.value=String(legacy.publishedMonthlyExVat);
        action.disabled=!enabled;
        status.textContent=enabled
          ? "Draft editor enabled. "+(stored?.persisted?"Stored draft revision "+revision+".":"No saved draft.")+" Saving never updates Wix."
          : "Read-only preview. Draft storage is locked until migration and current deals are verified; Wix pricing is unchanged.";
      }).catch(error=>{action.disabled=true;status.textContent=error.message||"Special deal state unavailable. Nothing changed.";});
  }else status.textContent="Missing registration or DealerKit stock ID; special price editing unavailable.";

  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!enabled || action.disabled || !stockId)return;
    action.disabled=true;status.textContent="Saving draft only. Wix pricing is unchanged…";
    const payload={action:"save_draft",supplierStockId:stockId,registration:reg,expectedRevision:revision};
    for(const key of Object.keys(inputs))payload[key]=inputs[key].value.trim();
    payload.confirmRegistration=payload.confirmRegistration.replace(/\s+/g,"").toUpperCase();
    try{
      const r=await fetch("/api/dealerkit-rent2buy-special-deal",{
        method:"PUT",cache:"no-store",
        headers:buildMarketingAccessHeaders({"Content-Type":"application/json",accept:"application/json"}),
        body:JSON.stringify(payload),
      });
      const result=await parseMarketingJsonResponse(r,"Special-deal draft could not be saved.");
      revision=result.deal?.revision||revision;
      status.textContent=result.message||"Draft saved. Wix prices unchanged.";
    }catch(err){status.textContent=err.message||"Draft not saved. Wix prices unchanged.";}
    finally{action.disabled=!enabled;}
  });
  return section;
}
