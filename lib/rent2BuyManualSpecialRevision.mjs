import {createHash} from "node:crypto";
export function manualSpecialSourceRevision(record){
 return createHash("sha256").update(JSON.stringify({
   kind:"rent2buy_manual_special_v1",
   registration:String(record.registration||"").toUpperCase().replace(/[^A-Z0-9]/g,""),
   stockId:String(record.source_stock_id||""),
   monthly:Number(record.monthly_ex_vat),initial:Number(record.initial_ex_vat),
   term:Number(record.term_months),updatedAt:String(record.updated_at||""),
 })).digest("hex").slice(0,40);
}
