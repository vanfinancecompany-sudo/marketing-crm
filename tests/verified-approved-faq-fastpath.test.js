import test from "node:test";
import assert from "node:assert/strict";
import { matchApprovedFirstTurnFaq, approvedFaqReply, loadApprovedFaqReply } from "../lib/verifiedApprovedFirstTurnFaq.js";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";

const baseSession = () => ({
  id:"faq-session", page_type:"finance_general",product_lock:"finance",
  message_count:0,conversation_history:[],vehicle_context:{},journey_state:{},
  remembered_facts:{product_context:"finance"},status:"active",
  expires_at:new Date(Date.now()+3600000).toISOString(),
});
const samples=[
  {product:"finance",msg:"Does Van Finance guarantee approval?",label:"Does Van Finance guarantee approval?",value:"No. Applications are subject to lender criteria, credit checks, affordability and approval."},
  {product:"finance",msg:"Is the van finance deposit always £99?",label:"Is the Van Finance deposit always £99?",value:"No. A £99 deposit may be available on qualifying applications and vehicles, but the required deposit varies."},
  {product:"finance",msg:"Can VAT be included in van finance?",label:"Can VAT be included in van finance?",value:"It may be possible where the lender and agreement permit it."},
  {product:"rent2buy",msg:"Is Rent2Buy guaranteed?",label:"Is Rent2Buy guaranteed?",value:"No. Applications are reviewed individually and acceptance is not guaranteed."},
  {product:"rent2buy",msg:"What documents do I need for Rent2Buy?",label:"What documents are needed for Rent2Buy?",value:"Applicants normally need three recent full bank statements, two proofs of address and a full UK or EU driving licence."},
  {product:"rent2buy",msg:"Is Rent2Buy available everywhere in the UK?",label:"Is Rent2Buy available everywhere in the UK?",value:"Applicants must normally live within 100 miles of Southampton."},
  {product:"rent2buy",msg:"Does Rent2Buy include insurance?",label:"Does Rent2Buy include insurance?",value:"No. The customer must arrange fully comprehensive insurance before collection."},
  {product:"finance",msg:"Are warranty terms the same on every van?",label:"Are warranty terms the same on every van?",value:"No. Warranty duration, coverage and exclusions must be checked for the individual vehicle."},
];
test("approved answer comes from active Business Brain rather than hardcoded advice",()=>{
 for(const s of samples){
   const state={...baseSession(),product_lock:s.product,page_type:s.product==="finance"?"finance_general":"rent2buy_general"};
   const rule=matchApprovedFirstTurnFaq({message:s.msg,session:state});
   assert.ok(rule,s.msg);assert.equal(rule.label,s.label);
   const expected=s.label==="Is Rent2Buy available everywhere in the UK?"
     ? "No. "+s.value
     : s.label==="Does Rent2Buy include insurance?"
       ? "No. You need to arrange fully comprehensive insurance before collection."
       : s.value;
   assert.equal(approvedFaqReply(rule,[{label:s.label,value:s.value}]),expected);
 }
});
test("missing, incomplete, duplicate or changed Business Brain policies fail closed",()=>{
 for(const s of samples){
   const state={...baseSession(),product_lock:s.product,page_type:s.product==="finance"?"finance_general":"rent2buy_general"};
   const rule=matchApprovedFirstTurnFaq({message:s.msg,session:state});
   assert.equal(approvedFaqReply(rule,[]),null);
   assert.equal(approvedFaqReply(rule,[{label:s.label,value:"Possibly."}]),null);
   assert.equal(approvedFaqReply(rule,[{label:s.label,value:s.value},{label:s.label,value:s.value}]),null);
   assert.equal(approvedFaqReply(rule,[{label:"Website import · faqs",value:s.value}]),null);
 }
});
test("mixed questions, customer-specific circumstances and active journeys never use fixed FAQs",()=>{
 for(const text of [
   "Does Van Finance guarantee approval if I have a CCJ?",
   "Can I finance the VAT and the deposit?",
   "Is the van finance deposit always £99 with bad credit?",
   "What documents do I need for Rent2Buy if my business is new?",
   "Does Rent2Buy include insurance and can I get it delivered?",
   "Is Rent2Buy guaranteed if I have a guarantor?",
   "Are warranty terms the same on every van and how long is this van's warranty?",
 ]) {
   const product=/van finance|VAT|warranty terms/.test(text)?"finance":"rent2buy";
   const s={...baseSession(),product_lock:product,page_type:product==="finance"?"finance_general":"rent2buy_general"};
   assert.equal(matchApprovedFirstTurnFaq({message:text,session:s}),null,text);
 }
 const s=baseSession();
 for(const overrides of [{message_count:1},{conversation_history:[{role:"user",content:"I have a CCJ"}]},{page_type:"homepage"},{vehicle_context:{registration:"AB12 CDE"}},{journey_state:{application_mode_active:true}}]){
   assert.equal(matchApprovedFirstTurnFaq({message:samples[0].msg,session:{...s,...overrides}}),null);
 }
});
test("if approved FAQ lookup fails, return null rather than unverified text",async()=>{
 const rule=matchApprovedFirstTurnFaq({message:samples[0].msg,session:baseSession()});
 assert.equal(await loadApprovedFaqReply({from(){return{select(){const q={eq(){return q},async maybeSingle(){return{data:null,error:{message:"not configured"}}}};return q}}}},rule),null);
});
test("preview response persists source-verified FAQ and never invokes model",async()=>{
 const s=baseSession();let modelCalls=0,updates=0,eventCount=0,reads=0;
 const supabase={
   async rpc(){return {data:true,error:null}},
   from(table){
     if(table==="knowledge_business_sections")return{
       select(col){assert.equal(col,"entries");const q={eq(){return q},async maybeSingle(){reads++;return{data:{entries:[{label:samples[0].label,value:samples[0].value}]},error:null}}};return q}
     };
     if(table==="ai_assistant_events")return{insert(rows){eventCount+=rows.length;return{select:async()=>({data:[],error:null})}}};
     assert.equal(table,"ai_customer_sessions");
     return{
       select(){const q={eq(){return q},async maybeSingle(){return{data:s,error:null}}};return q},
       update(data){updates++;Object.assign(s,data);return{eq(){return{select(){return{async single(){return{data:s,error:null}}}}}}}}
     };
   }
 };
 const response={statusCode:0,payload:null,setHeader(){},status(n){this.statusCode=n;return this},json(p){this.payload=p;return this}};
 await handleCustomerAssistantRequest({
   method:"POST",headers:{origin:"https://www.vanfinancecompany.co.uk","x-forwarded-for":"192.0.2.44"},
   body:{action:"message",conversation_id:"synthetic-faq-session",page_context:{pageType:"finance_general"},message:samples[0].msg},
 },response,{environment:{
   AI_ASSISTANT_ALLOWED_ORIGINS:"https://www.vanfinancecompany.co.uk",
   AI_ASSISTANT_SESSION_SECRET:"synthetic",
   VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"test/askme-verified-faq-fastpath-20261028",
 },supabase,simulateConversation:async()=>{modelCalls++;throw Error("model should not run")}});
 assert.equal(response.statusCode,200);assert.equal(response.payload.reply,samples[0].value);
 assert.equal(reads,1);assert.equal(modelCalls,0);assert.equal(updates,1);assert.equal(s.message_count,1);
 assert.deepEqual(s.conversation_history.map(x=>x.role),["user","assistant"]);assert.equal(eventCount,2);
});
