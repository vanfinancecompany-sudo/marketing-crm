import {vatLabelFromText} from "../../lib/vanscoFacebookAutomation.js";

/** Exact public retail-price label, never a caption, monthly figure or menu VAT mention. */
export function publishedRetailVat(html,expectedPrice) {
 if(typeof expectedPrice!=="number"||!Number.isFinite(expectedPrice)||expectedPrice<=0)return "";
 const text=String(html).replace(/<script\b[\s\S]*?<\/script>/gi," ")
  .replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")
  .replace(/&nbsp;|&#160;/gi," ").replace(/&pound;/gi,"£").replace(/\s+/g," ");
 const matches=[...text.matchAll(/\bRetail price\s*£\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(\+\s*VAT|NO\s+VAT|INC(?:LUDING)?\s+VAT)\b/gi)];
 if(matches.length!==1||Number(matches[0][1].replace(/,/g,""))!==expectedPrice)return "";
 return vatLabelFromText(matches[0][2]);
}
