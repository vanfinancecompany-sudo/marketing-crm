import { buildVisibilitySummary } from "../lib/aiVisibility.js";
import { buildMarketingAccessHeaders } from "../services/marketingAccess.js";

const ROOT_ATTR = "data-ai-visibility-pending-state";

async function loadVisibilitySnapshot() {
  const response = await fetch("/api/marketing-ai-visibility", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "load" }),
  });
  if (!response.ok) throw new Error("AI Visibility pending state could not be loaded.");
  const payload = await response.json();
  return buildVisibilitySummary({
    articles: payload.articles || [],
    results: payload.results || [],
    prompts: payload.prompts || [],
    attentionDays: payload.settings?.attention_days || 30,
  });
}

function text(element) {
  return String(element?.textContent || "").trim();
}

function articleByUrl(summary, href) {
  return summary.articles.find((item) => item.article.live_wix_url === href);
}

function setPendingBadge(element) {
  if (!element) return;
  element.textContent = "Pending";
  element.classList.remove("is-negative", "is-positive");
  element.classList.add("is-neutral");
  element.dataset.googleCustomerStatus = "pending";
}

function ensurePendingFilter() {
  document.querySelectorAll("select.field__input").forEach((select) => {
    const options = [...select.options].map((option) => option.value);
    if (!options.includes("all") || !options.includes("indexed") || !options.includes("not_checked")) return;
    if (options.includes("pending")) return;
    const option = document.createElement("option");
    option.value = "pending";
    option.textContent = "Google pending";
    const indexed = [...select.options].find((entry) => entry.value === "indexed");
    indexed?.after(option);
  });
}

function ensurePendingSummaryCard(summary) {
  const stats = [...document.querySelectorAll("section.stats-grid")].find((section) =>
    [...section.querySelectorAll(".stat-card__label")].some((label) => text(label) === "Published pages"),
  );
  if (!stats) return;
  let card = stats.querySelector(`[${ROOT_ATTR}]`);
  if (!card) {
    card = document.createElement("button");
    card.type = "button";
    card.className = "stat-card ai-visibility-summary-card";
    card.setAttribute(ROOT_ATTR, "true");
    card.innerHTML = '<span class="stat-card__label">Google pending</span><strong class="stat-card__value">0</strong>';
    card.addEventListener("click", () => {
      const select = [...document.querySelectorAll("select.field__input")].find((candidate) =>
        [...candidate.options].some((option) => option.value === "pending"),
      );
      if (!select) return;
      select.value = "pending";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const details = document.querySelector("[data-ai-visibility-article-results]");
      if (details) details.open = true;
    });
    stats.append(card);
  }
  const value = card.querySelector(".stat-card__value");
  if (value) value.textContent = String(summary.google_pending || 0);
}

function patchArticleTable(summary) {
  document.querySelectorAll("table.knowledge-table tbody tr").forEach((row) => {
    const link = row.querySelector('a[href*="/knowledge-hub/"]');
    if (!link) return;
    const item = articleByUrl(summary, link.href);
    if (item?.google_indexing_status !== "pending") return;
    setPendingBadge(row.cells?.[2]?.querySelector(".visibility-status"));
  });
}

function patchArticleDetail(summary) {
  const heroUrl = [...document.querySelectorAll("section.hero-panel p")]
    .map((element) => text(element))
    .find((value) => value.includes("/knowledge-hub/"));
  if (!heroUrl) return;
  const item = articleByUrl(summary, heroUrl);
  if (!item || item.google_indexing_status !== "pending") return;

  document.querySelectorAll(".stat-card").forEach((card) => {
    if (text(card.querySelector(".stat-card__label")) === "Google") {
      const value = card.querySelector(".stat-card__value");
      if (value) value.textContent = "Pending";
    }
  });

  document.querySelectorAll("article.panel--nested").forEach((card) => {
    if (!text(card).startsWith("Google Search Console")) return;
    setPendingBadge(card.querySelector(".visibility-status"));
    const evidence = card.querySelector("p");
    if (evidence && !text(evidence)) {
      evidence.textContent = "Google completed successfully but has not returned an indexing verdict yet.";
    }
  });

  const recommendation = [...document.querySelectorAll(".notice")].find((notice) =>
    text(notice).startsWith("Recommended action:"),
  );
  if (recommendation) {
    recommendation.innerHTML = "<strong>Recommended action:</strong> Google completed the check but has not returned an indexing verdict yet. Check again later.";
  }

  document.querySelectorAll("table.knowledge-table tbody tr").forEach((row) => {
    if (text(row.cells?.[1]) !== "Google Search Console") return;
    const evidence = text(row.cells?.[4]);
    if (!/not returned an indexing verdict|no verified indexing verdict|no reliable indexing verdict/i.test(evidence)) return;
    setPendingBadge(row.cells?.[2]?.querySelector(".visibility-status"));
  });
}

function patchCurrentProviderCards(summary) {
  const pendingUrls = new Set(
    summary.articles
      .filter((item) => item.google_indexing_status === "pending")
      .map((item) => item.article.live_wix_url),
  );
  if (!pendingUrls.size) return;
  document.querySelectorAll("article.panel--nested").forEach((card) => {
    if (!text(card).startsWith("Google Search Console")) return;
    const badge = card.querySelector(".visibility-status");
    if (badge && !text(badge)) setPendingBadge(badge);
  });
}

function applyPendingState(summary) {
  ensurePendingFilter();
  ensurePendingSummaryCard(summary);
  patchArticleTable(summary);
  patchArticleDetail(summary);
  patchCurrentProviderCards(summary);
}

export function installAiVisibilityPendingState() {
  if (window.__aiVisibilityPendingStateInstalled) return;
  window.__aiVisibilityPendingStateInstalled = true;
  let summary = null;
  let queued = false;

  const refresh = async () => {
    try {
      summary = await loadVisibilitySnapshot();
      applyPendingState(summary);
    } catch (error) {
      console.warn("AI VISIBILITY PENDING STATE ERROR", error);
    }
  };

  const queueApply = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (summary) applyPendingState(summary);
    });
  };

  const observer = new MutationObserver(queueApply);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("ai-visibility-live-data-updated", refresh);
  refresh();
}
