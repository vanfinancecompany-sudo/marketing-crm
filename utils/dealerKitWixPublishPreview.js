import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const PANEL_ATTRIBUTE = "data-dealerkit-wix-publish-preview";
let scanQueued = false;

function clean(value) {
  return String(value ?? "").trim();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return `£${number.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function fieldText(fields = {}) {
  const values = Object.entries(fields || {}).filter(([, value]) => clean(value));
  return values.length ? values.map(([key, value]) => `${key}: ${value}`).join(" · ") : "–";
}

function renderResult(panel, payload) {
  const preview = payload?.preview || {};
  const result = panel.querySelector("[data-dealerkit-wix-preview-result]");
  const status = panel.querySelector("[data-dealerkit-wix-preview-status]");
  if (!result || !status) return;
  result.replaceChildren();

  status.textContent = preview.canPublishLater ? "PREVIEW CLEAN" : "PUBLISH BLOCKED";
  status.classList.toggle("is-good", Boolean(preview.canPublishLater));
  status.classList.toggle("is-warning", !preview.canPublishLater);

  const summary = element("div", "dealerkit-wix-preview__summary");
  summary.append(
    element("div", "", `Registration: ${preview.registration || "–"}`),
    element("div", "", `DealerKit retail: ${formatPrice(preview.retailPrice)}`),
    element("div", "", `VFC monthly: ${formatPrice(preview.monthlyPrice)} p/m`),
    element("div", "", `Reviewed images: ${preview.images?.count ?? 0}`),
  );
  result.appendChild(summary);

  if (preview.images?.primaryImageUrl) {
    const primary = element("div", "dealerkit-wix-preview__primary");
    const image = document.createElement("img");
    image.src = preview.images.primaryImageUrl;
    image.alt = `${preview.registration || "Vehicle"} reviewed primary image`;
    image.loading = "lazy";
    primary.append(image, element("span", "", `Primary DealerKit image · ${preview.images.primaryImageId || "selected"}`));
    result.appendChild(primary);
  }

  const targets = element("div", "dealerkit-wix-preview__targets");
  for (const target of preview.targets || []) {
    const row = element("article", `dealerkit-wix-preview__target is-${target.status || "unknown"}`);
    const top = element("div", "dealerkit-wix-preview__target-top");
    top.append(
      element("strong", "", target.collectionLabel || target.collectionId),
      element("span", "", `${target.mandatory ? "MANDATORY · " : ""}${String(target.status || "unknown").toUpperCase()}`),
    );
    row.appendChild(top);
    if (target.status === "matched") {
      row.append(
        element("div", "dealerkit-wix-preview__field-line", `Current · ${fieldText(target.current)}`),
        element("div", "dealerkit-wix-preview__field-line", `Proposed · ${fieldText(target.proposed)}`),
      );
    } else if (target.status === "missing") {
      row.appendChild(element("div", "dealerkit-wix-preview__field-line", "No existing Wix row. Creation remains locked until the full CMS create schema is verified."));
    } else if (target.status === "duplicate") {
      row.appendChild(element("div", "dealerkit-wix-preview__field-line", "Duplicate Wix rows found. Publishing remains blocked."));
    }
    targets.appendChild(row);
  }
  result.appendChild(targets);

  if (preview.blockers?.length) {
    const blockers = element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--blockers");
    blockers.appendChild(element("strong", "", `Blockers (${preview.blockers.length})`));
    for (const item of preview.blockers) blockers.appendChild(element("div", "", item.message || item.code));
    result.appendChild(blockers);
  }

  if (preview.warnings?.length) {
    const warnings = element("div", "dealerkit-wix-preview__messages dealerkit-wix-preview__messages--warnings");
    warnings.appendChild(element("strong", "", `Warnings (${preview.warnings.length})`));
    for (const item of preview.warnings) warnings.appendChild(element("div", "", item.message || item.code));
    result.appendChild(warnings);
  }

  const end = element(
    "div",
    `dealerkit-wix-preview__verdict ${preview.canPublishLater ? "is-good" : "is-warning"}`,
    preview.canPublishLater
      ? "This saved review is structurally ready for a future controlled Wix update. This preview still cannot write anything."
      : "Publishing remains locked. Resolve the blockers above, save the review again where required, then preview once more.",
  );
  result.appendChild(end);
  result.hidden = false;
}

function createPanel(registration) {
  const panel = element("section", "dealerkit-wix-preview");
  panel.setAttribute(PANEL_ATTRIBUTE, "true");
  panel.dataset.registration = registration;

  const top = element("div", "dealerkit-wix-preview__top");
  const copy = element("div", "dealerkit-wix-preview__copy");
  copy.append(
    element("span", "dealerkit-wix-preview__eyebrow", "WIX · CONTROLLED PUBLISHING"),
    element("strong", "", "Preview Wix publish"),
    element("p", "", "Reads the fresh DealerKit vehicle, your last saved review choices and every mapped Van Finance Wix collection. It does not create, update, delete or unpublish anything."),
  );

  const actions = element("div", "dealerkit-wix-preview__actions");
  const status = element("span", "dealerkit-wix-preview__status", "PREVIEW ONLY");
  status.setAttribute("data-dealerkit-wix-preview-status", "true");
  const button = element("button", "dealerkit-review__save", "Preview Wix publish");
  button.type = "button";
  actions.append(status, button);
  top.append(copy, actions);

  const result = element("div", "dealerkit-wix-preview__result");
  result.setAttribute("data-dealerkit-wix-preview-result", "true");
  result.hidden = true;
  panel.append(top, result);

  button.addEventListener("click", async () => {
    const currentRegistration = clean(panel.dataset.registration).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (!currentRegistration) return;
    button.disabled = true;
    button.textContent = "Building preview…";
    status.textContent = "READING DEALERKIT + WIX";
    status.classList.remove("is-good", "is-warning");
    result.hidden = false;
    result.replaceChildren(element("div", "dealerkit-wix-preview__loading", "Reading fresh DealerKit data, saved review state and Wix CMS rows…"));
    try {
      const response = await fetch(`/api/dealerkit-wix-publish-preview?registration=${encodeURIComponent(currentRegistration)}`, {
        method: "GET",
        headers: buildMarketingAccessHeaders({ accept: "application/json" }),
        cache: "no-store",
      });
      const payload = await parseMarketingJsonResponse(response, "Could not prepare Wix publish preview.");
      renderResult(panel, payload);
    } catch (error) {
      status.textContent = "PREVIEW FAILED";
      status.classList.add("is-warning");
      result.replaceChildren(element("div", "dealerkit-wix-preview__error", error?.message || "Could not prepare Wix publish preview. No Wix changes were attempted."));
    } finally {
      button.disabled = false;
      button.textContent = "Preview Wix publish";
    }
  });

  return panel;
}

function installPanel() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  const workspace = document.querySelector("[data-dealerkit-review-workspace]");
  if (!workspace || workspace.hidden) return;
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  const title = workspace.querySelector("[data-dealerkit-review-title]");
  if (!body || !title) return;
  const registration = clean(title.textContent).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!registration || registration.length < 5 || registration.length > 8) return;

  let panel = body.querySelector(`[${PANEL_ATTRIBUTE}]`);
  if (!panel) {
    panel = createPanel(registration);
    const decisions = body.querySelector(".dealerkit-review__decisions");
    if (decisions) decisions.insertAdjacentElement("afterend", panel);
    else body.appendChild(panel);
  } else {
    panel.dataset.registration = registration;
  }
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
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}
