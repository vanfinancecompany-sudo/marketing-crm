/*
 * UI-only preparation for the future Stock Control Centre.
 *
 * This intentionally does not call APIs, persist selections or alter existing
 * Vansco Stock Watch behaviour. It decorates the current page so the future
 * DealerKit workflow has a stable visual shell before the source integration
 * is connected.
 */

const PAGE_CLASS = "stock-control-centre-page";
const WORKFLOW_ATTRIBUTE = "data-stock-control-workflow";
const EYEBROW_ATTRIBUTE = "data-stock-control-eyebrow";
let scanQueued = false;

function createWorkflowStep(step, title, isLive = false) {
  const node = document.createElement("div");
  node.className = `stock-control-workflow__step${isLive ? " is-live" : ""}`;
  node.dataset.step = step;

  const strong = document.createElement("strong");
  strong.textContent = title;
  node.appendChild(strong);
  return node;
}

function createWorkflowRail() {
  const rail = document.createElement("section");
  rail.className = "stock-control-workflow";
  rail.setAttribute(WORKFLOW_ATTRIBUTE, "true");
  rail.setAttribute("aria-label", "Future semi-automatic stock publishing workflow");

  const top = document.createElement("div");
  top.className = "stock-control-workflow__top";

  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = "Semi-auto advertising workflow";
  const description = document.createElement("span");
  description.textContent = "Interface prepared now; DealerKit image review, category controls and full Wix publishing connect after API access.";
  copy.append(heading, description);

  const badge = document.createElement("span");
  badge.className = "stock-control-workflow__badge";
  badge.textContent = "UI prep only";

  top.append(copy, badge);

  const steps = document.createElement("div");
  steps.className = "stock-control-workflow__steps";
  steps.append(
    createWorkflowStep("01 · LIVE", "Dealer stock", true),
    createWorkflowStep("02 · LIVE", "Review changes", true),
    createWorkflowStep("03 · API", "Review images"),
    createWorkflowStep("04 · API", "VFC / Rent2Buy"),
    createWorkflowStep("05 · API", "Publish to Wix")
  );

  rail.append(top, steps);
  return rail;
}

function updateHeader(panel) {
  const header = panel.querySelector(":scope > .panel__header");
  if (!header) return;

  const copy = header.firstElementChild;
  if (!copy) return;

  if (!copy.querySelector(`[${EYEBROW_ATTRIBUTE}]`)) {
    const eyebrow = document.createElement("span");
    eyebrow.className = "stock-control-eyebrow";
    eyebrow.setAttribute(EYEBROW_ATTRIBUTE, "true");
    eyebrow.textContent = "Stock operations · DealerKit ready";
    copy.prepend(eyebrow);
  }

  const heading = copy.querySelector("h3");
  if (heading && heading.textContent.trim() === "Vansco Stock Watch") {
    heading.textContent = "Stock Control Centre";
  }

  const intro = copy.querySelector("p");
  if (intro && !intro.dataset.stockControlCopy) {
    intro.textContent = "Vansco Stock Watch remains the live engine today. This interface is being prepared for semi-automatic DealerKit review and Wix publishing without changing the current backend.";
    intro.dataset.stockControlCopy = "true";
  }

  header.querySelectorAll("button").forEach((button) => {
    const text = button.textContent.trim();
    if (text === "Refresh Vansco cache") button.textContent = "Refresh dealer stock";
    if (text === "Refreshing cache...") button.textContent = "Refreshing dealer stock...";
    if (text === "Reload comparison") button.textContent = "Refresh comparison";
  });
}

function ensureWorkflowRail(panel) {
  if (panel.querySelector(`[${WORKFLOW_ATTRIBUTE}]`)) return;

  const pipelineTabs = panel.querySelector(":scope > .segmented-control");
  const rail = createWorkflowRail();
  if (pipelineTabs) pipelineTabs.insertAdjacentElement("afterend", rail);
  else panel.querySelector(":scope > .panel__header")?.insertAdjacentElement("afterend", rail);
}

function decorateStockWatch() {
  const panel = document.querySelector(".vansco-watch-panel");
  if (!panel) return;

  const page = panel.closest(".page-stack");
  if (!page) return;

  page.classList.add(PAGE_CLASS);
  updateHeader(panel);
  ensureWorkflowRail(panel);
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    decorateStockWatch();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  } else {
    scheduleScan();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
