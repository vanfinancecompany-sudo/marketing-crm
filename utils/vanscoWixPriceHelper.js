import {
  previewDealerKitPublishedPrice,
  updateDealerKitPublishedPrice,
} from "../services/dealerKitPublishedPrice.js";

const HELPER_ATTRIBUTE = "data-vansco-wix-price-helper";
let scanScheduled = false;

function cleanRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseNumber(value) {
  const match = String(value || "").match(/([0-9][0-9,]*(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, "")) : NaN;
}

function pipelineFromCard(card, text) {
  const explicit = String(card?.getAttribute?.("data-price-pipeline") || "").trim().toLowerCase();
  if (["finance", "rent2buy", "cars"].includes(explicit)) return explicit;
  if (/Wix\/Finance price:/i.test(text)) return "finance";
  if (/Wix\/Car price:/i.test(text)) return "cars";
  if (/Published monthly rental:/i.test(text)) return "rent2buy";
  return "";
}

function parseCardDetails(card) {
  const metaLines = Array.from(card?.querySelectorAll?.(".vehicle-card__meta") || []).map((node) => String(node.textContent || "").trim());
  const text = String(card?.textContent || "");
  const registrationLine = metaLines.find((line) => /^Registration:/i.test(line)) || "";
  const dealerPriceLine = metaLines.find((line) => /^(DealerKit price|DealerKit retail):/i.test(line)) || metaLines.find((line) => /^Vansco price:/i.test(line)) || "";
  const registration = cleanRegistration(card?.getAttribute?.("data-price-registration") || registrationLine.replace(/^Registration:\s*/i, ""));
  const retailPrice = parseNumber(card?.getAttribute?.("data-price-retail") || dealerPriceLine);
  const mileage = parseNumber(card?.getAttribute?.("data-price-mileage"));
  const pipeline = pipelineFromCard(card, text);
  const supplierStockId = String(card?.getAttribute?.("data-supplier-stock-id") || "").trim();
  const vatStatus = String(card?.getAttribute?.("data-price-vat-status") || "").trim();
  if (!pipeline || !registration || registration.length < 5 || registration.length > 8) return null;
  if (!supplierStockId && (!Number.isFinite(retailPrice) || retailPrice <= 0)) return null;
  return {
    pipeline,
    registration,
    supplierStockId,
    retailPrice: Number.isFinite(retailPrice) ? retailPrice : null,
    mileage: Number.isFinite(mileage) ? mileage : null,
    vatStatus,
  };
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

function previewHeading(preview) {
  const retail = `£${Number(preview.retail_price).toLocaleString("en-GB")}`;
  if (preview.pipeline === "rent2buy") {
    return `Confirm Rent2Buy update: ${retail} DealerKit retail → £${preview.monthly_price} monthly / £${preview.upfront_price} initial`;
  }
  return `Confirm Wix update: ${retail} retail / £${preview.monthly_price} per month`;
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
  heading.textContent = previewHeading(preview);
  previewNode.appendChild(heading);

  const summary = document.createElement("div");
  summary.className = "vehicle-card__meta";
  summary.style.marginTop = "6px";
  summary.textContent = `${preview.match_count} exact published CMS record${preview.match_count === 1 ? "" : "s"} found. DealerKit is rechecked before this preview and Wix is checked again before update.`;
  previewNode.appendChild(summary);

  const list = document.createElement("div");
  list.className = "vehicle-card__meta";
  list.style.marginTop = "6px";
  list.textContent = preview.matches.map((match) => `${match.site_label}: ${match.collection_label}`).join(" • ");
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
      const result = await updateDealerKitPublishedPrice({ ...details, confirmation: preview });
      const updated = result.updated;
      previewNode.remove();
      triggerButton.disabled = true;
      triggerButton.textContent = "Wix updated ✓";
      container.setAttribute("data-vansco-wix-price-complete", "true");
      const extra = updated.pipeline === "rent2buy" ? ` Monthly £${updated.monthly_price}; initial £${updated.upfront_price}.` : ` Retail £${Number(updated.retail_price).toLocaleString("en-GB")}; monthly £${updated.monthly_price}.`;
      setMessage(container, `Wix updated successfully across ${updated.updated_count} exact published CMS record${updated.updated_count === 1 ? "" : "s"}.${extra}`, "success");
    } catch (error) {
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = "Confirm Wix update";
      setMessage(previewNode, error.message || "Wix update failed. The controlled updater attempted rollback for any partial write.", "error");
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
  if (!text.includes("Price difference")) return;
  if (!/(DealerKit price:|DealerKit retail:|Vansco price:)/i.test(text)) return;

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
    button.textContent = "Checking DealerKit + Wix...";
    const oldPreview = helper.querySelector("[data-vansco-wix-preview]");
    if (oldPreview) oldPreview.remove();
    const oldMessage = helper.querySelector("[data-vansco-wix-message]");
    if (oldMessage) oldMessage.remove();
    try {
      const result = await previewDealerKitPublishedPrice(details);
      renderPreview(helper, result.preview, details, button);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Update Wix price";
      setMessage(helper, error.message || "Could not safely preview the published price update.", "error");
    }
  });

  helper.appendChild(button);
  body.appendChild(helper);
}

function updatePriceNote() {
  document.querySelectorAll(".vansco-watch-note").forEach((note) => {
    const text = String(note.textContent || "").trim();
    if (!text.startsWith("Price differences:")) return;
    if (note.getAttribute("data-vansco-wix-note") === "true") return;
    note.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Price differences:";
    note.appendChild(strong);
    note.appendChild(document.createTextNode(" DealerKit price changes are advisory until you click Update Wix price, preview the exact published CMS rows, and confirm. Finance retains its Was-price reduction history; Rent2Buy is kept in sync across both Wix sites."));
    note.setAttribute("data-vansco-wix-note", "true");
  });
}

function scan() {
  scanScheduled = false;
  updatePriceNote();
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
