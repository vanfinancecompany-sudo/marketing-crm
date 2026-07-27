import {
  KNOWLEDGE_CORRECTION_STATE_EVENT,
  readKnowledgeCorrectionState,
} from "../lib/knowledgeCorrectionState.js";

const BANNER_ID = "knowledge-correction-success-banner";
let installed = false;

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-GB");
}

function findEditorPanel() {
  return [...document.querySelectorAll(".panel")].find(
    (panel) => panel.querySelector(".eyebrow")?.textContent?.trim() === "Article Editor"
  );
}

function removeBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

function showSuccessBanner(state, { focus = true } = {}) {
  if (!state?.correction_save_verified || state.status !== "saved") {
    removeBanner();
    return;
  }
  const editor = findEditorPanel();
  if (!editor) return;

  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.className = "notice notice--success";
    banner.tabIndex = -1;
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.style.position = "sticky";
    banner.style.top = "8px";
    banner.style.zIndex = "20";
    banner.style.marginBottom = "16px";
    editor.insertAdjacentElement("afterend", banner);
  }

  banner.dataset.articleId = state.article_id || "";
  banner.dataset.savedAt = state.saved_at || "";
  banner.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "Corrections accepted and saved successfully.";
  banner.appendChild(title);

  const details = [
    ["Article status", "Draft"],
    ["Saved", formatDate(state.saved_at)],
    ["Revision", "AI safety correction"],
    ["Saved content verified", "Yes"],
  ];
  details.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.textContent = `${label}: ${value}`;
    banner.appendChild(row);
  });

  const nextStep = document.createElement("div");
  nextStep.textContent = state.analysis_stale
    ? "Corrections saved. Reanalyse the article before approval and Wix export."
    : "Corrections saved and verified. The article is ready for approval and Wix draft creation.";
  banner.appendChild(nextStep);

  if (focus) {
    requestAnimationFrame(() => {
      banner.scrollIntoView({ behavior: "smooth", block: "start" });
      banner.focus({ preventScroll: true });
    });
  }
}

export function installKnowledgeHubApprovalDomFixes() {
  if (typeof document === "undefined" || installed) return;
  installed = true;

  const apply = () => {
    [...document.querySelectorAll("strong")].forEach((node) => {
      if (node.textContent?.trim() === "★★★★★ Ready") node.textContent = "★★★★★ Ready for approval";
    });
    const editor = findEditorPanel();
    const legacyApprove = [...(editor?.querySelectorAll("button") || [])].find(
      (button) => button.textContent?.trim() === "Approve"
    );
    if (legacyApprove) {
      legacyApprove.style.display = "none";
      legacyApprove.setAttribute("aria-hidden", "true");
      legacyApprove.tabIndex = -1;
    }

    const state = readKnowledgeCorrectionState();
    if (state?.correction_save_verified && !document.getElementById(BANNER_ID)) {
      showSuccessBanner(state, { focus: false });
    }
  };

  window.addEventListener(KNOWLEDGE_CORRECTION_STATE_EVENT, (event) => {
    showSuccessBanner(event.detail, { focus: event.detail?.correction_save_verified === true });
  });

  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}
