import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-assistant-competence";
const LIVE_HEALTH_API_ROUTE = "/api/marketing-ai-assistant-health-live";

export function createCompetenceRequestId() {
  return globalThis.crypto?.randomUUID?.() || `competence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function acceptCompetenceResponse(activeRequestId, responsePayload) {
  return responsePayload?.request_trace?.request_id === activeRequestId ? responsePayload : null;
}

async function requestProtectedRoute(route, action, payload = {}, fetchImplementation = fetch) {
  const requestId = payload.request_id || createCompetenceRequestId();
  const response = await fetchImplementation(route, {
    method: "POST",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Competence-Request-ID": requestId }),
    body: JSON.stringify({ action, ...payload, request_id: requestId }),
  });
  return parseMarketingJsonResponse(response, "AI Assistant Competence Test request failed.");
}

export function requestAssistantCompetence(action, payload = {}, fetchImplementation = fetch) {
  return requestProtectedRoute(API_ROUTE, action, payload, fetchImplementation);
}

export function requestAssistantLiveHealth(action, payload = {}, fetchImplementation = fetch) {
  return requestProtectedRoute(LIVE_HEALTH_API_ROUTE, action, payload, fetchImplementation);
}

export const testAssistantAnswer = (payload, fetchImplementation) => requestAssistantCompetence("testAnswer", payload, fetchImplementation);
export const startCompetenceRun = (mode, totalQuestions) => requestAssistantCompetence("startRun", { mode, total_questions: totalQuestions });
export const completeCompetenceRun = (runId) => requestAssistantCompetence("completeRun", { run_id: runId });
export const saveCompetenceReview = (payload) => requestAssistantCompetence("saveReview", payload);
export const loadCompetenceReport = () => requestAssistantCompetence("loadReport");
export const simulateCustomerConversation = (payload, fetchImplementation) => requestAssistantCompetence("simulateConversation", payload, fetchImplementation);
export const saveConversationReview = (payload, fetchImplementation) => requestAssistantCompetence("saveConversationReview", payload, fetchImplementation);
export const loadCustomerSimulationLibrary = (fetchImplementation) => requestAssistantCompetence("loadTestLibrary", {}, fetchImplementation);
export const loadAssistantHealthConfiguration = (fetchImplementation) => requestAssistantLiveHealth("configuration", {}, fetchImplementation);
export const runDeterministicHealthBatch = (payload, fetchImplementation) => requestAssistantCompetence("runDeterministicHealthBatch", payload, fetchImplementation);
export const runLiveHealthBatch = (payload, fetchImplementation) => requestAssistantLiveHealth("runLiveHealthBatch", payload, fetchImplementation);
