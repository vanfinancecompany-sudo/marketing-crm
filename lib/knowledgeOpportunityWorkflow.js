export const KNOWLEDGE_WORKFLOW_ACTIONS = Object.freeze(["create_article", "review_later", "no_action_required"]);

export const KNOWLEDGE_WORKFLOW_LABELS = Object.freeze({
  create_article: "Create Article",
  review_later: "Review Later",
  no_action_required: "No Action Required",
});

export const KNOWLEDGE_WORKFLOW_LIGHTS = Object.freeze({
  create_article: "🟢",
  review_later: "🟠",
  no_action_required: "🔴",
});

export const KNOWLEDGE_WORKFLOW_INACTIVE_STATUSES = Object.freeze([
  "no_action_required", "draft_created", "resolved", "closed", "dismissed", "completed",
]);

const clean = (value) => String(value || "").trim();

function fingerprint(value) {
  let hash = 2166136261;
  for (const character of clean(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `ko-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function knowledgeOpportunityClusterFingerprint(opportunity = {}) {
  return `${clean(opportunity.product).toLowerCase()}:${clean(opportunity.normalised_intent).toLowerCase()}`;
}

export function knowledgeOpportunityEvidenceFingerprint(opportunity = {}) {
  const resultIds = (opportunity.questions || []).map((item) => item.competence_result_id).filter(Boolean).sort();
  return fingerprint(JSON.stringify({
    result_ids: resultIds,
    unique_result_count: Number(opportunity.unique_result_count || 0),
    unanswered_count: Number(opportunity.unanswered_count || 0),
    weak_answer_count: Number(opportunity.weak_answer_count || 0),
    conflict_count: Number(opportunity.conflict_count || 0),
    candidate_reasons: [...(opportunity.candidate_reasons || [])].sort(),
    last_seen_at: clean(opportunity.last_seen_at),
  }));
}

export function recommendedKnowledgeWorkflowAction(opportunity = {}) {
  if (["no_action_required", "covered_existing", "dismissed", "completed", "resolved", "closed"].includes(opportunity.status)) return "no_action_required";
  if (opportunity.status === "review_later") return "review_later";
  if (opportunity.status === "draft_created" || opportunity.linked_article_id) return "create_article";
  return opportunity.recommended_action === "create_article" ? "create_article" : "review_later";
}

export function isDefaultActiveKnowledgeOpportunity(opportunity = {}) {
  return !KNOWLEDGE_WORKFLOW_INACTIVE_STATUSES.includes(opportunity.status);
}

export function hasMeaningfulNewOpportunityEvidence(existing = {}, incoming = {}) {
  const nextFingerprint = knowledgeOpportunityEvidenceFingerprint(incoming);
  if (!existing.evidence_fingerprint || existing.evidence_fingerprint === nextFingerprint) return false;
  const countIncreased = Number(incoming.unique_result_count || 0) > Number(existing.unique_result_count || 0);
  const conflictsIncreased = Number(incoming.conflict_count || 0) > Number(existing.conflict_count || 0);
  const boundary = existing.closed_at || existing.resolved_at || existing.updated_at;
  const newerEvidence = boundary && incoming.last_seen_at && new Date(incoming.last_seen_at).getTime() > new Date(boundary).getTime();
  return countIncreased || conflictsIncreased || Boolean(newerEvidence);
}

export function workflowReopenReason(existing = {}, incoming = {}) {
  const additions = Math.max(0, Number(incoming.unique_result_count || 0) - Number(existing.unique_result_count || 0));
  const conflicts = Math.max(0, Number(incoming.conflict_count || 0) - Number(existing.conflict_count || 0));
  if (conflicts) return `Reopened automatically after ${conflicts} new conflicting result${conflicts === 1 ? "" : "s"}.`;
  if (additions) return `Reopened automatically after ${additions} new competence result${additions === 1 ? "" : "s"}.`;
  return "Reopened automatically because materially newer evidence was detected after closure.";
}
