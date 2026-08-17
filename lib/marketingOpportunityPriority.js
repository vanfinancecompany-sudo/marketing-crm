function clean(value) {
  return String(value || "").trim();
}

function boundedVolumeScore(count) {
  const value = Math.max(0, Number(count) || 0);
  if (!value) return 0;
  return Math.min(30, Math.round(Math.log10(value + 1) * 10));
}

export function scoreMarketingOpportunity(opportunity = {}) {
  const actionable = opportunity.campaign_creation_supported === true;
  const objective = clean(opportunity.recommended_objective);
  const channel = clean(opportunity.recommended_channel);
  const volume = boundedVolumeScore(opportunity.customer_count);
  const actionability = actionable ? 50 : 10;
  const objectiveWeight = ["re_engagement", "new_stock", "finance_offer", "promotion"].includes(objective) ? 15 : 5;
  const channelWeight = channel === "email" ? 5 : 3;
  return Math.min(100, actionability + objectiveWeight + channelWeight + volume);
}

export function enrichMarketingOpportunity(opportunity = {}) {
  const priorityScore = scoreMarketingOpportunity(opportunity);
  const supported = opportunity.campaign_creation_supported === true;
  return {
    ...opportunity,
    priority_score: priorityScore,
    priority_band: supported && priorityScore >= 80 ? "act_now" : supported ? "ready" : "build_next",
    recommended_next_action: supported
      ? "Create a campaign from this ready audience and review the recipient preview before sending."
      : "Finish the audience filter before treating this as an actionable campaign opportunity.",
  };
}

export function prioritiseMarketingOpportunities(opportunities = []) {
  return (Array.isArray(opportunities) ? opportunities : [])
    .map(enrichMarketingOpportunity)
    .sort((left, right) =>
      Number(right.priority_score || 0) - Number(left.priority_score || 0)
      || Number(right.customer_count || 0) - Number(left.customer_count || 0)
      || clean(left.title).localeCompare(clean(right.title))
    );
}
