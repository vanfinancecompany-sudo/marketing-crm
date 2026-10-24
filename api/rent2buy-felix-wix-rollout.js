import publishedPriceHandler from "./dealerkit-published-price.js";
import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID } from "../lib/dealerKitRent2BuyWixPlan.js";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";

const EXPIRES_AT=Date.UTC(2026,9,24,10,0,0);
const clean=v=>String(v??"").trim();
const reg=v=>clean(v).toUpperCase().replace(/[^A-Z0-9]/g,"");
const EXPECTED_SOURCE_MISSING=new Set(["EK22LOD","NX73VPZ"]);
const MASTER_COLLECTION="ALLRENT2BUYVANS";
const DETAIL_COLLECTION="VANPAGES";

function reply(response,status,body){
  response.setHeader("Cache-Control","no-store, max-age=0");
  return response.status(status).json(body);
}

async function wixRequest(path,{method="GET",body}={}){
  const apiKey=clean(process.env.WIX_API_KEY||process.env.WIX_FINANCE_API_KEY);
  if(!apiKey)throw new Error("wix_key_missing");
  const response=await fetch(`https://www.wixapis.com${path}`,{
    method,
    headers:{
      Authorization:apiKey,
      "wix-site-id":VAN_FINANCE_RENT2BUY_WIX_SITE_ID,
      ...(body?{"Content-Type":"application/json"}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`wix_${response.status}`);
  return payload;
}

async function queryCollection(collectionId,{registration=null,limit=100,offset=0}={}){
  const query={paging:{limit,offset}};
  if(registration)query.filter={title:{$eq:registration}};
  const payload=await wixRequest("/wix-data/v2/items/query",{
    method:"POST",
    body:{dataCollectionId:collectionId,query,consistentRead:true}
  });
  return Array.isArray(payload.dataItems)?payload.dataItems:[];
}

async function patchWixFields(collectionId,itemId,fields){
  const fieldModifications=Object.entries(fields).map(([fieldPath,value])=>({
    fieldPath,action:"SET_FIELD",setFieldOptions:{value}
  }));
  return wixRequest(`/wix-data/v2/items/${encodeURIComponent(itemId)}`,{
    method:"PATCH",
    body:{dataCollectionId:collectionId,patch:{dataItemId:itemId,fieldModifications}}
  });
}

function fixedFields(deal){
  const monthly=Number(deal.monthlyExVat);
  const monthlyInc=Math.round(monthly*1.2);
  const initial=Number(deal.initialExVat);
  const initialInc=Math.round(initial*1.2);
  return {
    master:{
      mth:`£${monthly} PM`,
      weekly:`x${deal.termMonths}`,
      initialRental2250Vat:`INITIAL RENTAL £${initial} +VAT`
    },
    detail:{
      monthlyPayments:`£${monthly} +Vat (£${monthlyInc} INC VAT)`,
      numberOfMonths:`${deal.termMonths}X MONTHLY PAYMENTS`,
      intialRentalCharge:`£${initial} +Vat (£${initialInc} INC VAT)`,
      weeklyPrice:`£${monthly} P/M`
    }
  };
}

async function fixFixedSpecials(state){
  const prepared=[];
  for(const deal of state.fixed){
    const [masterRows,detailRows]=await Promise.all([
      queryCollection(MASTER_COLLECTION,{registration:deal.registration,limit:3}),
      queryCollection(DETAIL_COLLECTION,{registration:deal.registration,limit:3})
    ]);
    if(masterRows.length!==1||detailRows.length!==1)
      throw new Error(`fixed_special_wix_identity_failed_${deal.registration}`);
    prepared.push({
      deal,
      master:masterRows[0],
      detail:detailRows[0],
      fields:fixedFields(deal)
    });
  }

  const updated=[];
  for(const entry of prepared){
    await patchWixFields(MASTER_COLLECTION,entry.master.id,entry.fields.master);
    await patchWixFields(DETAIL_COLLECTION,entry.detail.id,entry.fields.detail);
    updated.push(entry.deal.registration);
  }

  const verified=[];
  for(const deal of state.fixed)verified.push(await verifyFixedSpecial(deal.registration));
  return {updated,verified,ok:verified.every(x=>x.pass)};
}

async function allMasterRows(){
  const rows=[];
  for(let offset=0;;offset+=100){
    const page=await queryCollection(MASTER_COLLECTION,{limit:100,offset});
    rows.push(...page);
    if(page.length<100)break;
  }
  return rows;
}

async function currentStockIndex(){
  const snapshot=await fetchDealerKitStockSnapshot({allowPartial:true});
  const map=new Map();
  for(const vehicle of Array.isArray(snapshot?.vehicles)?snapshot.vehicles:[]){
    const registration=reg(vehicle?.registration);
    if(!registration)continue;
    const list=map.get(registration)||[];
    list.push(vehicle);
    map.set(registration,list);
  }
  return {snapshot,map};
}

function syntheticResponse(){
  let statusCode=200,payload=null;
  const res={
    setHeader(){},
    status(code){statusCode=code;return res;},
    json(body){payload=body;return body;}
  };
  return {res,read:()=>({status:statusCode,body:payload})};
}

async function invokePublishedPrice(body){
  const key=clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  if(!key)throw new Error("marketing_api_key_missing");
  const request={
    method:"POST",
    headers:{"x-marketing-customer-database-key":key},
    body
  };
  const holder=syntheticResponse();
  await publishedPriceHandler(request,holder.res);
  return holder.read();
}

function sameFields(left={},right={}){
  const keys=new Set([...Object.keys(left||{}),...Object.keys(right||{})]);
  return [...keys].every(key=>clean(left?.[key])===clean(right?.[key]));
}

async function scanState(){
  const [rows,{snapshot,map}]=await Promise.all([allMasterRows(),currentStockIndex()]);
  const registrations=[...new Set(rows.map(row=>reg(row?.data?.title)).filter(Boolean))].sort();
  const fixed=[],ready=[],missing=[],duplicates=[],invalid=[];
  for(const registration of registrations){
    if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration)){invalid.push(registration);continue}
    const special=pendingRent2BuySpecialDeal(registration);
    if(special){fixed.push({...special});continue}
    const matches=map.get(registration)||[];
    if(matches.length===0){missing.push(registration);continue}
    if(matches.length>1){duplicates.push(registration);continue}
    const vehicle=matches[0];
    if(!vehicle?.supplierStockId){missing.push(registration);continue}
    ready.push({registration,supplierStockId:String(vehicle.supplierStockId)});
  }
  return {
    registrations,
    fixed,
    ready,
    missing,
    duplicates,
    invalid,
    checkedAt:snapshot?.checkedAt||null
  };
}

async function verifyFixedSpecial(registration){
  const expected=pendingRent2BuySpecialDeal(registration);
  const [masterRows,detailRows]=await Promise.all([
    queryCollection(MASTER_COLLECTION,{registration,limit:3}),
    queryCollection(DETAIL_COLLECTION,{registration,limit:3})
  ]);
  const master=masterRows[0]?.data||{};
  const detail=detailRows[0]?.data||{};
  const monthlyExpected=String(expected.monthlyExVat);
  const initialExpected="2,000";
  const masterPass=clean(master.mth).includes(monthlyExpected)&&
    clean(master.weekly).toLowerCase().includes("48")&&
    clean(master.initialRental2250Vat).replace(/,/g,"").includes("2000");
  const detailPass=clean(detail.monthlyPayments).includes(monthlyExpected)&&
    clean(detail.numberOfMonths).toLowerCase().includes("48")&&
    clean(detail.intialRentalCharge).replace(/,/g,"").includes("2000");
  return {registration,masterPass,detailPass,pass:masterPass&&detailPass,
    currentMaster:{mth:master.mth||null,weekly:master.weekly||null,initial:master.initialRental2250Vat||null},
    currentDetail:{monthlyPayments:detail.monthlyPayments||null,numberOfMonths:detail.numberOfMonths||null,intialRentalCharge:detail.intialRentalCharge||null}};
}

async function previewRegistration(item){
  return invokePublishedPrice({
    action:"preview",
    pipeline:"rent2buy",
    registration:item.registration,
    supplier_stock_id:item.supplierStockId
  });
}

async function verifyRegistration(item){
  const checked=await previewRegistration(item);
  if(checked.status!==200||checked.body?.ok!==true)return {registration:item.registration,ok:false,status:checked.status,message:checked.body?.message||"preview_failed"};
  const preview=checked.body.preview;
  const inSync=preview.matches.every(match=>sameFields(match.current,match.proposed));
  return {registration:item.registration,ok:inSync,inSync,
    monthly:preview.monthly_price,upfront:preview.upfront_price,termMonths:preview.term_months,
    matchCount:preview.match_count};
}

export default async function handler(request,response){
  if(process.env.VERCEL_ENV!=="preview"||
     process.env.RENT2BUY_FELIX_WIX_ROLLOUT_ENABLED!=="true"||
     Date.now()>EXPIRES_AT){
    return reply(response,404,{ok:false,error:"not_found"});
  }
  if(request.method!=="GET")return reply(response,405,{ok:false,error:"method_not_allowed"});
  const mode=clean(request.query?.mode||"scan").toLowerCase();

  try{
    const state=await scanState();
    const unexpectedMissing=state.missing.filter(r=>!EXPECTED_SOURCE_MISSING.has(r));
    const missingExpected=state.missing.filter(r=>EXPECTED_SOURCE_MISSING.has(r));
    const fixedChecks=await Promise.all(state.fixed.map(item=>verifyFixedSpecial(item.registration)));
    const baseSafe=unexpectedMissing.length===0&&state.duplicates.length===0&&state.invalid.length===0&&fixedChecks.every(x=>x.pass);

    if(mode==="fix-specials"){
      if(unexpectedMissing.length||state.duplicates.length||state.invalid.length)
        return reply(response,409,{ok:false,error:"global_identity_preflight_failed",unexpectedMissing,duplicates:state.duplicates,invalid:state.invalid});
      const result=await fixFixedSpecials(state);
      return reply(response,result.ok?200:502,{ok:result.ok,...result,noWrite:false});
    }

    if(mode==="scan"){
      return reply(response,baseSafe?200:409,{
        ok:baseSafe,
        counts:{published:state.registrations.length,ready:state.ready.length,fixed:state.fixed.length,sourceMissing:state.missing.length,duplicates:state.duplicates.length,invalid:state.invalid.length},
        ready:state.ready.map(x=>x.registration),
        fixed:fixedChecks,
        sourceMissing:state.missing,
        expectedSourceMissing:missingExpected,
        unexpectedSourceMissing:unexpectedMissing,
        duplicates:state.duplicates,
        invalid:state.invalid,
        dealerKitCheckedAt:state.checkedAt,
        noWrite:true
      });
    }

    const requested=[...new Set(clean(request.query?.regs).split(",").map(reg).filter(Boolean))];
    if(!requested.length||requested.length>5)return reply(response,400,{ok:false,error:"regs_must_contain_1_to_5_registrations"});
    const readyByReg=new Map(state.ready.map(item=>[item.registration,item]));
    const selected=requested.map(r=>readyByReg.get(r)).filter(Boolean);
    if(selected.length!==requested.length)return reply(response,409,{ok:false,error:"requested_registration_not_current_ready_stock",requested,available:selected.map(x=>x.registration)});
    if(!baseSafe)return reply(response,409,{ok:false,error:"global_preflight_failed",unexpectedMissing,duplicates:state.duplicates,invalid:state.invalid,fixedChecks});

    if(mode==="verify"){
      const verified=[];
      for(const item of selected)verified.push(await verifyRegistration(item));
      return reply(response,verified.every(x=>x.ok)?200:409,{ok:verified.every(x=>x.ok),verified,noWrite:true});
    }

    if(mode!=="apply")return reply(response,400,{ok:false,error:"unsupported_mode"});

    const previews=[];
    for(const item of selected){
      const result=await previewRegistration(item);
      if(result.status!==200||result.body?.ok!==true)
        return reply(response,409,{ok:false,error:"batch_preflight_failed",registration:item.registration,status:result.status,message:result.body?.message||null,noWrite:true});
      previews.push({item,preview:result.body.preview});
    }

    const updated=[];
    for(const entry of previews){
      const result=await invokePublishedPrice({
        action:"update",
        pipeline:"rent2buy",
        registration:entry.item.registration,
        supplier_stock_id:entry.item.supplierStockId,
        confirmation:entry.preview
      });
      if(result.status!==200||result.body?.ok!==true)
        return reply(response,502,{ok:false,error:"batch_update_failed",registration:entry.item.registration,status:result.status,message:result.body?.message||null,updated});
      updated.push({
        registration:entry.item.registration,
        monthly:result.body.updated?.monthly_price??null,
        upfront:result.body.updated?.upfront_price??null,
        termMonths:result.body.updated?.term_months??null,
        updatedCount:result.body.updated?.updated_count??null
      });
    }

    const verified=[];
    for(const item of selected)verified.push(await verifyRegistration(item));
    const ok=verified.every(x=>x.ok);
    return reply(response,ok?200:502,{ok,updated,verified,noWrite:false});
  }catch(error){
    return reply(response,500,{ok:false,error:clean(error?.message||"rollout_failed").slice(0,200)});
  }
}
