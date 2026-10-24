import {getSupabaseServiceAdmin} from "../api/_vansco-cache-utils.js";
const reg=value=>String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
export async function currentActiveRent2BuyManualSpecial(registration,{environment=process.env,supabase=getSupabaseServiceAdmin}={}){
 if(environment.RENT2BUY_MANUAL_SPECIALS_ENABLED!=="true")return null;
 const key=reg(registration);if(!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(key))return null;
 const {data,error}=await supabase().from("rent2buy_special_deals")
 .select("registration,monthly_ex_vat,initial_ex_vat,term_months,source_stock_id,enabled")
 .eq("registration",key).eq("enabled",true).maybeSingle();
 if(error)throw Error("Cannot confirm active special-deal price protection.");
 return data||null;
}
