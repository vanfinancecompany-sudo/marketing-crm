// Photo readiness is independently verified by the DealerKit/Wix endpoint.
// Unrelated Marketing CRM stock-comparison failures must not hide verified alerts.
export function selectVerifiedPhotoReadyRecords({records=[],summary=null,error="",pipeline=""}={}){
 if(String(error||"").trim() || summary?.sourceAvailable !== true)return [];
 const lane=String(pipeline||"").toLowerCase();
 if(!["finance","rent2buy","cars"].includes(lane))return [];
 return (Array.isArray(records)?records:[]).filter((row)=>
  row?.imageReadinessAlert===true && row?.pipeline===lane
 );
}
