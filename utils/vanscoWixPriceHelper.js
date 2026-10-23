import {
  previewDealerKitPublishedPrice,
  updateDealerKitPublishedPrice,
} from "../services/dealerKitPublishedPrice.js";
import { getVfcPricingReviewHold } from "../lib/vfcPricingReviewHolds.mjs";
import { pendingRent2BuySpecialDeal } from "../lib/rent2BuyProtectedSpecialDeals.mjs";

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

  // Compare each exact Wix listing/detail field, not just the DealerKit retail.
  for (const match of preview.matches || []) {
    const line = document.createElement("div");
    line.className = "vehicle-card__meta";
    line.style.marginTop = "8px";
    const fields = (values) => Object.entries(values || {})
      .filter(([key]) => ["price", "priceVat", "salePrice", "mthPrice", "wk", "monthlyPayments", "intialRentalCharge"].includes(key))
      .map(([key, value]) => `${key}: ${value || "blank"}`).join(" · ");
    const title = document.createElement("strong");
    title.textContent = `${match.site_label} / ${match.collection_label}`;
    const current = document.createElement("div");
    current.textContent = `Current Wix: ${fields(match.current)}`;
    const proposed = document.createElement("div");
    proposed.textContent = `Proposed: ${fields(match.proposed)}`;
    line.append(title, current, proposed);
    previewNode.appendChild(line);
  }

  const hold = preview.review_hold;
  let holdCheckbox = null;
  let holdRegistration = null;
  if (hold) {
    const note = document.createElement("div");
    note.className = "vehicle-card__meta";
    note.style.marginTop = "10px";
    const title = document.createElement("strong");
    title.textContent = "Why this update was on hold: ";
    note.append(title, document.createTextNode(`${hold.issue} ${hold.evidence} Required check: ${hold.check} These findings are historic; use the live Wix values above.`));
    previewNode.appendChild(note);
    if (preview.source_mode !== "fresh_dealerkit") {
      const warning = document.createElement("div");
      warning.className = "error-banner";
      warning.textContent = "Cannot approve a held price with a saved DealerKit snapshot. Refresh Stock Watch to obtain the live DealerKit vehicle ID.";
      previewNode.appendChild(warning);
    }
    const label = document.createElement("label");
    label.className = "vehicle-card__meta";
    label.style.display = "block";
    label.style.marginTop = "8px";
    holdCheckbox = document.createElement("input");
    holdCheckbox.type = "checkbox";
    holdCheckbox.style.marginRight = "8px";
    label.append(holdCheckbox, document.createTextNode("I have checked the live Wix listing, detail and VAT/vehicle identity, and approve using the current DealerKit retail price."));
    previewNode.appendChild(label);
    holdRegistration = document.createElement("input");
    holdRegistration.type = "text";
    holdRegistration.placeholder = `Type ${preview.registration} to approve`;
    holdRegistration.setAttribute("aria-label", "Confirm vehicle registration for reviewed Wix correction");
    holdRegistration.style.width = "100%";
    holdRegistration.style.marginTop = "8px";
    previewNode.appendChild(holdRegistration);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.style.marginTop = "10px";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "button button--primary";
  confirmButton.textContent = hold ? "Apply reviewed Wix correction" : "Confirm Wix update";
  const canConfirm = () => !hold || (
    preview.source_mode === "fresh_dealerkit"
    && holdCheckbox?.checked === true
    && cleanRegistration(holdRegistration?.value) === preview.registration
  );
  if (hold) {
    confirmButton.disabled = true;
    const enableIfApproved = () => { confirmButton.disabled = !canConfirm(); };
    holdCheckbox.addEventListener("change", enableIfApproved);
    holdRegistration.addEventListener("input", enableIfApproved);
  }

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "button button--ghost";
  cancelButton.textContent = "Cancel";

  cancelButton.addEventListener("click", () => {
    previewNode.remove();
    triggerButton.disabled = false;
    triggerButton.textContent = hold ? "Review price difference" : "Update Wix price";
  });

  confirmButton.addEventListener("click", async () => {
    if (!canConfirm()) return;
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = "Updating Wix...";
    try {
      const holdReview = hold ? {
        registration: cleanRegistration(holdRegistration.value),
        confirmed: holdCheckbox.checked,
        decision: "use_fresh_dealerkit_price",
      } : null;
      const result = await updateDealerKitPublishedPrice({ ...details, confirmation: preview, holdReview });
      const updated = result.updated;
      previewNode.remove();
      triggerButton.disabled = true;
      triggerButton.textContent = "Wix updated ✓";
      container.setAttribute("data-vansco-wix-price-complete", "true");
      const extra = updated.pipeline === "rent2buy" ? ` Monthly £${updated.monthly_price}; initial £${updated.upfront_price}.` : ` Retail £${Number(updated.retail_price).toLocaleString("en-GB")}; monthly £${updated.monthly_price}.`;
      setMessage(container, `Wix updated successfully across ${updated.updated_count} exact published CMS record${updated.updated_count === 1 ? "" : "s"}.${extra}`, "success");
    } catch (error) {
      confirmButton.disabled = !canConfirm();
      cancelButton.disabled = false;
      confirmButton.textContent = hold ? "Apply reviewed Wix correction" : "Confirm Wix update";
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

  // A manually agreed Rent2Buy deal is never a normal DealerKit price mismatch.
  // Keep the update control disabled, as well as server-side reject protections.
  const special = details.pipeline === "rent2buy" ? pendingRent2BuySpecialDeal(details.registration) : null;
  if (special) {
    const note = document.createElement("div");
    note.className = "vehicle-card__meta";
    note.setAttribute("data-rent2buy-price-protection", "true");
    note.textContent = "SPECIAL DEAL PROTECTED · Wix listing £" + special.publishedMonthlyExVat + " + VAT. Vehicle-detail prices may differ. Verify the agreed initial rental, term and mileage before migration. Automatic Wix price updates are disabled.";
    const disabled = document.createElement("button");
    disabled.type = "button";
    disabled.className = "button button--primary";
    disabled.textContent = "Special deal protected";
    disabled.disabled = true;
    helper.append(note, disabled);
    body.appendChild(helper);
    return;
  }

  const held = getVfcPricingReviewHold(details.registration);
  if (held) {
    const issueNote = document.createElement("div");
    issueNote.className = "vehicle-card__meta";
    issueNote.style.marginBottom = "8px";
    const title = document.createElement("strong");
    title.textContent = "Historic hold: ";
    issueNote.append(title, document.createTextNode(`${held.issue} ${held.evidence} Open the CRM review to check the current Wix values.`));
    helper.appendChild(issueNote);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--primary";
  button.textContent = held ? "Review price difference" : "Update Wix price";

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
      button.textContent = held ? "Review price difference" : "Update Wix price";
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
