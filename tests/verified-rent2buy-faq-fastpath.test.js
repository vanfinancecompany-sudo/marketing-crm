import test from "node:test";
import assert from "node:assert/strict";
import { verifiedRent2BuyFirstTurnFaq } from "../lib/verifiedRent2BuyFirstTurnFaq.js";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";

const session = Object.freeze({
  id: "test-session", page_type: "rent2buy_general", product_lock: "rent2buy",
  message_count: 0, conversation_history: [], journey_state: {}, vehicle_context: {},
  remembered_facts: { product_context: "rent2buy" }, status: "active",
  expires_at: new Date(Date.now() + 600000).toISOString(),
});
const question = (message, overrides = {}) => verifiedRent2BuyFirstTurnFaq({message, session: {...session, ...overrides}});

test("precise FAQ answers include required qualifications, never invent terms", () => {
  for (const text of ["What is Rent2Buy?", "How does Rent to Buy work?", "Tell me about Rent2Buy"]) {
    const r=question(text);
    assert.equal(r.topic,"core");
    for (const term of [/not a finance product/i,/no credit check/i,/affordability/i,/own employment or self-employed income/i,/collected from Southampton/i,/100 miles/i,/final purchase option/i,/not automatic/i]) assert.match(r.reply,term);
    assert.doesNotMatch(r.reply,/guaranteed|free delivery|£[\d,]+|APPLY NOW|credit approval|interest rate|APR/i);
  }
  for (const text of ["Does Rent2Buy do a credit check?", "Is there a credit check for Rent to Buy?", "Do you check my credit for Rent2Buy?"]) {
    const r=question(text);
    assert.equal(r.topic,"credit_check");
    assert.match(r.reply,/does not use a credit check/i);
    assert.match(r.reply,/affordability/i);
    assert.match(r.reply,/not guaranteed/i);
  }
  const r=question("Where are Rent2Buy vans collected?");
  assert.equal(r.topic,"collection");
  assert.match(r.reply,/collection only from Southampton/i);
  assert.match(r.reply,/not delivered/i);
});

test("multi-part, contextual, personalised, price and adjacent questions never take FAQ shortcut", () => {
  for (const text of [
    "What is Rent2Buy and can I qualify with a CCJ?",
    "Does Rent2Buy do a credit check if I have a bankruptcy?",
    "Can I get a van if I've got a guarantor?",
    "How does Rent2Buy work for a new company?",
    "Do I need to collect a Rent2Buy van, and what is the monthly price?",
    "Can I get a van next week?",
    "Are there any mileage charges?",
    "Does Rent2Buy accept 17-year-old drivers?",
    "What is the initial rental on AF22SYZ?",
    "What is Rent2Buy? My postcode is PL1 1AA",
  ]) assert.equal(question(text),null,text);
});

test("locked product, prior context, vehicle context and application mode prevent shortcut", () => {
  const m="What is Rent2Buy?";
  for (const overrides of [
    { product_lock: "finance" }, { product_lock: null }, { page_type:"homepage" },
    { message_count:1 }, { conversation_history:[{role:"user",content:"A CCJ"}] },
    { vehicle_context:{registration:"AF22SYZ"} }, { journey_state:{application_mode_active:true} },
    { journey_state:{application_state:"collecting_proofs"} },
  ]) assert.equal(question(m,overrides),null,JSON.stringify(overrides));
});

test("preview route persists exact FAQ answer without invoking a model",async()=>{
  const stored={...session,conversation_history:[]};
  let modelCalls=0,updates=0,events=0;
  const client={
    async rpc(){return{data:true,error:null}},
    from(table){
      if(table==="ai_assistant_events")return{insert(payload){events+=payload.length;return{select:async()=>({data:[],error:null})}}};
      assert.equal(table,"ai_customer_sessions");
      return{
        select(){const q={eq(){return q},async maybeSingle(){return{data:stored,error:null}}};return q},
        update(payload){updates++;Object.assign(stored,payload);return{eq(){return{select(){return{async single(){return{data:stored,error:null}}}}}}}}
      };
    }
  };
  const env={
    AI_ASSISTANT_SESSION_SECRET:"synthetic-preview-secret",
    AI_ASSISTANT_ALLOWED_ORIGINS:"https://www.rent2buyvans.co.uk",
    VERCEL_ENV:"preview", VERCEL_GIT_COMMIT_REF:"test/askme-verified-faq-fastpath-20261028",
  };
  const res={statusCode:null,payload:null,setHeader(){},status(n){this.statusCode=n;return this},json(d){this.payload=d;return this}};
  await handleCustomerAssistantRequest({
    method:"POST",
    headers:{origin:"https://www.rent2buyvans.co.uk","x-forwarded-for":"192.0.2.99"},
    body:{action:"message",conversation_id:"synthetic-session-id",page_context:{pageType:"rent2buy_general"},message:"Does Rent2Buy do a credit check?"},
  },res,{environment:env,supabase:client,simulateConversation:async()=>{modelCalls++;throw Error("No model call allowed")}});
  assert.equal(res.statusCode,200);
  assert.equal(modelCalls,0);
  assert.equal(stored.message_count,1);
  assert.equal(updates,1);
  assert.equal(events,2);
  assert.deepEqual(stored.conversation_history.map(x=>x.role),["user","assistant"]);
  assert.equal(res.payload.reply,stored.conversation_history[1].content);
  assert.equal(res.payload.cta,null);
});
