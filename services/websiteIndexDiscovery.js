import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-website-index-discovery";

async function request(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Website Index discovery request failed.");
}

export const loadWebsiteIndexDiscovery = () => request("load");
export const scanWebsiteIndex = (rootUrl) => request("scan", { root_url: rootUrl });
export const editWebsiteIndexCandidate = (candidateId, changes) =>
  request("edit", { candidate_id: candidateId, changes });
export const approveWebsiteIndexCandidate = (candidateId) =>
  request("approve", { candidate_id: candidateId });
export const rejectWebsiteIndexCandidate = (candidateId, reason = "") =>
  request("reject", { candidate_id: candidateId, reason });
export const mergeWebsiteIndexCandidate = (candidateId, existingPageId, selectedFields) =>
  request("merge", { candidate_id: candidateId, existing_page_id: existingPageId, selected_fields: selectedFields });
export const deleteWebsiteIndexCandidate = (candidateId) =>
  request("delete", { candidate_id: candidateId });
