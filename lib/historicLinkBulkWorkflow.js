import { findInternalLinkAnchorMatches } from "./internalLinkAnchorValidation.js";

const clean = (value, limit = 20000) => String(value || "").trim().slice(0, limit);

export const HISTORIC_LINK_RETROFIT_ACTION = "historic_link_retrofit_completed";

// Already completed before the persistent bulk workflow existed.
export const HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS = Object.freeze([
  // Five new national used-van articles are not historic retrofit candidates.
  "690ba19c-307c-47f3-b1c7-075d76512cab",
  "2ff68e45-1f45-4796-973c-3d91ab1b2751",
  "b896395d-6dab-41bb-aba4-e8dcc6fb3e92",
  "7c9c8354-b193-4476-b935-151b06c1db48",
  "1990cee7-1831-4a08-b915-6da8d6a60ec9",
  // Historic Batch 1, completed and legacy-cleaned before this workflow shipped.
  "cc4a7ff8-811f-4198-b8af-2ec9bf9415cd",
  "6abe2923-08d5-46c4-b5f8-fabf88055a94",
  "60d99308-c80e-4dbf-a41d-72d4fde87282",
  "071c0dff-a3ce-472b-b61f-0bcc87350b06",
  "ab4c396c-d1d0-41cd-84dd-45de4f224738",
  "1b9124f1-a3a9-4d42-bb86-c4271cbf1dc8",
  "883d283a-724e-4533-b796-645f9c9e8139",
  "c882d8a5-e52f-45a0-b962-754fa68c292c",
  "97c93a1f-9811-4f24-9fbf-3f819753b170",
  "5b8c2905-fe8e-4e27-bec0-d812f63a0c10",
  "de543dc3-0013-4648-a7ba-a9e7312f9422",
  "9c53c8d0-d8f8-4020-b259-eb4e7ee1c69b",
  "50857514-56e7-47b0-ac54-0af189e49a0f",
  "d32e6140-ee90-4ed8-9e53-b1ecf4ecebbd",
  "c86ea60a-9c5d-4ec0-b3d7-e571cd58e8ae",
  "8eba5757-1719-4409-86d1-62301214c8f4",
  "940def8d-54df-4acc-bd0c-03c783d72d1f",
  "e7a4c650-ac2d-4f3e-95a0-38718e52aecb",
  "f18a878d-aee4-4ddc-a89e-6fd25a06d5a1",
  "7c47fb62-22d5-4aab-a6ca-fa5b1aa5db7b",
]);

const STOP = new Set([
  "about", "after", "before", "business", "company", "complete", "finance", "guide", "helps", "latest",
  "more", "purchase", "the", "their", "this", "used", "using", "van", "vans", "vehicle", "vehicles", "what",
  "when", "where", "which", "with", "your", "from", "into", "have", "that", "for", "and", "are", "how",
]);

function tokens(value) {
  return clean(value, 5000).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word));
}

function ordinaryTextLines(markdown) {
  return clean(markdown, 200000)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^\|.*\|$/.test(line))
    .filter((line) => !/^[-:|\s]+$/.test(line))
    .filter((line) => !(/^\*\*.*\*\*$/.test(line) || /^\*[^*].*\*$/.test(line)))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""));
}

function commercialSignals(url) {
  const value = clean(url, 3000).toLowerCase();
  if (value.includes("vans-on-finance") || value.includes("rent2buy-all-vans") || value.endsWith("/rent2buyvans")) {
    return ["choose", "choosing", "compare", "available", "browse", "search", "stock", "vans", "vehicle", "vehicles"];
  }
  if (value.includes("application")) return ["apply", "applying", "application", "submit", "information", "details"];
  return [];
}

export function sourceSnippetsForSuggestion(articleMarkdown, suggestion = {}, maximum = 4) {
  const destinationTokens = new Set([
    ...tokens(suggestion.destination_title),
    ...commercialSignals(suggestion.destination_url),
  ]);
  const sentences = ordinaryTextLines(articleMarkdown)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18 && sentence.length <= 320);

  return sentences
    .map((sentence, index) => {
      const sentenceTokens = new Set(tokens(sentence));
      const overlap = [...destinationTokens].filter((token) => sentenceTokens.has(token)).length;
      return { sentence, overlap, index };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .slice(0, maximum)
    .map((item) => item.sentence);
}

export function compactHistoricSuggestion(articleMarkdown, suggestion = {}) {
  const validation = findInternalLinkAnchorMatches(articleMarkdown, clean(suggestion.anchor_text, 500));
  return {
    id: suggestion.id,
    status: suggestion.status,
    target_type: suggestion.target_type,
    destination_title: suggestion.destination_title,
    destination_url: suggestion.destination_url,
    anchor_text: suggestion.anchor_text,
    confidence_score: suggestion.confidence_score,
    reason: suggestion.reason,
    anchor_found: validation.found,
    anchor_match_count: validation.match_count || 0,
    source_snippets: sourceSnippetsForSuggestion(articleMarkdown, suggestion),
  };
}

export function validateHistoricBatchDecisions({ articleId, suggestions = [], decisions = [] } = {}) {
  const byId = new Map(suggestions.map((item) => [item.id, item]));
  const seen = new Set();
  for (const decision of decisions) {
    const suggestionId = clean(decision?.suggestion_id, 100);
    if (!suggestionId || seen.has(suggestionId)) throw new Error(`Duplicate or missing suggestion decision for article ${articleId}.`);
    seen.add(suggestionId);
    const suggestion = byId.get(suggestionId);
    if (!suggestion) throw new Error(`Suggestion ${suggestionId} does not belong to article ${articleId}.`);
    const action = clean(decision?.decision, 40);
    if (!["accept", "reject", "edit_anchor", "keep"].includes(action)) throw new Error(`Unsupported decision ${action || "(blank)"}.`);
    if (action === "accept" && suggestion.status !== "pending") throw new Error(`Only pending suggestion ${suggestionId} can be accepted.`);
    if (["edit_anchor", "keep"].includes(action) && suggestion.status !== "accepted") throw new Error(`Only accepted suggestion ${suggestionId} can be kept or re-anchored.`);
    if (action === "reject" && !["pending", "accepted"].includes(suggestion.status)) throw new Error(`Suggestion ${suggestionId} cannot be rejected from ${suggestion.status}.`);
  }
  return true;
}
