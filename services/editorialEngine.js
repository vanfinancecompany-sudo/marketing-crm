import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";
import { findInternalLinkAnchorMatches } from "../lib/internalLinkAnchorValidation.js";

const API_ROUTE = "/api/marketing-editorial-engine";

export async function requestEditorialEngine(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Editorial Engine request failed.");
}

export const loadEditorialEngine = () => requestEditorialEngine("load");

export const analyseEditorialArticle = (articleId) =>
  requestEditorialEngine("analyseArticle", { article_id: articleId });

export const saveBusinessIntentOverrides = (articleId, overrides) =>
  requestEditorialEngine("saveIntentOverrides", { article_id: articleId, overrides });

export const saveArticleEditorialOverrides = (articleId, overrides) =>
  requestEditorialEngine("saveEditorialOverrides", { article_id: articleId, overrides });

export const proposeEditorialImprovement = (articleId, recommendationKey) =>
  requestEditorialEngine("proposeImprovement", {
    article_id: articleId,
    recommendation_key: recommendationKey,
  });

export const applyEditorialImprovement = (proposalId) =>
  requestEditorialEngine("applyImprovement", { proposal_id: proposalId });

export const rejectEditorialImprovement = (proposalId) =>
  requestEditorialEngine("rejectImprovement", { proposal_id: proposalId });

export const recordArticleRevision = (articleId, changeSource, changeSummary) =>
  requestEditorialEngine("recordRevision", {
    article_id: articleId,
    change_source: changeSource,
    change_summary: changeSummary,
  });

export const recordBusinessBrainUpdate = (sectionKey, summary) =>
  requestEditorialEngine("recordBusinessBrainUpdate", {
    section_key: sectionKey,
    summary,
  });

export const saveWebsiteIndexEntry = (entry) =>
  requestEditorialEngine("saveWebsiteIndexEntry", { entry });

export const refreshEditorialInternalLinks = (articleId) =>
  requestEditorialEngine("refreshInternalLinks", { article_id: articleId });

async function validateInternalLinkAnchor(suggestionId, anchorText) {
  const response = await fetch("/api/marketing-internal-link-validate", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ suggestion_id: suggestionId, anchor_text: anchorText }),
  });
  return parseMarketingJsonResponse(response, "The anchor text could not be checked against the article.");
}

export const decideEditorialInternalLink = async (
  suggestionId,
  decision,
  anchorText,
  reason = ""
) => {
  if (decision === "accept") await validateInternalLinkAnchor(suggestionId, anchorText);
  return requestEditorialEngine("decideInternalLink", {
    suggestion_id: suggestionId,
    decision,
    anchor_text: anchorText,
    reason,
  });
};

function articleMarkdownFromPage() {
  if (typeof document === "undefined") return "";
  const labels = [...document.querySelectorAll("label.field")];
  const bodyField = labels.find((label) => /article body/i.test(label.querySelector(".field__label")?.textContent || ""));
  return bodyField?.querySelector("textarea")?.value || "";
}

function renderAnchorStatus(card, input, acceptButton) {
  const markdown = articleMarkdownFromPage();
  if (!markdown || !input) return;
  const validation = findInternalLinkAnchorMatches(markdown, input.value);
  let status = card.querySelector("[data-anchor-match-status]");
  if (!status) {
    status = document.createElement("div");
    status.dataset.anchorMatchStatus = "true";
    status.style.marginTop = "8px";
    input.closest("label")?.insertAdjacentElement("afterend", status);
  }

  if (validation.found) {
    status.className = "notice notice--success";
    status.innerHTML = `<strong>Found in article</strong><div>${validation.match_count === 1 ? "Found once" : `Found ${validation.match_count} times`} in the current saved article.</div>${validation.excerpts[0]?.excerpt ? `<small>…${validation.excerpts[0].excerpt}…</small>` : ""}`;
    if (acceptButton) {
      acceptButton.disabled = false;
      acceptButton.title = validation.match_count > 1 ? "This wording appears more than once. The first safe occurrence will be linked." : "This wording is present in the article and can be linked.";
      acceptButton.textContent = "Apply link";
    }
  } else {
    status.className = "notice notice--error";
    status.innerHTML = "<strong>Not found in article</strong><div>Use wording that already appears in the current article body. The link cannot be applied until a match is found.</div>";
    if (acceptButton) {
      acceptButton.disabled = true;
      acceptButton.title = "Anchor text is not present in the current article.";
      acceptButton.textContent = "Apply link";
    }
  }
}

function enhanceInternalLinkCards() {
  if (typeof document === "undefined") return;
  const heading = [...document.querySelectorAll("h3")].find((item) => item.textContent?.trim() === "Contextual Internal Links");
  const panel = heading?.closest(".panel");
  if (!panel) return;

  const cards = [...panel.querySelectorAll(".notice")];
  for (const card of cards) {
    const input = card.querySelector("label.field input.field__input");
    const acceptButton = [...card.querySelectorAll("button")].find((button) => /^(accept|apply link)$/i.test(button.textContent?.trim() || ""));
    if (!input || !acceptButton) continue;

    const label = input.closest("label")?.querySelector(".field__label");
    if (label) label.textContent = "Existing words in the article to link";
    renderAnchorStatus(card, input, acceptButton);

    if (!input.dataset.anchorValidationBound) {
      input.dataset.anchorValidationBound = "true";
      input.addEventListener("input", () => renderAnchorStatus(card, input, acceptButton));
    }
  }
}

if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  const start = () => {
    enhanceInternalLinkCards();
    const observer = new MutationObserver(() => enhanceInternalLinkCards());
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
