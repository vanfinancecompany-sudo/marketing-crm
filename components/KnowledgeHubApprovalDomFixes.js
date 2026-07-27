export function installKnowledgeHubApprovalDomFixes() {
  if (typeof document === "undefined") return;
  const apply = () => {
    [...document.querySelectorAll("strong")].forEach((node) => {
      if (node.textContent?.trim() === "★★★★★ Ready") node.textContent = "★★★★★ Ready for approval";
    });
    const editor = [...document.querySelectorAll(".panel")].find((panel) =>
      panel.querySelector(".eyebrow")?.textContent?.trim() === "Article Editor"
    );
    const legacyApprove = [...(editor?.querySelectorAll("button") || [])].find((button) =>
      button.textContent?.trim() === "Approve"
    );
    if (legacyApprove) {
      legacyApprove.style.display = "none";
      legacyApprove.setAttribute("aria-hidden", "true");
      legacyApprove.tabIndex = -1;
    }
  };
  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}
