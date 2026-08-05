export const MODEL_COMPARISON_OUTCOMES = Object.freeze(["default_better", "comparison_better", "equivalent", "both_poor"]);
export const MODEL_COMPARISON_RATING_FIELDS = Object.freeze([
  "context_understanding", "naturalness", "answer_accuracy", "clarification_quality", "conversation_recovery",
  "product_separation", "helpfulness", "brevity", "buying_intent_recognition", "application_progression", "safety",
]);

export function stableComparisonInput(value) {
  if (Array.isArray(value)) return value.map(stableComparisonInput);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableComparisonInput(value[key])]));
  return value;
}

const average = (values) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function modelComparisonSummary(comparisons = [], reviews = []) {
  const reviewByComparison = new Map(reviews.map((review) => [review.comparison_id, review]));
  const completed = comparisons.filter((item) => item.default_result?.status && item.comparison_result?.status);
  const reviewed = completed.map((item) => ({ ...item, review: reviewByComparison.get(item.id) })).filter((item) => item.review);
  const outcomeCount = (outcome) => reviewed.filter((item) => item.review.outcome === outcome).length;
  const resultMetric = (side, field) => average(completed.map((item) => numeric(item[`${side}_result`]?.[field])));
  const ratingAverages = (side) => Object.fromEntries(MODEL_COMPARISON_RATING_FIELDS.map((field) => [field, average(reviewed.map((item) => numeric(item.review?.[`${side}_ratings`]?.[field])).filter(Boolean))]));
  const performance = (rows) => {
    const validReviews = rows.map((item) => ({ ...item, review: reviewByComparison.get(item.id) })).filter((item) => item.review);
    return {
      comparisons: rows.length, reviewed: validReviews.length,
      default_wins: validReviews.filter((item) => item.review.outcome === "default_better").length,
      comparison_wins: validReviews.filter((item) => item.review.outcome === "comparison_better").length,
      ties: validReviews.filter((item) => item.review.outcome === "equivalent").length,
      both_poor: validReviews.filter((item) => item.review.outcome === "both_poor").length,
      default_average_response_ms: average(rows.map((item) => numeric(item.default_result?.response_time_ms))),
      comparison_average_response_ms: average(rows.map((item) => numeric(item.comparison_result?.response_time_ms))),
    };
  };
  const group = (key) => Object.fromEntries([...new Set(completed.map((item) => item[key] || "unknown"))].map((value) => [value, performance(completed.filter((item) => (item[key] || "unknown") === value))]));
  const costs = completed.flatMap((item) => [item.default_result?.estimated_cost_usd, item.comparison_result?.estimated_cost_usd]).filter((value) => value != null).map(Number);
  const defaultCosts = completed.map((item) => item.default_result?.estimated_cost_usd).filter((value) => value != null).map(Number);
  const comparisonCosts = completed.map((item) => item.comparison_result?.estimated_cost_usd).filter((value) => value != null).map(Number);
  return {
    total_comparisons: completed.length,
    reviewed_comparisons: reviewed.length,
    default_wins: outcomeCount("default_better"),
    comparison_wins: outcomeCount("comparison_better"),
    ties: outcomeCount("equivalent"),
    both_poor: outcomeCount("both_poor"),
    default_average_ratings: ratingAverages("default"),
    comparison_average_ratings: ratingAverages("comparison"),
    default_average_response_ms: resultMetric("default", "response_time_ms"),
    comparison_average_response_ms: resultMetric("comparison", "response_time_ms"),
    default_average_input_tokens: resultMetric("default", "input_tokens"),
    comparison_average_input_tokens: resultMetric("comparison", "input_tokens"),
    default_average_output_tokens: resultMetric("default", "output_tokens"),
    comparison_average_output_tokens: resultMetric("comparison", "output_tokens"),
    default_average_estimated_cost_usd: average(defaultCosts),
    comparison_average_estimated_cost_usd: average(comparisonCosts),
    default_estimated_cost_per_1000_conversations_usd: defaultCosts.length ? Number((average(defaultCosts) * 1000).toFixed(4)) : null,
    comparison_estimated_cost_per_1000_conversations_usd: comparisonCosts.length ? Number((average(comparisonCosts) * 1000).toFixed(4)) : null,
    average_estimated_cost_per_response_usd: average(costs),
    estimated_cost_per_1000_conversations_usd: costs.length ? Number((average(costs) * 1000).toFixed(4)) : null,
    by_scenario_category: group("scenario_category"),
    difficult_short_messages: performance(completed.filter((item) => String(item.submitted_message || "").trim().split(/\s+/).filter(Boolean).length <= 2)),
    by_product: group("product_context"),
    statistical_significance_claimed: false,
  };
}
