import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const PANEL_ATTRIBUTE = "data-dealerkit-wix-publish-preview";
let scanQueued = false;

function clean(value) {
  return String(value ?? "").trim();
}

function normaliseRegistration(value) {
  return clean(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
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

function createPlanText(plan = {}) {
  const fields = plan.proposedFields || {};
  const keys = [
    "title",
    "titleText",
    "price",
    "priceVat",
    "salePrice",
    "mthPrice",
    "vat",
    "year",
    "mileage",
    "buttonText",
    "buttonName",
  ];
  const selected = Object.fromEntries(keys.filter((key) => clean(fields[key])).map((key) => [key, fields[key]]));
  return fieldText(selected);
}

function renderWriteGate(panel, result, preview) {
  const gate = element("section", "dealerkit-wix-preview__write-gate");
  gate.setAttribute("data-dealerkit-wix-write-gate", "true");

  const copy = element("div", "dealerkit-wix-preview__write-copy");
  copy.append(
    element("strong", "", "Controlled Wix update"),
    element("p", "", `This first live-write gate can update price and monthly fields on ${preview.writeTargets?.length ?? 0} existing Van Finance Wix row(s). It cannot create vehicles, add/remove categories, change images or touch Rent2Buy.`),
  );
  gate.appendChild(copy);

  const confirm = element("div", "dealerkit-wix-preview__confirm");
  const label = document.createElement("label");
  label.textContent = `Type ${preview.registration} to unlock this update`;
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = preview.registration;
  input.setAttribute("aria-label", `Type ${preview.registration} to confirm the Wix update`);
  const applyButton = element("button", "dealerkit-wix-preview__apply", "Apply reviewed Wix update");
  applyButton.type = "button";
  applyButton.disabled = true;
  label.appendChild(input);
  confirm.append(label, applyButton);
  gate.appendChild(confirm);

  input.addEventListener("input", () => {
    applyButton.disabled = normaliseRegistration(input.value) !== preview.registration;
  });

  applyButton.addEventListener("click", async () => {
    const typedRegistration = normaliseRegistration(input.value);
    if (typedRegistration !== preview.registration) return;
    const approved = window.confirm(
      `Update the existing Van Finance Wix price fields for ${preview.registration}?\n\nThis will NOT create/delete vehicles, change categories, change images or touch Rent2Buy.`,
    );
    if (!approved) return;

    applyButton.disabled = true;
    input.disabled = true;
    applyButton.textContent = "Applying guarded update…";
    const status = panel.querySelector("[data-dealerkit-wix-preview-status]");
    if (status) {
      status.textContent = "RECHECKING BEFORE WRITE";
      status.classList.remove("is-good", "is-warning");
    }

    try {
      const response = await fetch("/api/dealerkit-wix-publish", {
        method: "POST",
        headers: buildMarketingAccessHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          action: "apply_existing_vfc_update",
          registration: preview.registration,
          confirmRegistration: typedRegistration,
          confirmation: preview.confirmation,
        }),
      });
      const payload = await parseMarketingJsonResponse(response, "Controlled Wix update failed.");
      const success = element(
        "div",
        `dealerkit-wix-preview__write-result ${payload.verified ? "is-good" : "is-warning"}`,
        payload.message || `Updated ${payload.recordsUpdated ?? 0} existing Wix row(s).`,
      );
      success.setAttribute("data-dealerkit-wix-write-result", "true");
      gate.replaceWith(success);
      if (status) {
        status.textContent = payload.verified ? "WIX UPDATE VERIFIED" : "CHECK WIX RESULT";
        status.classList.toggle("is-good", Boolean(payload.verified));
        status.classList.toggle("is-warning", !payload.verified);
      }
    } catch (error) {
      const errorBox = element("div", "dealerkit-wix-preview__write-result is-warning", error?.message || "Controlled Wix update failed. Nothing further was changed.");
      errorBox.setAttribute("data-dealerkit-wix-write-result", "true");
      gate.appendChild(errorBox);
      input.disabled = false;
      applyButton.disabled = normaliseRegistration(input.value) !== preview.registration;
      applyButton.textContent = "Apply reviewed Wix update";
      if (status) {
        status.textContent = "UPDATE BLOCKED";
        status.classList.add("is-warning");
      }
    }
  });

  result.appendChild(gate);
}

function renderResult(panel, payload) {
  const preview = payload?.preview || {};
  const result = panel.querySelector("[data-dealerkit-wix-preview-result]");
  const status = panel.querySelector("[data-dealerkit-wix-preview-status]");
  if (!result || !status) return;
  result.replaceChildren();

  panel._dealerKitWixPreview = preview;
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
      const createPlan = target.createPlan || {};
      if (createPlan.schemaVerified) {
        row.append(
          element("div", "dealerkit-wix-preview__field-line", `Create preview · ${createPlanText(createPlan)}`),
          element("div", "dealerkit-wix-preview__field-line", `Still pending · ${(createPlan.pendingFields || []).join(" · ") || "Media and copy review"}`),
          element("div", "dealerkit-wix-preview__field-line", `CMS schema verified ${createPlan.schemaVerifiedAt || ""}. This is a read-only plan only; no Wix row will be created yet.`),
        );
        if (createPlan.descriptionDraft) {
          const features = createPlan.descriptionDraft.sourceFacts?.features || [];
          row.appendChild(element(
            "div",
            "dealerkit-wix-preview__field-line",
            `AI copy seed · ${features.length ? features.join(", ") : "No headline equipment claims extracted yet"}. Original VFC copy will remain editable and separate from the fixed VFC reassurance text.`,
          ));
        }
      } else {
        row.appendChild(element("div", "dealerkit-wix-preview__field-line", "No existing Wix row. Creation remains locked because the create plan could not be verified."));
      }
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
      ? "The fresh source/review/Wix snapshot passed the safety gates. Existing VFC price rows can now be updated through the guarded control below; media, category membership and new-record publishing remain locked."
      : "Publishing remains locked. Missing rows can now show their verified read-only create plan; live creation still waits for reviewed Wix media and approved original vehicle copy.",
  );
  result.appendChild(end);

  if (preview.canPublishLater && preview.confirmation) renderWriteGate(panel, result, preview);
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
    element("p", "", "Reads the fresh DealerKit vehicle, your last saved review choices and every mapped Van Finance Wix collection. Previewing itself never creates, updates, deletes or unpublishes anything."),
  );

  const actions = element("div", "dealerkit-wix-preview__actions");
  const status = element("span", "dealerkit-wix-preview__status", "PREVIEW FIRST");
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
    const currentRegistration = normaliseRegistration(panel.dataset.registration);
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
  const registration = normaliseRegistration(title.textContent);
  if (!registration || registration.length < 5 || registration.length > 8) return;

  let panel = body.querySelector(`[${PANEL_ATTRIBUTE}]`);
  if (!panel) {
    panel = createPanel(registration);
    const decisions = body.querySelector(".dealerkit-review__decisions");
    if (decisions) decisions.insertAdjacentElement("afterend", panel);
    else body.appendChild(panel);
  } else if (panel.dataset.registration !== registration) {
    panel.dataset.registration = registration;
    panel._dealerKitWixPreview = null;
    const result = panel.querySelector("[data-dealerkit-wix-preview-result]");
    const status = panel.querySelector("[data-dealerkit-wix-preview-status]");
    if (result) {
      result.hidden = true;
      result.replaceChildren();
    }
    if (status) {
      status.textContent = "PREVIEW FIRST";
      status.classList.remove("is-good", "is-warning");
    }
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
