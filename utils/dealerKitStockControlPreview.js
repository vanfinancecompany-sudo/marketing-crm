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

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return `£${number.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function reasonLabel(reason) {
  const labels = {
    price_difference: "Price difference",
    source_status_changed: "Supplier status",
    missing_from_finance: "Not in Finance stock",
    local_not_on_dealerkit: "Local only",
    local_not_seen_unverified: "Local not seen · source incomplete",
  };
  return labels[reason] || reason || "Review";
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

function createReviewRow(record) {
  const row = document.createElement("article");
  row.className = "dealerkit-comparison__row";

  if (record.imageUrl) {
    const image = document.createElement("img");
    image.src = record.imageUrl;
    image.alt = record.registration || record.title || "DealerKit vehicle";
    image.loading = "lazy";
    row.appendChild(image);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "dealerkit-comparison__image-placeholder";
    placeholder.textContent = "No image";
    row.appendChild(placeholder);
  }

  const copy = document.createElement("div");
  copy.className = "dealerkit-comparison__row-copy";
  const top = document.createElement("div");
  top.className = "dealerkit-comparison__row-top";
  const registration = document.createElement("strong");
  registration.textContent = record.registration || "No registration";
  const reason = document.createElement("span");
  reason.className = `dealerkit-comparison__reason dealerkit-comparison__reason--${record.reason || "review"}`;
  reason.textContent = reasonLabel(record.reason);
  top.append(registration, reason);

  const title = document.createElement("span");
  title.className = "dealerkit-comparison__title";
  title.textContent = record.title || "DealerKit vehicle";

  const meta = document.createElement("span");
  meta.className = "dealerkit-comparison__meta";
  const bits = [
    record.pipeline === "rent2buy" ? "Rent2Buy" : "Finance",
    record.sourceStatus ? `DealerKit: ${record.sourceStatus}` : "",
    Number.isFinite(Number(record.retailPrice)) ? `Source ${formatPrice(record.retailPrice)}` : "",
    Number.isFinite(Number(record.localPrice)) ? `Our price ${formatPrice(record.localPrice)}` : "",
    Number.isFinite(Number(record.imageCount)) ? `${record.imageCount} source images` : "",
  ].filter(Boolean);
  meta.textContent = bits.join(" · ");

  copy.append(top, title, meta);
  row.appendChild(copy);

  const links = document.createElement("div");
  links.className = "dealerkit-comparison__links";
  if (record.localUrl) {
    const local = document.createElement("a");
    local.href = record.localUrl;
    local.target = "_blank";
    local.rel = "noreferrer";
    local.textContent = "Our advert";
    links.appendChild(local);
  }
  if (record.sourceUrl) {
    const source = document.createElement("a");
    source.href = record.sourceUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "DealerKit vehicle";
    links.appendChild(source);
  }
  if (links.childElementCount) row.appendChild(links);
  return row;
}

function renderComparison(panel, payload) {
  const section = panel.querySelector("[data-dealerkit-comparison]");
  const summaryGrid = panel.querySelector("[data-dealerkit-comparison-grid]");
  const records = panel.querySelector("[data-dealerkit-comparison-records]");
  const note = panel.querySelector("[data-dealerkit-comparison-note]");
  if (!section || !summaryGrid || !records || !note) return;

  const finance = payload?.finance || {};
  const rent = payload?.rent2buy || {};
  summaryGrid.replaceChildren(
    stat("Finance matches", finance.exactMatches ?? 0),
    stat("Not in Finance", finance.missingFromFinance ?? 0),
    stat("Price differences", finance.priceDifferences ?? 0),
    stat("Finance status", finance.sourceStatusWarnings ?? 0),
    stat("Rent2Buy matches", rent.exactMatches ?? 0),
    stat("Rent2Buy status", rent.sourceStatusWarnings ?? 0),
    stat("Local not seen", (finance.localNotSeen ?? 0) + (rent.localNotSeen ?? 0)),
    stat("5+ image matches", finance.sourceFivePlusImageMatches ?? 0),
  );

  records.replaceChildren(...(payload.reviewRecords || []).map(createReviewRow));
  note.textContent = payload.source?.complete
    ? `${payload.reviewRecordCount || 0} review item${payload.reviewRecordCount === 1 ? "" : "s"}. DealerKit is still comparison-only until cutover is explicitly approved.`
    : `${payload.reviewRecordCount || 0} review item${payload.reviewRecordCount === 1 ? "" : "s"}. DealerKit source is incomplete, so local vehicles not seen in the API are verification items only and must not be treated as sold or removed.`;
  if (payload.truncated) note.textContent += " Showing the first 80 highest-priority items.";
  section.hidden = false;
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
  message.textContent = "DealerKit is connected alongside the existing stock feed. Check source health or compare its readable vehicle records with your current Finance and Rent2Buy stock. Nothing is written back.";
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
  const compareButton = document.createElement("button");
  compareButton.className = "button button--ghost dealerkit-source-preview__button";
  compareButton.type = "button";
  compareButton.textContent = "Compare with my stock";
  actions.append(badge, button, compareButton);
  top.append(copy, actions);

  const grid = document.createElement("div");
  grid.className = "dealerkit-source-preview__grid";
  grid.setAttribute("data-dealerkit-preview-grid", "true");
  grid.hidden = true;

  const comparison = document.createElement("section");
  comparison.className = "dealerkit-comparison";
  comparison.setAttribute("data-dealerkit-comparison", "true");
  comparison.hidden = true;
  const comparisonTop = document.createElement("div");
  comparisonTop.className = "dealerkit-comparison__top";
  const comparisonHeading = document.createElement("strong");
  comparisonHeading.textContent = "DealerKit record comparison";
  const comparisonNote = document.createElement("span");
  comparisonNote.setAttribute("data-dealerkit-comparison-note", "true");
  comparisonTop.append(comparisonHeading, comparisonNote);
  const comparisonGrid = document.createElement("div");
  comparisonGrid.className = "dealerkit-source-preview__grid dealerkit-comparison__grid";
  comparisonGrid.setAttribute("data-dealerkit-comparison-grid", "true");
  const comparisonRecords = document.createElement("div");
  comparisonRecords.className = "dealerkit-comparison__records";
  comparisonRecords.setAttribute("data-dealerkit-comparison-records", "true");
  comparison.append(comparisonTop, comparisonGrid, comparisonRecords);

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

  compareButton.addEventListener("click", async () => {
    compareButton.disabled = true;
    compareButton.textContent = "Comparing records...";
    try {
      const response = await fetch("/api/dealerkit-stock-comparison", {
        method: "GET",
        headers: buildMarketingAccessHeaders({ accept: "application/json" }),
        cache: "no-store",
      });
      const payload = await parseMarketingJsonResponse(response, "Could not compare DealerKit stock.");
      renderComparison(panel, payload);
    } catch (error) {
      comparison.hidden = false;
      comparisonGrid.replaceChildren();
      comparisonRecords.replaceChildren();
      comparisonNote.textContent = error?.message || "Could not compare DealerKit with current stock. No stock data was changed.";
    } finally {
      compareButton.disabled = false;
      compareButton.textContent = "Compare with my stock";
    }
  });

  panel.append(top, grid, comparison);
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
