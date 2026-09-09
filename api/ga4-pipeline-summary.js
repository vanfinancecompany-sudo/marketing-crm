import { loadGa4PipelineSummary } from './_ga4-data-api.js';

function clean(value,limit=500){return String(value||'').trim().slice(0,limit);}

export default async function handler(request,response){
 if(request.method!=='GET')return response.status(405).json({ok:false,message:'Method not allowed.'});
 response.setHeader('Cache-Control','no-store');
 try{
  const summary=await loadGa4PipelineSummary();
  return response.status(200).json(summary);
 }catch(error){
  return response.status(error.status||500).json({ok:false,source:'ga4',message:clean(error?.message||'GA4 pipeline summary failed.')});
 }
}
