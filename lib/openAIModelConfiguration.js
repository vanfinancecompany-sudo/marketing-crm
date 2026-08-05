export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
export const ALLOWED_COMPARISON_MODELS = Object.freeze(["gpt-4.1"]);

// Reviewed against official OpenAI model pricing on 2026-08-06.
// Values are USD per one million text tokens and should be reviewed when pricing changes.
export const OPENAI_MODEL_PRICING = Object.freeze({
  "gpt-4.1-mini": Object.freeze({ input: 0.4, cached_input: 0.1, output: 1.6, reviewed_at: "2026-08-06" }),
  "gpt-4.1": Object.freeze({ input: 2, cached_input: 0.5, output: 8, reviewed_at: "2026-08-06" }),
});

const clean = (value, limit = 200) => String(value || "").trim().slice(0, limit);

export function isPreviewDeployment(environment = process.env) {
  return clean(environment.VERCEL_ENV, 30).toLowerCase() === "preview";
}

export function openAIModelConfiguration(environment = process.env) {
  const defaultModel = clean(environment.OPENAI_MODEL) || DEFAULT_OPENAI_MODEL;
  const requestedComparison = clean(environment.OPENAI_COMPARISON_MODEL);
  const comparisonAllowed = !requestedComparison || ALLOWED_COMPARISON_MODELS.includes(requestedComparison);
  return {
    configured: Boolean(clean(environment.OPENAI_API_KEY, 10000)),
    default_model: defaultModel,
    comparison_model: requestedComparison && comparisonAllowed ? requestedComparison : null,
    comparison_requested: requestedComparison || null,
    comparison_allowed: comparisonAllowed,
    comparison_available: isPreviewDeployment(environment) && Boolean(requestedComparison) && comparisonAllowed,
    preview: isPreviewDeployment(environment),
  };
}

export function resolveServerModel(selection = "default", environment = process.env) {
  const configuration = openAIModelConfiguration(environment);
  if (selection === "default") return configuration.default_model;
  if (selection !== "comparison") throw new Error("Unsupported model selection.");
  if (!configuration.preview) throw new Error("Model comparison is available only on Preview deployments.");
  if (!configuration.comparison_requested) throw new Error("OPENAI_COMPARISON_MODEL is not configured for Preview.");
  if (!configuration.comparison_allowed) throw new Error("OPENAI_COMPARISON_MODEL is not in the server allowlist.");
  return configuration.comparison_model;
}

export function responseTokenUsage(payload = {}) {
  const usage = payload?.usage || {};
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  return { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: Math.max(input + output, Number(usage.total_tokens) || 0) };
}

export function estimateOpenAICost(model, usage = {}) {
  const pricing = OPENAI_MODEL_PRICING[model];
  if (!pricing) return { estimated_cost_usd: null, pricing_available: false, pricing_reviewed_at: null };
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.cached_input_tokens) || 0));
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  const cost = ((input - cached) * pricing.input + cached * pricing.cached_input + output * pricing.output) / 1_000_000;
  return { estimated_cost_usd: Number(cost.toFixed(8)), pricing_available: true, pricing_reviewed_at: pricing.reviewed_at };
}

export function publicModelComparisonConfiguration(environment = process.env) {
  const configuration = openAIModelConfiguration(environment);
  return {
    preview: configuration.preview,
    comparison_available: configuration.comparison_available,
    default_model: configuration.default_model,
    comparison_model: configuration.comparison_model,
    comparison_error: !configuration.preview ? "Comparison is disabled outside Preview." : !configuration.comparison_requested ? "OPENAI_COMPARISON_MODEL is not configured." : !configuration.comparison_allowed ? "Configured comparison model is not allowlisted." : null,
    pricing: Object.fromEntries([configuration.default_model, configuration.comparison_model].filter(Boolean).map((model) => [model, OPENAI_MODEL_PRICING[model] || null])),
  };
}
