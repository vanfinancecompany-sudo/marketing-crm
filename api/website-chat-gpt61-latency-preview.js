// Preview-only, synthetic customer-chat latency comparison. No customer data or database writes.
import { performance } from "node:perf_hooks";
import { requestOpenAIConversationReply, parseOpenAIConversationReply } from "./marketing-ai-assistant-competence.js";

const SAMPLES = Object.freeze([
  {
    product: "rent2buy",
    question: "If I select 1,000 miles per month but drive 1,200, what would I pay extra?",
    evidence: "The agreed allowance is 1,000 miles monthly. Each excess mile costs 20p + VAT and is charged the following month. Explain the 200 extra miles without inventing other fees.",
    check: "200 extra miles is £40 plus VAT, billed the next month."
  },
  {
    product: "finance",
    question: "I'm self-employed and have a CCJ. Can you guarantee I'll get finance?",
    evidence: "The company welcomes enquiries from self-employed customers and those with adverse credit. Approval is subject to a lender's individual checks, so no guarantee can be made.",
    check: "Never promise approval; invite application."
  },
  {
    product: "rent2buy",
    question: "Can I change my monthly mileage and initial rental before applying, and will the monthly payment change?",
    evidence: "The customer can adjust term, mileage and initial rental in the website quote calculator before continuing to the application. Figures must come from the signed website quote, not a guess.",
    check: "Explain recalculation, don't invent quotation."
  },
  {
    product: "finance",
    question: "Can you deliver next Tuesday and is the van definitely available?",
    evidence: "Live vehicle availability and delivery dates must be checked by the team. Never guarantee a delivery date or live availability without confirmation.",
    check: "Do not promise delivery or stock."
  },
  {
    product: "rent2buy",
    question: "I've had finance declined and I only started my business recently. Is Rent2Buy suitable, how does the deposit work, and can I collect this week?",
    evidence: "Rent2Buy enquiries from new businesses or people with poor credit are welcome, subject to eligibility and approval. The upfront amount is called an initial rental and the customer can see an accurate quote in the calculator. Collection timing is confirmed by staff only.",
    check: "Handle all three parts; avoid guarantees and made-up numbers."
  }
]);

const clean = v => String(v || "").slice(0, 500);
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (req.method !== "GET" || process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "test/website-chat-gpt61-sol-latency-20261028") {
    return res.status(404).json({ error: "not_found" });
  }
  const sampleNumber = Number(req.query.sample);
  const selector = String(req.query.model || "");
  const service = String(req.query.service || "standard");
  const effort = String(req.query.effort || "low");
  const MODEL_OPTIONS = { old: "gpt-6-sol", new: "gpt-6.1-sol" };
  if (!Number.isInteger(sampleNumber) || sampleNumber < 0 || sampleNumber >= SAMPLES.length ||
    !(selector in MODEL_OPTIONS) || !["standard", "fast"].includes(service) ||
    !["low", "medium"].includes(effort)) return res.status(400).json({ error: "invalid_test" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "preview_api_key_missing" });

  const s = SAMPLES[sampleNumber];
  const prompt = [
    "You are the customer-facing UK van website assistant called Jasmine. Respond clearly and naturally in UK English.",
    "Use only the following verified evidence, never speculate, and be honest about unknowns.",
    "Keep your answer short, helpful, direct and conversational, normally 45-80 words.",
    "Do not promise approval, availability, collection dates or financial results.",
    "Product context: " + s.product,
    "Verified business evidence: " + s.evidence,
    "Customer message: " + s.question
  ].join("\n");
  const fetchWithTier = async (url, init) => {
    const body = JSON.parse(init.body);
    if (service === "fast") body.service_tier = "fast";
    return fetch(url, { ...init, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  };
  const begin = performance.now();
  try {
    const requested = await requestOpenAIConversationReply(
      prompt, { model: MODEL_OPTIONS[selector], reasoning_effort: effort }, process.env, fetchWithTier
    );
    const generated = parseOpenAIConversationReply(requested.payload, requested.model);
    const durationMs = Math.round(performance.now() - begin);
    const usage = requested.payload?.usage || {};
    return res.status(200).json({
      sample: sampleNumber, product: s.product, question: s.question, success_criteria: s.check,
      model: requested.model, service_requested: service, service_actual: requested.payload?.service_tier || null,
      effort, generation_ms: durationMs, answer: generated.reply.reply,
      input_tokens: Number(usage.input_tokens) || 0,
      output_tokens: Number(usage.output_tokens) || 0,
      status: "ok"
    });
  } catch (error) {
    return res.status(502).json({
      sample: sampleNumber, model: MODEL_OPTIONS[selector], service_requested: service,
      duration_ms: Math.round(performance.now() - begin),
      error: error?.status === 429 ? "rate_limited" : "request_failed",
      detail: clean(error?.message).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    });
  }
}
