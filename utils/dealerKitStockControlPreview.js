import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const PANEL_ATTRIBUTE = "data-dealerkit-source-preview";
let scanQueued = false;

function stat(label, value) {
  const node = document.createElement("div");
  node.className = "dealerkit-source-preview__stat";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = String(value ?? "–");
  node.append(labelNode, valueNode);
  return node;
}

function formatCheckedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderSummary(panel, payload) {
  const summary = payload?.summary || {};
  const grid = panel.querySelector("[data-dealerkit-preview-grid]");
  const message = panel.querySelector("[data-dealerkit-preview-message]");
  const badge = panel.querySelector("[data-dealerkit-preview-badge]");
  if (!grid || !message || !badge) return;

  grid.replaceChildren(
    stat("API reported", summary.apiReportedTotal),
    stat("Usable records", summary.vehicleCount),
    stat("Coverage", `${summary.coveragePercent ?? 0}%`),
    stat("LCVs", summary.typeCounts?.LCV ?? 0),
    stat("Cars", summary.typeCounts?.Car ?? 0),
    stat("In stock", summary.statusCounts?.["In Stock"] ?? 0),
    stat("Reserved", summary.statusCounts?.Reserved ?? 0),
    stat("5+ images", summary.images?.fivePlus ?? 0),
  );
  grid.hidden = false;

  const issues = summary.issues || {};
  const issueCount = Number(issues.failedPositionCount || 0)
    + Number(issues.invalidRecordCount || 0)
    + Number(issues.duplicateRegistrationCount || 0)
    + (issues.stableReportedTotal === false ? 1 : 0);
  const checkedText = formatCheckedAt(summary.checkedAt);

  if (summary.complete) {
    badge.textContent = "API CHECK PASSED";
    badge.classList.remove("is-warning");
    badge.classList.add("is-good");
    message.textContent = `DealerKit returned a complete readable snapshot${checkedText ? ` at ${checkedText}` : ""}. It remains comparison-only until the wider cutover checks are complete.`;
    return;
  }

  badge.textContent = "SOURCE INCOMPLETE";
  badge.classList.remove("is-good");
  badge.classList.add("is-warning");
  message.textContent = `DealerKit is connected, but this snapshot is not safe for cutover${checkedText ? ` (${checkedText})` : ""}. ${issueCount} source issue${issueCount === 1 ? "" : "s"} detected. Existing Vansco/Dragon stock remains authoritative.`;
}

function createPanel() {
  const panel = document.createElement("section");
  panel.className = "dealerkit-source-preview";
  panel.setAttribute(PANEL_ATTRIBUTE, "true");

  const top = document.createElement("div");
  top.className = "dealerkit-source-preview__top";

  const copy = document.createElement("div");
  copy.className = "dealerkit-source-preview__copy";
  const eyebrow = document.createElement("span");
  eyebrow.className = "dealerkit-source-preview__eyebrow";
  eyebrow.textContent = "DEALERKIT · READ-ONLY";
  const heading = document.createElement("strong");
  heading.textContent = "New stock source connection";
  const message = document.createElement("span");
  message.setAttribute("data-dealerkit-preview-message", "true");
  message.textContent = "DealerKit is connected alongside the existing stock feed. Run a manual source check to inspect live coverage without changing any CRM or Wix stock.";
  copy.append(eyebrow, heading, message);

  const actions = document.createElement("div");
  actions.className = "dealerkit-source-preview__actions";
  const badge = document.createElement("span");
  badge.className = "dealerkit-source-preview__badge";
  badge.setAttribute("data-dealerkit-preview-badge", "true");
  badge.textContent = "NOT AUTHORITATIVE";
  const button = document.createElement("button");
  button.className = "button button--ghost dealerkit-source-preview__button";
  button.type = "button";
  button.textContent = "Check DealerKit source";
  actions.append(badge, button);
  top.append(copy, actions);

  const grid = document.createElement("div");
  grid.className = "dealerkit-source-preview__grid";
  grid.setAttribute("data-dealerkit-preview-grid", "true");
  grid.hidden = true;

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Checking DealerKit...";
    message.textContent = "Reading the live DealerKit stock feed. Their migration is still settling, so this check can take a little while.";
    badge.textContent = "CHECKING";
    badge.classList.remove("is-good", "is-warning");

    try {
      const response = await fetch("/api/dealerkit-stock-preview", {
        method: "GET",
        headers: buildMarketingAccessHeaders({ accept: "application/json" }),
        cache: "no-store",
      });
      const payload = await parseMarketingJsonResponse(response, "Could not check DealerKit stock.");
      renderSummary(panel, payload);
    } catch (error) {
      badge.textContent = "CHECK FAILED";
      badge.classList.remove("is-good");
      badge.classList.add("is-warning");
      message.textContent = error?.message || "Could not check DealerKit stock. Existing stock data is unchanged.";
    } finally {
      button.disabled = false;
      button.textContent = "Check DealerKit source";
    }
  });

  panel.append(top, grid);
  return panel;
}

function installPanel() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  const host = document.querySelector(".vansco-watch-panel");
  if (!host) return;

  const workflow = host.querySelector("[data-stock-control-workflow]");
  const header = host.querySelector(":scope > .panel__header");
  const anchor = workflow || header;
  if (!anchor) return;

  let panel = host.querySelector(`[${PANEL_ATTRIBUTE}]`);
  if (!panel) panel = createPanel();
  if (panel.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", panel);
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    installPanel();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();

  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
