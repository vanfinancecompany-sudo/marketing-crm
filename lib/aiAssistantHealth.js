import { REAL_CUSTOMER_SCENARIOS } from "./customerSimulationScenarios.js";

export const MAX_DETERMINISTIC_CONVERSATIONS = 10000;
export const DETERMINISTIC_BATCH_LIMIT = 100;
export const LIVE_VALIDATION_MIN = 50;
export const LIVE_VALIDATION_MAX = 100;
export const LIVE_VALIDATION_BATCH_LIMIT = 2;

const round = (value, digits = 1) => Number((Number(value) || 0).toFixed(digits));
const percentage = (passed, total) => total ? round((passed / total) * 100) : 100;
const words = (value) => String(value || "").trim().split(/\s+/).filter(Boolean);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function syntheticScenarioAt(index, scenarios = REAL_CUSTOMER_SCENARIOS) {
  if (!scenarios.length) throw new Error("The health scenario library is empty.");
  const numericIndex = Math.max(0, Math.floor(Number(index) || 0));
  const source = scenarios[numericIndex % scenarios.length];
  const cycle = Math.floor(numericIndex / scenarios.length) + 1;
  return {
    ...source,
    source_scenario_id: source.id,
    id: `HEALTH-${String(numericIndex + 1).padStart(5, "0")}-${source.id}`,
    synthetic_index: numericIndex,
    cycle,
    messages: [...source.messages],
  };
}

export function representativeScenarioAt(sampleIndex, sampleSize, scenarios = REAL_CUSTOMER_SCENARIOS) {
  const total = clamp(Math.floor(Number(sampleSize) || LIVE_VALIDATION_MIN), LIVE_VALIDATION_MIN, LIVE_VALIDATION_MAX);
  const index = clamp(Math.floor(Number(sampleIndex) || 0), 0, total - 1);
  return syntheticScenarioAt(Math.floor(index * scenarios.length / total), scenarios);
}

export function deterministicEvidenceReply(sources = [], productContext = "finance") {
  const source = sources[0];
  if (!source) {
    return {
      reply: "I don’t have enough approved information to answer that accurately. The team can confirm it for you.",
      insufficient_knowledge: true,
      human_handoff_recommended: true,
      recommended_action: "human_handoff",
      confidence: 0,
      confidence_reason: "No approved source passed lexical retrieval.",
      source_ids: [],
    };
  }
  const cleaned = String(source.passage || "")
    .replace(/^Approved [^:]+:\s*/i, "")
    .replace(/\b(?:Never|Do not)\b[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const reply = words(cleaned).slice(0, 90).join(" ") || `Approved ${productContext === "rent2buy" ? "Rent2Buy" : "Finance"} information was found.`;
  return {
    reply,
    insufficient_knowledge: false,
    human_handoff_recommended: false,
    recommended_action: "continue",
    confidence: 100,
    confidence_reason: "Deterministic validation used the highest-ranked approved source without model generation.",
    source_ids: ["S1"],
  };
}

function sourceMatchesProduct(source, productContext, comparisonActive = false) {
  if (comparisonActive) return true;
  if (!source || ["business_brain", "business_faq"].includes(source.type)) return true;
  const product = String(source.product || source.category || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (source.type === "coverage_rule") return product === productContext;
  return productContext === "rent2buy" ? product === "rent2buy" : product !== "rent2buy";
}

function carriesFacts(previous = {}, current = {}, updated = {}) {
  return Object.entries(previous).every(([key, value]) => key in updated || current[key] != null && String(current[key]) === String(value));
}

function readyMessage(message) {
  return /\b(ready to apply|apply now|start (?:the )?application|let'?s apply|lets apply|go ahead|proceed|send me the application|i want this van)\b/i.test(String(message || ""));
}

function explicitComparison(message) {
  return /\b(compare|comparison|difference|versus|vs\.?|both|which (?:option|one))\b/i.test(String(message || ""));
}

export function unsafePromiseDetected(reply = "") {
  const promise = /\b(?:guaranteed approval|guarantee (?:you|approval)|definitely (?:approved|accepted)|promise delivery|will be approved)\b/i;
  const negation = /\b(?:no|not|never|cannot|can\s*t|isn\s*t|won\s*t|without|subject to|depends on)\b/i;
  return String(reply || "").split(/(?<=[.!?])\s+|\n+/).some((sentence) => promise.test(sentence) && !negation.test(sentence));
}

export function evaluateHealthConversation({ scenario, turns = [], mode = "deterministic" } = {}) {
  const failures = [];
  let priorFacts = {};
  let contextChecks = 0;
  let contextPasses = 0;
  let retrievalChecks = 0;
  let retrievalPasses = 0;
  let applicationChecks = 0;
  let applicationPasses = 0;
  let recoveryChecks = 0;
  let recoveryPasses = 0;
  let progressionChecks = 0;
  let progressionPasses = 0;
  let productChecks = 0;
  let productPasses = 0;
  let missedApplicationOpportunities = 0;
  let repeatedWording = 0;
  let clarifications = 0;
  let totalWords = 0;
  let latencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let costKnown = true;
  let comparisonActive = false;

  turns.forEach((turn, turnIndex) => {
    const result = turn.result || {};
    const label = `Turn ${turnIndex + 1}`;
    const currentFacts = result.remembered_facts || {};
    if (Object.keys(priorFacts).length) {
      contextChecks += 1;
      if (carriesFacts(priorFacts, currentFacts, result.updated_facts || {})) contextPasses += 1;
      else failures.push({ rule: "context_retention", turn: turnIndex + 1, message: turn.message, detail: `${label} lost a remembered fact.` });
    }
    priorFacts = currentFacts;
    comparisonActive = comparisonActive || explicitComparison(turn.message) || result.comparison_mode === true;

    const sources = result.knowledge_sources_used || [];
    sources.forEach((source) => {
      productChecks += 1;
      if (sourceMatchesProduct(source, scenario.product_context, comparisonActive)) productPasses += 1;
      else failures.push({ rule: "product_separation", turn: turnIndex + 1, message: turn.message, detail: `${label} admitted ${source.title || source.source_id} from the other product.` });
    });
    productChecks += 1;
    const replyCrossesProduct = !comparisonActive && (scenario.product_context === "finance" ? /\brent\s*(?:2|to)\s*buy\b/i : /\bfinance\b/i).test(result.reply || "");
    if (!replyCrossesProduct) productPasses += 1;
    else failures.push({ rule: "product_separation", turn: turnIndex + 1, message: turn.message, detail: `${label} introduced the other product in its reply.` });

    if (result.retrieval_required) {
      retrievalChecks += 1;
      const groundedSource = sources.some((source) => source.type === "coverage_rule" || (source.matched_terms || []).length > 0);
      const safeGapExpected = /(?:unsupported|unknown)/i.test(scenario.category || "");
      if (result.retrieval_used && groundedSource || result.insufficient_knowledge && safeGapExpected) retrievalPasses += 1;
      else failures.push({ rule: "knowledge_retrieval", turn: turnIndex + 1, message: turn.message, detail: `${label} required retrieval but did not cite a relevant approved source or use the safe knowledge-gap path.` });
    }

    const requiresApplication = readyMessage(turn.message) || result.cta_timing_eligible;
    if (requiresApplication) {
      applicationChecks += 1;
      if (result.application_mode_active || result.application_cta_generated) applicationPasses += 1;
      else {
        missedApplicationOpportunities += 1;
        failures.push({ rule: "application_progression", turn: turnIndex + 1, message: turn.message, detail: `${label} missed an eligible application CTA.` });
      }
    }
    if (result.application_cta?.product && result.application_cta.product !== scenario.product_context) failures.push({ rule: "application_product", turn: turnIndex + 1, message: turn.message, detail: `${label} generated the wrong product CTA.` });

    if (result.recovery_required) {
      recoveryChecks += 1;
      if (result.recovery_rule_used || result.application_mode_active) recoveryPasses += 1;
      else failures.push({ rule: "conversation_recovery", turn: turnIndex + 1, message: turn.message, detail: `${label} did not use the recovery path.` });
    }
    if (/what would you like to know about .+ (?:and|about) ["']?(?:no|yes|\?|two weeks)/i.test(result.reply || "")) failures.push({ rule: "awkward_clarification", turn: turnIndex + 1, message: turn.message, detail: `${label} produced a prohibited clarification pattern.` });
    if (unsafePromiseDetected(result.reply)) failures.push({ rule: "unsafe_promise", turn: turnIndex + 1, message: turn.message, detail: `${label} made an approval or delivery promise.` });
    if (words(result.reply).length > 120) failures.push({ rule: "response_too_long", turn: turnIndex + 1, message: turn.message, detail: `${label} exceeded the 120-word health threshold.` });

    const progressionExpected = ["buying_signal", "ready_to_apply", "agreement"].includes(result.universal_message_type) || result.cta_timing_eligible || ["Interested", "High Intent", "Ready To Apply", "Application Started"].includes(result.buying_intent_level);
    if (progressionExpected) {
      progressionChecks += 1;
      progressionPasses += result.conversation_progressing || result.application_mode_active || result.conversation_resumed || result.application_cta_generated ? 1 : 0;
    }
    repeatedWording += result.repeated_assistant_wording || result.repeated_phrase_detected ? 1 : 0;
    clarifications += result.clarification_required ? 1 : 0;
    totalWords += Number(result.response_word_count) || words(result.reply).length;
    latencyMs += Number(result.response_time_ms) || 0;
    inputTokens += Number(result.token_usage?.input_tokens) || 0;
    outputTokens += Number(result.token_usage?.output_tokens) || 0;
    if (result.estimated_cost_usd == null) costKnown = false;
    else estimatedCostUsd += Number(result.estimated_cost_usd) || 0;
  });

  const totalTurns = turns.length;
  return {
    scenario_id: scenario.id,
    source_scenario_id: scenario.source_scenario_id || scenario.id,
    scenario_name: scenario.name,
    category: scenario.category,
    product_context: scenario.product_context,
    mode,
    turns: totalTurns,
    checks: {
      conversation_progression: { passed: progressionPasses, total: progressionChecks },
      context_retention: { passed: contextPasses, total: contextChecks },
      product_separation: { passed: productPasses, total: productChecks },
      knowledge_retrieval: { passed: retrievalPasses, total: retrievalChecks },
      application_progression: { passed: applicationPasses, total: applicationChecks },
      recovery_success: { passed: recoveryPasses, total: recoveryChecks },
    },
    missed_application_opportunities: missedApplicationOpportunities,
    repeated_wording: repeatedWording,
    clarifications,
    response_words: totalWords,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: costKnown ? round(estimatedCostUsd, 6) : null,
    rule_violations: failures.length,
    failures,
  };
}

export function emptyHealthAccumulator(mode = "deterministic") {
  return {
    mode,
    conversations: 0,
    turns: 0,
    checks: Object.fromEntries(["conversation_progression", "context_retention", "product_separation", "knowledge_retrieval", "application_progression", "recovery_success"].map((key) => [key, { passed: 0, total: 0 }])),
    missed_application_opportunities: 0,
    repeated_wording: 0,
    clarifications: 0,
    response_words: 0,
    latency_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    cost_known: true,
    rule_violations: 0,
    failed_scenarios: [],
    category_results: {},
    product_results: {},
  };
}

function addBreakdown(target, key, result) {
  const entry = target[key] || { conversations: 0, failed: 0, rule_violations: 0 };
  entry.conversations += 1;
  entry.failed += result.failures.length ? 1 : 0;
  entry.rule_violations += result.rule_violations;
  target[key] = entry;
}

export function addHealthConversation(accumulator, result) {
  const next = structuredClone(accumulator || emptyHealthAccumulator(result.mode));
  next.conversations += 1;
  next.turns += result.turns;
  Object.entries(result.checks).forEach(([key, check]) => {
    next.checks[key].passed += check.passed;
    next.checks[key].total += check.total;
  });
  for (const key of ["missed_application_opportunities", "repeated_wording", "clarifications", "response_words", "latency_ms", "input_tokens", "output_tokens", "rule_violations"]) next[key] += Number(result[key]) || 0;
  if (result.estimated_cost_usd == null) next.cost_known = false;
  else next.estimated_cost_usd += Number(result.estimated_cost_usd) || 0;
  if (result.failures.length && next.failed_scenarios.length < 100) next.failed_scenarios.push({ scenario_id: result.scenario_id, source_scenario_id: result.source_scenario_id, name: result.scenario_name, category: result.category, product_context: result.product_context, failures: result.failures });
  addBreakdown(next.category_results, result.category, result);
  addBreakdown(next.product_results, result.product_context, result);
  return next;
}

export function mergeHealthAccumulators(left, right) {
  let merged = structuredClone(left || emptyHealthAccumulator(right?.mode));
  if (!right) return merged;
  merged.conversations += right.conversations;
  merged.turns += right.turns;
  Object.entries(right.checks).forEach(([key, check]) => {
    merged.checks[key].passed += check.passed;
    merged.checks[key].total += check.total;
  });
  for (const key of ["missed_application_opportunities", "repeated_wording", "clarifications", "response_words", "latency_ms", "input_tokens", "output_tokens", "estimated_cost_usd", "rule_violations"]) merged[key] += Number(right[key]) || 0;
  merged.cost_known = merged.cost_known && right.cost_known;
  merged.failed_scenarios = [...merged.failed_scenarios, ...(right.failed_scenarios || [])].slice(0, 100);
  for (const [key, value] of Object.entries(right.category_results || {})) {
    const current = merged.category_results[key] || { conversations: 0, failed: 0, rule_violations: 0 };
    merged.category_results[key] = { conversations: current.conversations + value.conversations, failed: current.failed + value.failed, rule_violations: current.rule_violations + value.rule_violations };
  }
  for (const [key, value] of Object.entries(right.product_results || {})) {
    const current = merged.product_results[key] || { conversations: 0, failed: 0, rule_violations: 0 };
    merged.product_results[key] = { conversations: current.conversations + value.conversations, failed: current.failed + value.failed, rule_violations: current.rule_violations + value.rule_violations };
  }
  return merged;
}

export function summariseHealth(accumulator = emptyHealthAccumulator()) {
  const rate = (key) => percentage(accumulator.checks[key].passed, accumulator.checks[key].total);
  const rates = {
    conversation_progression: rate("conversation_progression"),
    context_retention: rate("context_retention"),
    product_separation_accuracy: rate("product_separation"),
    knowledge_retrieval_accuracy: rate("knowledge_retrieval"),
    application_progression_accuracy: rate("application_progression"),
    recovery_success: rate("recovery_success"),
  };
  const violationScore = percentage(Math.max(0, accumulator.turns - accumulator.rule_violations), accumulator.turns);
  const overall = round(
    rates.conversation_progression * 0.1 +
    rates.context_retention * 0.15 +
    rates.product_separation_accuracy * 0.2 +
    rates.knowledge_retrieval_accuracy * 0.2 +
    rates.application_progression_accuracy * 0.15 +
    rates.recovery_success * 0.1 +
    violationScore * 0.1,
  );
  return {
    ...accumulator,
    ...rates,
    overall_ai_health_score: clamp(overall, 0, 100),
    response_quality_score: clamp(overall, 0, 100),
    repeated_wording_rate: percentage(accumulator.repeated_wording, accumulator.turns),
    clarification_rate: percentage(accumulator.clarifications, accumulator.turns),
    average_response_length_words: accumulator.turns ? round(accumulator.response_words / accumulator.turns) : 0,
    average_response_ms: accumulator.turns ? Math.round(accumulator.latency_ms / accumulator.turns) : 0,
    average_input_tokens: accumulator.conversations ? Math.round(accumulator.input_tokens / accumulator.conversations) : 0,
    average_output_tokens: accumulator.conversations ? Math.round(accumulator.output_tokens / accumulator.conversations) : 0,
    estimated_cost_usd: accumulator.cost_known ? round(accumulator.estimated_cost_usd, 6) : null,
    estimated_cost_per_conversation_usd: accumulator.cost_known && accumulator.conversations ? round(accumulator.estimated_cost_usd / accumulator.conversations, 6) : null,
    failed_scenario_count: Object.values(accumulator.category_results).reduce((sum, item) => sum + item.failed, 0),
  };
}

export function liveValidationAllowed(environment = process.env) {
  return environment.VERCEL_ENV === "preview" || environment.AI_HEALTH_ALLOW_LOCAL_LIVE === "true" && environment.NODE_ENV !== "production";
}

export function estimateOpenAICost(usage = {}, environment = process.env) {
  const inputRate = Number(environment.OPENAI_INPUT_COST_PER_MILLION_USD);
  const outputRate = Number(environment.OPENAI_OUTPUT_COST_PER_MILLION_USD);
  if (!Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) return null;
  return round(((Number(usage.input_tokens) || 0) * inputRate + (Number(usage.output_tokens) || 0) * outputRate) / 1_000_000, 6);
}
