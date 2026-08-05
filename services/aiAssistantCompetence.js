import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-assistant-competence";

export async function requestAssistantCompetence(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "AI Assistant Competence Test request failed.");
}

export const testAssistantAnswer = (payload) => requestAssistantCompetence("testAnswer", payload);
export const startCompetenceRun = (mode, totalQuestions) => requestAssistantCompetence("startRun", { mode, total_questions: totalQuestions });
export const completeCompetenceRun = (runId) => requestAssistantCompetence("completeRun", { run_id: runId });
export const saveCompetenceReview = (payload) => requestAssistantCompetence("saveReview", payload);
export const loadCompetenceReport = () => requestAssistantCompetence("loadReport");
