import test from "node:test";
import assert from "node:assert/strict";
import { compactLiveAssistantSections } from "../lib/assistantCompactPromptExperiment.js";

test("retains mandatory company, compliance and product rule sections and cited brain section", () => {
  const keys = ["products","compliance","company_profile","sales_knowledge","brand_voice","writing_rules","preferred_ctas","faqs","business_vocabulary","customer_personas"];
  const sections = keys.map((section_key,i) => ({ id:"id-"+i,section_key,content:"TEST "+section_key,entries:[],active:true }));
  const selected = compactLiveAssistantSections(sections,[{ type:"business_faq",section_key:"faqs",source_id:"id-7",passage:"TEST" },{type:"article",source_id:"article1"}]);
  assert.deepEqual(selected.map(x=>x.section_key),keys.filter(k=>!["business_vocabulary","customer_personas"].includes(k)));
  assert.equal(compactLiveAssistantSections(sections,[]).length,7);
  const byId = compactLiveAssistantSections(sections,[{type:"business_brain",source_id:"id-8"}]);
  assert.ok(byId.some(x=>x.section_key==="business_vocabulary"));
});
test("never appends an unapproved knowledge section or source", () => {
  const sections=[{id:"a",section_key:"compliance",content:"approved",entries:[],active:true}];
  assert.deepEqual(compactLiveAssistantSections(sections,[{type:"business_brain",source_id:"ghost",section_key:"not-approved"}]),sections);
});
