import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-editorial-automation";

export async function requestEditorialAutomation(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Editorial Automation request failed.");
}

export const loadEditorialAutomation = () => requestEditorialAutomation("load");
export const pauseEditorialAutomation = () => requestEditorialAutomation("pause");
export const resumeEditorialAutomation = () => requestEditorialAutomation("resume");
export const saveEditorialAutomationSettings = (settings) =>
  requestEditorialAutomation("saveSettings", { settings });
export const scanEditorialOpportunities = () => requestEditorialAutomation("scanNow");
export const approveEditorialOpportunity = (opportunityId, overrides = {}) =>
  requestEditorialAutomation("approveOpportunity", {
    opportunity_id: opportunityId,
    overrides,
  });
export const dismissEditorialOpportunity = (opportunityId, reason = "") =>
  requestEditorialAutomation("dismissOpportunity", {
    opportunity_id: opportunityId,
    reason,
  });
export const cancelEditorialJob = (jobId, reason = "") =>
  requestEditorialAutomation("cancelJob", { job_id: jobId, reason });
export const retryEditorialJob = (jobId) =>
  requestEditorialAutomation("retryJob", { job_id: jobId });
