const PANEL_SELECTOR = "[data-dealerkit-wix-publish-preview]";
const PREVIEW_ATTRIBUTE = "data-dealerkit-wix-manual-media-preview";
let scanQueued = false;
let rendering = false;

function clean(value) {
  return String(value ?? "").trim();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function displayStatus(item = {}) {
  return clean(item.operationStatus || item.liveOperationStatus || "UNKNOWN").toUpperCase();
}

function liveVerificationText(item = {}) {
  if (item.liveVerified) return "LIVE VERIFIED";
  return "NOT LIVE VERIFIED";
}

function renderPanel(panel) {
  const result = panel.querySelector("[data-dealerkit-wix-preview-result]");
  const preview = panel._dealerKitWixPreview;
  const readiness = preview?.manualMediaReadiness;
  if (!result || result.hidden || !readiness) return;

  result.querySelector(`[${PREVIEW_ATTRIBUTE}]`)?.remove();
  const box = element("article", "dealerkit-wix-preview__target is-matched");
  box.setAttribute(PREVIEW_ATTRIBUTE, "true");

  const top = element("div", "dealerkit-wix-preview__target-top");
  top.append(
    element("strong", "", "Staged manual Wix media"),
    element("span", "", `READ-ONLY · ${readiness.ready || 0} READY / ${readiness.total || 0} STAGED`),
  );
  box.appendChild(top);

  const items = Array.isArray(readiness.items) ? readiness.items : [];
  if (!items.length) {
    box.appendChild(element(
      "div",
      "dealerkit-wix-preview__field-line",
      "No manual Van Finance replacement or Rent2Buy template image is staged for this vehicle yet.",
    ));
  } else {
    for (const item of items) {
      const status = displayStatus(item);
      const label = item.purposeLabel || item.purpose || "Manual Wix image";
      const verification = liveVerificationText(item);
      const suffix = item.liveVerificationError ? ` · ${item.liveVerificationError}` : "";
      box.appendChild(element(
        "div",
        "dealerkit-wix-preview__field-line",
        `${label} · ${status} · ${verification}${suffix}`,
      ));
    }
  }

  box.appendChild(element(
    "div",
    "dealerkit-wix-preview__field-line",
    readiness.note || "Manual Wix media is informational at this stage and cannot publish itself.",
  ));

  if (readiness.purposesNeedingSelection?.length) {
    box.appendChild(element(
      "div",
      "dealerkit-wix-preview__field-line",
      "More than one READY image exists for at least one destination. A later controlled step must make an explicit choice; the CRM will not pick one automatically.",
    ));
  }

  const targets = result.querySelector(".dealerkit-wix-preview__targets");
  if (targets) targets.insertAdjacentElement("beforebegin", box);
  else result.appendChild(box);
}

function scan() {
  if (rendering) return;
  rendering = true;
  try {
    document.querySelectorAll(PANEL_SELECTOR).forEach(renderPanel);
  } finally {
    rendering = false;
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scan();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}
