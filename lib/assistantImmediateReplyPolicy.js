// Strictly bounded immediate replies; never bypass AI for facts, ambiguity or customer progression.
const SAFE_INTENTS = new Set(["greeting", "thanks", "goodbye"]);

export function canUseInstantAcknowledgement({ intent = {}, orchestration = {}, journey = {}, latestQuestionRequiresAnswer = false, response = null } = {}) {
  return SAFE_INTENTS.has(intent.primary_intent) &&
    !intent.retrieval_required &&
    !intent.clarification_required &&
    !orchestration.retrieval_required &&
    !orchestration.recovery_required &&
    !orchestration.application_continuation &&
    !journey.application_mode_active &&
    !latestQuestionRequiresAnswer &&
    typeof response?.reply === "string" &&
    response.reply.trim().length > 0;
}
