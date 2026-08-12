import {
  previewVanscoWixPrice,
  updateVanscoWixPrice,
} from "../services/vanscoWixPrice.js";

const HELPER_ATTRIBUTE = "data-vansco-wix-price-helper";
let scanScheduled = false;

function cleanRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseCardDetails(card) {
  const metaLines = Array.from(card?.querySelectorAll?.(".vehicle-card__meta") || []).map((node) => String(node.textContent || "").trim());
  const registrationLine = metaLines.find((line) => /^Registration:/i.test(line)) || "";
  const vanscoPriceLine = metaLines.find((line) => /^Vansco price:/i.test(line)) || "";
  const registration = cleanRegistration(registrationLine.replace(/^Registration:\s*/i, ""));
  const priceMatch = vanscoPriceLine.match(/£\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  const retailPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : NaN;
  if (!registration || registration.length < 5 || registration.length > 8 || !Number.isFinite(retailPrice) || retailPrice <= 0) return null;
  return { registration, retailPrice };
}

function setMessage(container, message, type = "normal") {
  const existing = container.querySelector("[data-vansco-wix-message]");
  if (existing) existing.remove();
  const messageNode = document.createElement("div");
  messageNode.setAttribute("data-vansco-wix-message", "true");
  messageNode.className = type === "error" ? "error-banner" : type === "success" ? "success-banner" : "vehicle-card__meta";
  messageNode.style.marginTop = "10px";
  messageNode.textContent = message;
  container.appendChild(messageNode);
  return messageNode;
}

function renderPreview(container, preview, details, triggerButton) {
  const existing = container.querySelector("[data-vansco-wix-preview]");
  if (existing) existing.remove();

  const previewNode = document.createElement("div");
  previewNode.setAttribute("data-vansco-wix-preview", "true");
  previewNode.style.marginTop = "10px";
  previewNode.style.padding = "12px";
  previewNode.style.border = "1px solid #d1d5db";
  previewNode.style.borderRadius = "10px";
  previewNode.style.background = "#fff";

  const heading = document.createElement("strong");
  heading.textContent = `Confirm Wix update: £${Number(preview.retail_price).toLocaleString("en-GB")} retail / £${preview.monthly_price} per month`;
  previewNode.appendChild(heading);

  const summary = document.createElement("div");
  summary.className = "vehicle-card__meta";
  summary.style.marginTop = "6px";
  summary.textContent = `${preview.match_count} exact CMS record${preview.match_count === 1 ? "" : "s"} found. Only retail and monthly price fields will be changed.`;
  previewNode.appendChild(summary);

  const list = document.createElement("div");
  list.className = "vehicle-card__meta";
  list.style.marginTop = "6px";
  list.textContent = preview.matches.map((match) => match.collection_label).join(" • ");
  previewNode.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.style.marginTop = "10px";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "button button--primary";
  confirmButton.textContent = "Confirm Wix update";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button button--ghost";
  cancelButton.textContent = "Cancel";

  cancelButton.addEventListener("click", () => {
    previewNode.remove();
    triggerButton.disabled = false;
    triggerButton.textContent = "Update Wix price";
  });

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = "Updating Wix...";
    try {
      const result = await updateVanscoWixPrice({
        registration: details.registration,
        retailPrice: details.retailPrice,
        confirmation: preview,
      });
      const updated = result.updated;
      previewNode.remove();
      triggerButton.disabled = true;
      triggerButton.textContent = "Wix updated ✓";
      container.setAttribute("data-vansco-wix-price-complete", "true");
      setMessage(container, `Wix updated successfully: ${updated.updated_count} exact CMS record${updated.updated_count === 1 ? "" : "s"}. Retail £${Number(updated.retail_price).toLocaleString("en-GB")}; monthly £${updated.monthly_price}.`, "success");
    } catch (error) {
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = "Confirm Wix update";
      setMessage(previewNode, error.message || "Wix update failed. Nothing else in Stock Watch was changed.", "error");
    }
  });

  actions.append(confirmButton, cancelButton);
  previewNode.appendChild(actions);
  container.appendChild(previewNode);
}

function attachHelper(card) {
  if (card.querySelector(`[${HELPER_ATTRIBUTE}]`)) return;
  const body = card.querySelector(".vansco-card__body");
  if (!body) return;
  const text = String(body.textContent || "");
  if (!text.includes("Wix/Finance price:") || !text.includes("Vansco price:") || !text.includes("Price difference")) return;

  const details = parseCardDetails(card);
  if (!details) return;

  const helper = document.createElement("div");
  helper.setAttribute(HELPER_ATTRIBUTE, "true");
  helper.style.marginTop = "10px";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--primary";
  button.textContent = "Update Wix price";

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Checking Wix...";
    const oldPreview = helper.querySelector("[data-vansco-wix-preview]");
    if (oldPreview) oldPreview.remove();
    const oldMessage = helper.querySelector("[data-vansco-wix-message]");
    if (oldMessage) oldMessage.remove();
    try {
      const result = await previewVanscoWixPrice(details);
      renderPreview(helper, result.preview, details, button);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Update Wix price";
      setMessage(helper, error.message || "Could not safely preview the Wix price update.", "error");
    }
  });

  helper.appendChild(button);
  body.appendChild(helper);
}

function updateFinancePriceNote() {
  document.querySelectorAll(".vansco-watch-note").forEach((note) => {
    const text = String(note.textContent || "").trim();
    if (!text.startsWith("Price differences:")) return;
    if (note.getAttribute("data-vansco-wix-note") === "true") return;
    note.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Price differences:";
    note.appendChild(strong);
    note.appendChild(document.createTextNode(" Van Finance only. Exact registration and VAT-basis checks stay unchanged. Use Update Wix price to preview and manually confirm the retail/monthly CMS changes. Vansco is never edited."));
    note.setAttribute("data-vansco-wix-note", "true");
  });
}

function scan() {
  scanScheduled = false;
  updateFinancePriceNote();
  document.querySelectorAll(".vansco-card").forEach(attachHelper);
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  queueMicrotask(scan);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
