import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";
import {
  findInternalLinkAnchorMatches,
  suggestInternalLinkAnchor,
} from "../lib/internalLinkAnchorValidation.js";

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

function replaceStatusContent(status, validation, suggested = false) {
  status.replaceChildren();
  const heading = document.createElement("strong");
  const detail = document.createElement("div");
  heading.textContent = validation.found ? (suggested ? "Matching wording selected" : "Found in article") : "No usable wording found";
  detail.textContent = validation.found
    ? validation.match_count === 1
      ? "This wording appears once in the current article and is ready to link."
      : `This wording appears ${validation.match_count} times. The first safe occurrence will be linked.`
    : "This destination is relevant, but the current article does not contain suitable wording to link. Do not apply this suggestion unless the article is edited first.";
  status.append(heading, detail);

  const excerpt = validation.excerpts?.[0]?.excerpt;
  if (validation.found && excerpt) {
    const preview = document.createElement("small");
    preview.textContent = `“…${excerpt}…”`;
    preview.style.display = "block";
    preview.style.marginTop = "6px";
    status.append(preview);
  }
}

function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function cardSuggestionText(card) {
  return [...card.querySelectorAll("p, small")]
    .map((item) => item.textContent || "")
    .join(" · ");
}

function cardDestinationTitle(card) {
  return card.querySelector(".panel__header strong")?.textContent?.trim() || "";
}

function renderAnchorStatus(card, input, acceptButton) {
  const markdown = articleMarkdownFromPage();
  if (!markdown || !input) return;

  let validation = findInternalLinkAnchorMatches(markdown, input.value);
  let suggested = false;
  if (!validation.found && !input.dataset.anchorUserEdited && !input.dataset.anchorAutoSuggested) {
    const recommendation = suggestInternalLinkAnchor(
      markdown,
      cardSuggestionText(card),
      cardDestinationTitle(card)
    );
    if (recommendation.found && recommendation.anchor_text) {
      input.dataset.anchorAutoSuggested = "true";
      setReactInputValue(input, recommendation.anchor_text);
      validation = recommendation.validation;
      suggested = true;
    }
  }

  const fingerprint = `${validation.reason}|${validation.match_count}|${validation.excerpts?.[0]?.index ?? -1}|${input.value}|${suggested}`;
  let status = card.querySelector("[data-anchor-match-status]");
  if (!status) {
    status = document.createElement("div");
    status.dataset.anchorMatchStatus = "true";
    status.style.marginTop = "8px";
    input.closest("label")?.insertAdjacentElement("afterend", status);
  }

  if (status.dataset.anchorFingerprint !== fingerprint) {
    status.dataset.anchorFingerprint = fingerprint;
    status.className = validation.found ? "notice notice--success" : "notice notice--error";
    replaceStatusContent(status, validation, suggested);
  }

  if (acceptButton) {
    acceptButton.textContent = "Apply link";
    acceptButton.disabled = !validation.found;
    acceptButton.title = validation.found
      ? validation.match_count > 1
        ? "This wording appears more than once. The first safe occurrence will be linked."
        : "This wording is present in the article and can be linked."
      : "No suitable anchor wording is present in the current article.";
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
    if (label && label.textContent !== "Existing words in the article to link") {
      label.textContent = "Existing words in the article to link";
    }
    renderAnchorStatus(card, input, acceptButton);

    if (!input.dataset.anchorValidationBound) {
      input.dataset.anchorValidationBound = "true";
      input.addEventListener("input", () => {
        if (input.dataset.anchorAutoSuggested !== "true") input.dataset.anchorUserEdited = "true";
        delete input.dataset.anchorAutoSuggested;
        renderAnchorStatus(card, input, acceptButton);
      });
    }
  }
}

if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  const start = () => {
    let scheduled = false;
    const scheduleEnhancement = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        enhanceInternalLinkCards();
      });
    };
    scheduleEnhancement();
    const observer = new MutationObserver(scheduleEnhancement);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
