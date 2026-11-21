import { requestOpenAIConversationReply, parseOpenAIConversationReply } from "./marketing-ai-assistant-competence.js";

const TOKEN = "benchmark-20261121-f84bb3c527ace7d4b080";
const ALLOWED_MODELS = new Set(["gpt-6-sol", "gpt-6.2-sol", "gpt-6.1-terra"]);
const SCENARIOS = [
  {
    product: "finance",
    question: "I'm self-employed with poor credit and only £99 for a deposit. Am I guaranteed van finance?",
    evidence: "S1: Van Finance Company arranges finance only on vehicles it owns; it is not a lender. Finance applications are assessed by lenders and approval is not guaranteed. Deposits from £99 are available only on eligible vehicles and subject to lender decision.",
    check: "Must not promise approval; clarify £99 is conditional and own-stock finance."
  },
  {
    product: "rent2buy",
    question: "I live about 140 miles from Southampton. Could I still use Rent2Buy if I collect the van?",
    evidence: "S1: Rent2Buy Vans is offered only to customers who live within a 100-mile radius of Southampton. Collection or delivery does not remove this geographic eligibility restriction. Do not offer exceptions.",
    check: "Must decline geographic eligibility for 140 miles without offering an exception."
  },
  {
    product: "rent2buy",
    question: "Can I return the van early after 8 months, and would I get my initial rental back?",
    evidence: "S1: Rent2Buy customers may return their vehicle at any time without early termination penalties if the account is fully up to date and 14 days notice is provided. The initial rental is non-refundable and part of the rental agreement.",
    check: "Must specify 14 days notice, account up to date, no penalty, nonrefundable initial rental."
  },
  {
    product: "rent2buy",
    question: "What's the minimum initial rental? Is it just £200 to get going? And is the final purchase price £99 all in?",
    evidence: "S1: A £200 holding deposit reserves the van. Minimum initial rental £1,000 plus VAT (£1,200 inclusive); holding deposit is not the full initial rental. At the end the final purchase option is £99 plus VAT. Do not infer a vehicle-specific monthly price without verified stock.",
    check: "Must distinguish £200 holding deposit, £1,000+VAT initial rental and £99+VAT purchase."
  }
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (process.env.VERCEL_ENV !== "preview" || req.method !== "GET" || req.query?.token !== TOKEN) return res.status(404).json({ok:false});
  const model = String(req.query?.model || "");
  const scenario = Number(req.query?.scenario);
  if (!ALLOWED_MODELS.has(model) || !Number.isInteger(scenario) || scenario < 0 || scenario >= SCENARIOS.length) return res.status(400).json({ok:false, error:"Invalid selection"});
  const data=SCENARIOS[scenario];
  const prompt=[
    "# Customer assistant instructions",
    "You are Ask Me, a UK van sales assistant. Use only the approved verified evidence below. Never invent business policies, prices, guaranteed acceptance, exceptions, or finance terms. Answer clearly and conversationally in under 90 words. Set source_ids to [\"S1\"] when citing the evidence.",
    `# Product context\n${data.product}`,
    `# Retrieved verified business evidence\n${data.evidence}`,
    `# Customer question\n${data.question}`
  ].join("\n\n");
  const begin=performance.now();
  try {
    const { payload }=await requestOpenAIConversationReply(prompt, { model, tier: "full", reasoning_effort: "low" });
    const parsed=parseOpenAIConversationReply(payload,model);
    return res.status(200).json({
      ok:true, model, scenario, case_name:data.check,
      elapsed_ms: Math.round(performance.now()-begin),
      usage:{input_tokens:payload.usage?.input_tokens??null, output_tokens:payload.usage?.output_tokens??null, total_tokens:payload.usage?.total_tokens??null, cached_input_tokens:payload.usage?.input_tokens_details?.cached_tokens??0, reasoning_tokens:payload.usage?.output_tokens_details?.reasoning_tokens??0},
      reply:parsed.reply.reply,
      flags:{insufficient:parsed.reply.insufficient_knowledge,confidence:parsed.reply.confidence,action:parsed.reply.recommended_action},
      response_id_prefix: String(payload.id||"").slice(0,10)
    });
  } catch (error) {
    return res.status(200).json({ok:false,model,scenario,elapsed_ms: Math.round(performance.now()-begin),error: String(error.message||error).slice(0,300)});
  }
}
