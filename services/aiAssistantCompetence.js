import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-assistant-competence";

export function createCompetenceRequestId() {
  return globalThis.crypto?.randomUUID?.() || `competence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function acceptCompetenceResponse(activeRequestId, responsePayload) {
  return responsePayload?.request_trace?.request_id === activeRequestId ? responsePayload : null;
}

export async function requestAssistantCompetence(action, payload = {}, fetchImplementation = fetch) {
  const requestId = payload.request_id || createCompetenceRequestId();
  const response = await fetchImplementation(API_ROUTE, {
    method: "POST",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Competence-Request-ID": requestId }),
    body: JSON.stringify({ action, ...payload, request_id: requestId }),
  });
  return parseMarketingJsonResponse(response, "AI Assistant Competence Test request failed.");
}

export const testAssistantAnswer = (payload, fetchImplementation) => requestAssistantCompetence("testAnswer", payload, fetchImplementation);
export const startCompetenceRun = (mode, totalQuestions) => requestAssistantCompetence("startRun", { mode, total_questions: totalQuestions });
export const completeCompetenceRun = (runId) => requestAssistantCompetence("completeRun", { run_id: runId });
export const saveCompetenceReview = (payload) => requestAssistantCompetence("saveReview", payload);
export const loadCompetenceReport = () => requestAssistantCompetence("loadReport");
export const simulateCustomerConversation = (payload, fetchImplementation) => requestAssistantCompetence("simulateConversation", payload, fetchImplementation);
export const saveConversationReview = (payload, fetchImplementation) => requestAssistantCompetence("saveConversationReview", payload, fetchImplementation);
export const loadCustomerSimulationLibrary = (fetchImplementation) => requestAssistantCompetence("loadTestLibrary", {}, fetchImplementation);
