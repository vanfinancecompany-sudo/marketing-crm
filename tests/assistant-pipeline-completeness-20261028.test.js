import test from "node:test";
import assert from "node:assert/strict";
import { classifyConversationIntent, buildConversationMemory } from "../lib/conversationIntelligence.js";
import { isCoverageQuestion } from "../lib/productCoverageRules.js";
import { classifyUniversalMessage } from "../lib/humanConversationRecovery.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";
import { verifiedRent2BuyMileageUiGuidance } from "../lib/assistantVerifiedWebsiteGuidance.js";
import { conversationPrompt } from "../api/marketing-ai-assistant-competence.js";
import {
  controlledBusinessRuntimeReply,
  deterministicFinanceDepositReply,
  deterministicRent2BuyEndOfAgreementReply,
  deterministicDeliveryReply,
} from "../lib/salesConversationEngine.js";

const mileageQuestions = [
  "If I need 3,000 miles a month instead of 1,000, how do I change that, and what happens if I exceed my allowance?",
  "How do I change my monthly mileage allowance and what does excess mileage cost?",
  "Can I choose 3,000 miles per month on Rent2Buy instead of 1,000?",
  "Would I pay extra if I exceed the contracted miles a month?",
];
test("Rent2Buy mileage-contract enquiries cannot become postcode/location coverage", () => {
  for (const message of mileageQuestions) {
    const intent=classifyConversationIntent({message,productContext:"rent2buy"});
    assert.equal(intent.retrieval_required,true,message);
    assert.equal(intent.clarification_required,false,message);
    assert.equal(intent.secondary_intents.includes("coverage"),false,message);
    assert.equal(isCoverageQuestion(message),false,message);
    const remembered=buildConversationMemory([{role:"user",content:message}]);
    assert.notEqual(remembered.remembered_facts.main_concern,"location coverage",message);
  }
});
test("Universal classifier and V6 orchestrator retrieve mileage knowledge, not conversation recovery",()=>{
  for(const message of mileageQuestions){
    const intent=classifyConversationIntent({message,productContext:"rent2buy"});
    const human=classifyUniversalMessage({message,messages:[]});
    assert.equal(human.message_type,"question",message);
    assert.equal(human.recovery_required,false,message);
    const orchestration=orchestrateConversationTurn({message,intent,human,journey:{},priorJourney:{},buyingSignals:{}});
    assert.equal(orchestration.retrieval_required,true,message);
    assert.equal(orchestration.recovery_required,false,message);
    assert.ok(orchestration.detected_intents.includes("mileage"),message);
  }
});
test("Actual geographic eligibility still resolves postcodes and residential distance",()=>{
  for(const message of [
    "I live in Manchester. Does Rent2Buy cover my area?",
    "I'm 120 miles from Southampton. Can I apply?",
    "I live within 80 miles of Southampton, am I eligible?",
    "My home postcode is SO40 2NN. Am I in the Rent2Buy area?",
    "Do you deliver to Birmingham?",
  ]){
    const intent=classifyConversationIntent({message,productContext:"rent2buy"});
    assert.ok(intent.secondary_intents.includes("coverage") || /deliver/.test(message),message);
    assert.equal(isCoverageQuestion(message),true,message);
  }
});
test("The verified Finance deposit reply is available only if no independent question is omitted",()=>{
  for(const message of ["Is your deposit always £99?", "What is the deposit?", "Do deposits start from £99?"]){
    assert.match(deterministicFinanceDepositReply(message),/£99/,message);
  }
  for(const message of [
    "I've just opened a limited company, so could I apply for van finance? Can VAT be funded and can you guarantee a £99 deposit?",
    "If I put down £99, does that guarantee finance approval, and can VAT be included in my finance agreement?",
    "Can I apply with a CCJ and what deposit would I need?",
    "Is a £99 deposit enough if I'm self employed and need VAT financed?",
    "Can my new business get van finance and do you offer a £99 deposit?",
  ]){
    assert.equal(deterministicFinanceDepositReply(message),null,message);
    assert.equal(controlledBusinessRuntimeReply({message,productContext:"finance"}),null,message);
  }
});
test("Rent2Buy delivery answer explicitly addresses whether travelling to collect overrides the area rule",()=>{
  const message="Can you deliver a Rent2Buy van to me in Birmingham? If I collect it myself does that get around the distance rule?";
  const reply=controlledBusinessRuntimeReply({message,productContext:"rent2buy"});
  assert.match(reply,/collected from Southampton/);
  assert.match(reply,/100 miles/);
  assert.match(reply,/Travelling to collect the van does not override/);
  const simple=deterministicDeliveryReply("rent2buy","Can you deliver a van?",null);
  assert.match(simple,/collected from Southampton/);
  assert.doesNotMatch(simple,/Travelling to collect/);
});

test("Relevant rental mileage enquiries receive actual live website calculator guidance, never Finance or location replies",()=>{
  const question="If I need 3,000 miles a month instead of 1,000, how do I change that, and what happens if I exceed my allowance?";
  const guidance=verifiedRent2BuyMileageUiGuidance({message:question,productContext:"rent2buy"});
  assert.match(guidance,/Miles per month/);
  assert.match(guidance,/1,000 miles\/month/);
  assert.match(guidance,/3,000 miles\/month/);
  assert.match(guidance,/server-verified/);
  assert.match(guidance,/How excess mileage works/);
  assert.match(guidance,/signed agreement/);
  assert.doesNotMatch(guidance,/20p per mile|£\d+ per mile|guaranteed/i);
  assert.equal(verifiedRent2BuyMileageUiGuidance({message:question,productContext:"finance"}),"");
  assert.equal(verifiedRent2BuyMileageUiGuidance({message:"I live 120 miles from Southampton. Can I apply?",productContext:"rent2buy"}),"");
  const intent=classifyConversationIntent({message:question,productContext:"rent2buy"});
  const prompt=conversationPrompt({
    question,messages:[],sources:[],sections:[],settings:{},productContext:"rent2buy",comparison:false,intent,
    memory:{remembered_facts:{},corrections:[]},
  });
  assert.match(prompt,/Verified Rent2Buy website calculator guidance/);
  assert.match(prompt,/If a question asks both how to change monthly mileage and what happens when exceeding it, answer BOTH parts/);
  const financePrompt=conversationPrompt({
    question,messages:[],sources:[],sections:[],settings:{},productContext:"finance",comparison:false,intent,
    memory:{remembered_facts:{},corrections:[]},
  });
  assert.doesNotMatch(financePrompt,/Verified Rent2Buy website calculator guidance/);
});

test("verified final purchase reply remains fast for single questions but never truncates other asked topics",()=>{
  for(const text of [
    "What is the final purchase option?",
    "How much is the Rent2Buy final payment?",
    "What happens at the end of the agreement?",
  ]){
    assert.match(deterministicRent2BuyEndOfAgreementReply(text),/£99 \+ VAT/);
  }
  for(const text of [
    "What is the £99 final purchase option, and how do excess mileage charges work?",
    "If I pay the £99 final purchase option at the end, does that mean I automatically own the van, and is insurance included while I rent it?",
    "What is the final payment and do I need fully comprehensive insurance?",
    "Does the final purchase option change if I have exceeded my mileage allowance?",
    "How much is the final purchase option; what is my monthly rental?",
  ]){
    assert.equal(deterministicRent2BuyEndOfAgreementReply(text),null,text);
    assert.equal(controlledBusinessRuntimeReply({message:text,productContext:"rent2buy"}),null,text);
  }
});
