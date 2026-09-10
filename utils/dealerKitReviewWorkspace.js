import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const WORKSPACE_ATTRIBUTE = "data-dealerkit-review-workspace";
const BUTTON_ATTRIBUTE = "data-dealerkit-review-button";
const CATEGORY_OPTIONS = Object.freeze([
  ["small", "Small"],
  ["medium_mwb", "Medium / MWB"],
  ["lwb_large", "LWB / Large"],
  ["crew", "Crew"],
  ["nine_seater", "9 Seater"],
  ["automatic", "Automatic"],
  ["electric", "Electric"],
  ["pickup_4x4", "Pickup / 4x4"],
  ["tipper_dropside_luton", "Tipper / Dropside / Luton"],
]);
const REVIEW_STATUS_OPTIONS = Object.freeze([
  ["needs_review", "Needs review"],
  ["reviewed", "Reviewed"],
  ["held", "Hold"],
]);

let scanQueued = false;
let activeRequest = 0;

function clean(value) {
  return String(value ?? "").trim();
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return `£${number.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return number.toLocaleString("en-GB");
}

function formatSavedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sameInstant(left, right) {
  if (!left || !right) return true;
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? a === b : clean(left) === clean(right);
}

function vatLabel(value) {
  const labels = {
    plus_vat: "+ VAT",
    inc_vat: "VAT included",
    no_vat: "No VAT",
    unknown: "VAT unknown",
  };
  return labels[value] || clean(value) || "VAT unknown";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function detail(label, value) {
  const node = element("div", "dealerkit-review__detail");
  node.append(element("span", "", label), element("strong", "", value || "–"));
  return node;
}

function localCard(label, local) {
  const card = element("section", "dealerkit-review__local-card");
  const top = element("div", "dealerkit-review__local-top");
  top.append(
    element("strong", "", label),
    element("span", local ? "dealerkit-review__present" : "dealerkit-review__absent", local ? "MATCHED" : "NOT MATCHED"),
  );
  card.appendChild(top);
  if (!local) {
    card.appendChild(element("p", "", `No active ${label} record currently matches this registration.`));
    return card;
  }

  const bits = [];
  if (Number.isFinite(Number(local.price))) bits.push(`Retail ${formatPrice(local.price)}`);
  if (local.vat) bits.push(local.vat);
  if (Number.isFinite(Number(local.monthly))) bits.push(`Monthly ${formatPrice(local.monthly)}`);
  if (Number.isFinite(Number(local.week))) bits.push(`Weekly ${formatPrice(local.week)}`);
  if (Number.isFinite(Number(local.initialRental))) bits.push(`Initial ${formatPrice(local.initialRental)}`);
  card.appendChild(element("p", "", bits.join(" · ") || "Active local record found."));

  if (local.url) {
    const link = element("a", "dealerkit-review__link", "Open current advert");
    link.href = local.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    card.appendChild(link);
  }
  return card;
}

function specSection(title, items) {
  const section = element("details", "dealerkit-review__spec-section");
  const summary = element("summary", "", `${title} (${Array.isArray(items) ? items.length : 0})`);
  section.appendChild(summary);
  const grid = element("div", "dealerkit-review__spec-grid");
  for (const item of Array.isArray(items) ? items : []) {
    const row = element("div", "dealerkit-review__spec-row");
    row.append(
      element("strong", "", item?.name || "Specification"),
      element("span", "", item?.value || "Included"),
    );
    grid.appendChild(row);
  }
  if (!grid.childElementCount) grid.appendChild(element("p", "dealerkit-review__empty", "No items returned by DealerKit."));
  section.appendChild(grid);
  return section;
}

function obviousFinanceCategories(vehicle) {
  const categories = new Set(["all_vans"]);
  const title = `${vehicle.title || ""} ${vehicle.derivative || ""} ${vehicle.bodyType || ""}`.toLowerCase();
  const transmission = clean(vehicle.transmission).toLowerCase();
  const fuel = clean(vehicle.fuel).toLowerCase();
  if (transmission.includes("auto")) categories.add("automatic");
  if (fuel.includes("electric")) categories.add("electric");
  if (/\bcrew\b/.test(title)) categories.add("crew");
  if (/\b9[ -]?seater\b|\bminibus\b/.test(title)) categories.add("nine_seater");
  if (/\bpick[ -]?up\b|\b4x4\b/.test(title)) categories.add("pickup_4x4");
  if (/\btipper\b|\bdrop[ -]?side\b|\bluton\b|\blow loader\b/.test(title)) categories.add("tipper_dropside_luton");
  return categories;
}

function buildReviewState(vehicle, saved = {}) {
  const currentImageIds = (vehicle.images || []).map((image) => clean(image?.id)).filter(Boolean);
  const persisted = Boolean(saved?.persisted);
  const financeCategories = new Set(Array.isArray(saved?.financeCategories) ? saved.financeCategories : ["all_vans"]);
  financeCategories.add("all_vans");
  if (!persisted) {
    for (const category of obviousFinanceCategories(vehicle)) financeCategories.add(category);
  }

  const excludedImageIds = new Set(Array.isArray(saved?.excludedImageIds) ? saved.excludedImageIds.map(clean).filter(Boolean) : []);
  const imageOrderIds = [];
  for (const id of [...(Array.isArray(saved?.imageOrderIds) ? saved.imageOrderIds : []), ...currentImageIds]) {
    const cleaned = clean(id);
    if (cleaned && !imageOrderIds.includes(cleaned)) imageOrderIds.push(cleaned);
  }

  let primaryImageId = clean(saved?.primaryImageId);
  if (!primaryImageId || excludedImageIds.has(primaryImageId) || !currentImageIds.includes(primaryImageId)) {
    primaryImageId = currentImageIds.find((id) => !excludedImageIds.has(id)) || "";
  }

  return {
    persisted,
    supplierStockId: clean(saved?.supplierStockId || vehicle.supplierStockId),
    registration: clean(saved?.registration || vehicle.registration).replace(/\s+/g, ""),
    reviewStatus: ["needs_review", "reviewed", "held"].includes(saved?.reviewStatus) ? saved.reviewStatus : "needs_review",
    financeEnabled: saved?.financeEnabled !== false,
    financeCategories,
    rent2buyEnabled: Boolean(saved?.rent2buyEnabled),
    excludedImageIds,
    primaryImageId,
    imageOrderIds,
    reviewedSourceUpdatedAt: saved?.reviewedSourceUpdatedAt || null,
    notes: clean(saved?.notes),
    updatedAt: saved?.updatedAt || null,
  };
}

function currentPrimaryImage(vehicle, state) {
  const included = (vehicle.images || []).filter((image) => image?.url && !state.excludedImageIds.has(clean(image.id)));
  return included.find((image) => clean(image.id) === state.primaryImageId) || included[0] || null;
}

async function saveReviewDecision(vehicle, state) {
  const response = await fetch("/api/dealerkit-review-decision", {
    method: "PUT",
    headers: buildMarketingAccessHeaders({
      accept: "application/json",
      "Content-Type": "application/json",
    }),
    cache: "no-store",
    body: JSON.stringify({
      supplierStockId: state.supplierStockId || vehicle.supplierStockId,
      registration: state.registration || vehicle.registration,
      reviewStatus: state.reviewStatus,
      financeEnabled: state.financeEnabled,
      financeCategories: Array.from(state.financeCategories),
      rent2buyEnabled: state.rent2buyEnabled,
      excludedImageIds: Array.from(state.excludedImageIds),
      primaryImageId: state.primaryImageId || null,
      imageOrderIds: state.imageOrderIds,
      reviewedSourceUpdatedAt: vehicle.sourceUpdatedAt || null,
      notes: state.notes,
    }),
  });
  return parseMarketingJsonResponse(response, "Could not save DealerKit review decisions.");
}

function renderDecisionControls(vehicle, state, refreshGallery) {
  const section = element("section", "dealerkit-review__section dealerkit-review__decisions");
  const heading = element("div", "dealerkit-review__decision-heading");
  heading.append(
    element("div", "", "Review decisions"),
    element("span", "dealerkit-review__decision-state", state.persisted ? `Saved ${formatSavedAt(state.updatedAt)}` : "Not saved yet"),
  );
  section.appendChild(heading);

  if (state.persisted && state.reviewedSourceUpdatedAt && vehicle.sourceUpdatedAt && !sameInstant(state.reviewedSourceUpdatedAt, vehicle.sourceUpdatedAt)) {
    section.appendChild(element("div", "dealerkit-review__stale-warning", "DealerKit has changed since these review decisions were last saved. Re-check the vehicle before marking it reviewed."));
  }

  const statusRow = element("div", "dealerkit-review__decision-row");
  const statusLabel = element("label", "dealerkit-review__field");
  statusLabel.appendChild(element("span", "", "Review status"));
  const statusSelect = document.createElement("select");
  for (const [value, label] of REVIEW_STATUS_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.reviewStatus === value;
    statusSelect.appendChild(option);
  }
  statusSelect.addEventListener("change", () => { state.reviewStatus = statusSelect.value; });
  statusLabel.appendChild(statusSelect);
  statusRow.appendChild(statusLabel);

  const financeLabel = element("label", "dealerkit-review__toggle");
  const financeToggle = document.createElement("input");
  financeToggle.type = "checkbox";
  financeToggle.checked = state.financeEnabled;
  financeToggle.setAttribute("data-dealerkit-product-route", "finance");
  financeLabel.append(financeToggle, element("span", "", "Prepare for Van Finance"));
  statusRow.appendChild(financeLabel);

  const rentLabel = element("label", "dealerkit-review__toggle");
  const rentToggle = document.createElement("input");
  rentToggle.type = "checkbox";
  rentToggle.checked = state.rent2buyEnabled;
  rentToggle.setAttribute("data-dealerkit-product-route", "rent2buy");
  rentLabel.append(rentToggle, element("span", "", "Prepare for Rent2Buy"));
  statusRow.appendChild(rentLabel);
  section.appendChild(statusRow);

  section.appendChild(element(
    "p",
    "dealerkit-review__routing-note",
    "Product routes are independent. Select Van Finance, Rent2Buy, or both; each selected product keeps its own image workspace and preparation state.",
  ));

  const categories = element("div", "dealerkit-review__category-block");
  categories.appendChild(element("strong", "", "Van Finance categories"));
  categories.appendChild(element("p", "", "All Vans is mandatory. DealerKit only pre-ticks obvious categories such as Automatic, Electric, Crew or Pickup; size categories stay for human review."));
  const categoryGrid = element("div", "dealerkit-review__category-grid");

  const allLabel = element("label", "dealerkit-review__check dealerkit-review__check--fixed");
  const allCheck = document.createElement("input");
  allCheck.type = "checkbox";
  allCheck.checked = state.financeEnabled;
  allCheck.disabled = true;
  allLabel.append(allCheck, element("span", "", "All Vans · fixed"));
  categoryGrid.appendChild(allLabel);

  const categoryInputs = [];
  for (const [key, label] of CATEGORY_OPTIONS) {
    const item = element("label", "dealerkit-review__check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.financeCategories.has(key);
    input.disabled = !state.financeEnabled;
    input.addEventListener("change", () => {
      if (input.checked) state.financeCategories.add(key);
      else state.financeCategories.delete(key);
    });
    item.append(input, element("span", "", label));
    categoryInputs.push(input);
    categoryGrid.appendChild(item);
  }
  categories.appendChild(categoryGrid);
  section.appendChild(categories);

  const notesLabel = element("label", "dealerkit-review__field dealerkit-review__notes");
  notesLabel.appendChild(element("span", "", "Review notes"));
  const notes = document.createElement("textarea");
  notes.rows = 3;
  notes.maxLength = 2000;
  notes.placeholder = "Optional note about this vehicle or its images";
  notes.value = state.notes;
  notes.addEventListener("input", () => { state.notes = notes.value; });
  notesLabel.appendChild(notes);
  section.appendChild(notesLabel);

  const footer = element("div", "dealerkit-review__decision-footer");
  const saveState = element("span", "dealerkit-review__save-state", "Saving here stores review choices only. It cannot change DealerKit, Wix or live adverts.");
  const save = element("button", "dealerkit-review__save", "Save review");
  save.type = "button";
  save.addEventListener("click", async () => {
    save.disabled = true;
    save.textContent = "Saving…";
    saveState.textContent = "Saving review decisions…";
    try {
      const result = await saveReviewDecision(vehicle, state);
      const saved = result?.decision || {};
      state.persisted = true;
      state.reviewStatus = saved.reviewStatus || state.reviewStatus;
      state.financeEnabled = saved.financeEnabled !== false;
      state.financeCategories = new Set(saved.financeCategories || ["all_vans"]);
      state.rent2buyEnabled = Boolean(saved.rent2buyEnabled);
      state.excludedImageIds = new Set(saved.excludedImageIds || []);
      state.primaryImageId = saved.primaryImageId || "";
      state.imageOrderIds = saved.imageOrderIds || state.imageOrderIds;
      state.reviewedSourceUpdatedAt = saved.reviewedSourceUpdatedAt || vehicle.sourceUpdatedAt || null;
      state.notes = saved.notes || "";
      state.updatedAt = saved.updatedAt || new Date().toISOString();
      heading.querySelector(".dealerkit-review__decision-state").textContent = `Saved ${formatSavedAt(state.updatedAt)}`;
      saveState.textContent = "Saved. Only the Marketing CRM review state changed; live stock and websites are untouched.";
      refreshGallery();
    } catch (error) {
      saveState.textContent = error?.message || "Could not save review decisions. Nothing else was changed.";
    } finally {
      save.disabled = false;
      save.textContent = "Save review";
    }
  });

  financeToggle.addEventListener("change", () => {
    state.financeEnabled = financeToggle.checked;
    if (state.financeEnabled) state.financeCategories.add("all_vans");
    allCheck.checked = state.financeEnabled;
    for (const input of categoryInputs) input.disabled = !state.financeEnabled;
  });
  rentToggle.addEventListener("change", () => { state.rent2buyEnabled = rentToggle.checked; });

  footer.append(saveState, save);
  section.appendChild(footer);
  return section;
}

function renderVehicle(workspace, payload) {
  const vehicle = payload?.vehicle || {};
  const local = payload?.local || {};
  const state = buildReviewState(vehicle, payload?.reviewDecision || {});
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  const title = workspace.querySelector("[data-dealerkit-review-title]");
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  if (!body || !title || !subtitle) return;

  title.textContent = vehicle.registration || "DealerKit vehicle";
  subtitle.textContent = vehicle.title || [vehicle.make, vehicle.model, vehicle.derivative].filter(Boolean).join(" ") || "Vehicle review";
  body.replaceChildren();

  const hero = element("section", "dealerkit-review__hero");
  const primary = currentPrimaryImage(vehicle, state);
  let heroImage = null;
  if (primary?.url) {
    heroImage = document.createElement("img");
    heroImage.src = primary.url;
    heroImage.alt = vehicle.registration || vehicle.title || "DealerKit vehicle";
    heroImage.loading = "eager";
    hero.appendChild(heroImage);
  } else {
    hero.appendChild(element("div", "dealerkit-review__hero-placeholder", "No included DealerKit image"));
  }

  const facts = element("div", "dealerkit-review__facts");
  facts.append(
    detail("DealerKit status", vehicle.sourceStatus || "Unknown"),
    detail("Retail", Number.isFinite(Number(vehicle.retailPrice)) ? formatPrice(vehicle.retailPrice) : "–"),
    detail("VAT", vatLabel(vehicle.vatStatus)),
    detail("Mileage", Number.isFinite(Number(vehicle.mileage)) ? `${formatNumber(vehicle.mileage)} miles` : "–"),
    detail("Year", vehicle.year),
    detail("Transmission", vehicle.transmission),
    detail("Fuel", vehicle.fuel),
    detail("Body", vehicle.bodyType),
    detail("Images", vehicle.imageCount),
    detail("Colour", vehicle.colour),
    detail("BHP", vehicle.bhp),
    detail("MOT expiry", vehicle.motExpiry),
  );
  hero.appendChild(facts);
  body.appendChild(hero);

  const localGrid = element("div", "dealerkit-review__local-grid");
  localGrid.append(localCard("Van Finance", local.finance), localCard("Rent2Buy", local.rent2buy));
  body.appendChild(localGrid);

  const gallerySection = element("section", "dealerkit-review__section");
  gallerySection.appendChild(element("h3", "", `DealerKit images (${vehicle.images?.length || 0})`));
  gallerySection.appendChild(element("p", "dealerkit-review__section-note", "Choose which source photos we are allowed to use and select the primary image. Only stable DealerKit image IDs are stored; the image files stay at source until the future Wix media step."));
  const gallery = element("div", "dealerkit-review__gallery");
  const imageControls = [];

  function ensurePrimary() {
    const imageIds = (vehicle.images || []).map((image) => clean(image?.id)).filter(Boolean);
    if (!state.primaryImageId || state.excludedImageIds.has(state.primaryImageId) || !imageIds.includes(state.primaryImageId)) {
      state.primaryImageId = imageIds.find((id) => !state.excludedImageIds.has(id)) || "";
    }
  }

  function refreshGallery() {
    ensurePrimary();
    for (const control of imageControls) {
      const excluded = state.excludedImageIds.has(control.id);
      const isPrimary = Boolean(control.id && control.id === state.primaryImageId && !excluded);
      control.figure.classList.toggle("is-excluded", excluded);
      control.figure.classList.toggle("is-primary", isPrimary);
      control.include.checked = !excluded;
      control.primary.disabled = excluded || !control.id;
      control.primary.textContent = isPrimary ? "Primary" : "Set primary";
      control.caption.textContent = isPrimary ? `Image ${control.index + 1} · PRIMARY` : `Source image ${control.index + 1}`;
    }
    const selected = currentPrimaryImage(vehicle, state);
    if (heroImage && selected?.url) heroImage.src = selected.url;
  }

  for (const [index, imageData] of (vehicle.images || []).entries()) {
    const imageId = clean(imageData?.id);
    const figure = element("figure", "dealerkit-review__image-card");
    const image = document.createElement("img");
    image.src = imageData.url;
    image.alt = `${vehicle.registration || "Vehicle"} image ${index + 1}`;
    image.loading = "lazy";
    const caption = element("figcaption", "", `Source image ${index + 1}`);
    figure.append(image, caption);

    const controls = element("div", "dealerkit-review__image-actions");
    if (imageId) {
      const includeLabel = element("label", "dealerkit-review__image-toggle");
      const include = document.createElement("input");
      include.type = "checkbox";
      include.checked = !state.excludedImageIds.has(imageId);
      includeLabel.append(include, element("span", "", "Use image"));
      const primaryButton = element("button", "dealerkit-review__image-primary", "Set primary");
      primaryButton.type = "button";
      include.addEventListener("change", () => {
        if (include.checked) state.excludedImageIds.delete(imageId);
        else state.excludedImageIds.add(imageId);
        ensurePrimary();
        refreshGallery();
      });
      primaryButton.addEventListener("click", () => {
        if (state.excludedImageIds.has(imageId)) return;
        state.primaryImageId = imageId;
        refreshGallery();
      });
      controls.append(includeLabel, primaryButton);
      imageControls.push({ id: imageId, figure, include, primary: primaryButton, caption, index });
    } else {
      controls.appendChild(element("span", "dealerkit-review__image-untracked", "View only · no stable image ID"));
    }
    figure.appendChild(controls);
    gallery.appendChild(figure);
  }
  if (!gallery.childElementCount) gallery.appendChild(element("p", "dealerkit-review__empty", "No source images returned."));
  gallerySection.appendChild(gallery);

  body.appendChild(renderDecisionControls(vehicle, state, refreshGallery));
  body.appendChild(gallerySection);
  refreshGallery();

  if (vehicle.attentionGrabber || vehicle.description) {
    const copy = element("section", "dealerkit-review__section");
    copy.appendChild(element("h3", "", "DealerKit advert copy"));
    if (vehicle.attentionGrabber) copy.appendChild(element("strong", "dealerkit-review__grabber", vehicle.attentionGrabber));
    if (vehicle.description) copy.appendChild(element("p", "dealerkit-review__description", vehicle.description));
    body.appendChild(copy);
  }

  const specs = element("section", "dealerkit-review__section");
  specs.appendChild(element("h3", "", "Vehicle specification"));
  specs.append(
    specSection("Standard specification", vehicle.specifications?.standard),
    specSection("Options", vehicle.specifications?.options),
    specSection("Technical specification", vehicle.specifications?.technical),
  );
  body.appendChild(specs);

  const future = element("section", "dealerkit-review__future");
  future.append(
    element("strong", "", "Review decisions only · publishing still locked"),
    element("p", "", "You can now save image choices, a primary image, Van Finance categories, review status and the Rent2Buy routing intention. These decisions live only in the Marketing CRM. There is still no Wix publish action, no DealerKit write-back and no automatic stock cutover."),
  );
  if (vehicle.sourceUrl) {
    const link = element("a", "dealerkit-review__link", "Open DealerKit vehicle");
    link.href = vehicle.sourceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    future.appendChild(link);
  }
  body.appendChild(future);
}

function setLoading(workspace, registration) {
  const title = workspace.querySelector("[data-dealerkit-review-title]");
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  if (title) title.textContent = registration || "Vehicle review";
  if (subtitle) subtitle.textContent = "Loading DealerKit vehicle data…";
  if (body) body.replaceChildren(element("div", "dealerkit-review__loading", "Reading DealerKit, saved review choices and current CRM stock…"));
}

function setError(workspace, message) {
  const subtitle = workspace.querySelector("[data-dealerkit-review-subtitle]");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  if (subtitle) subtitle.textContent = "Could not load vehicle review";
  if (body) body.replaceChildren(element("div", "dealerkit-review__error", message || "Vehicle review failed. No stock data was changed."));
}

function closeWorkspace(workspace) {
  workspace.hidden = true;
  workspace.setAttribute("aria-hidden", "true");
  document.body.classList.remove("dealerkit-review-open");
}

function createWorkspace() {
  const overlay = element("div", "dealerkit-review");
  overlay.setAttribute(WORKSPACE_ATTRIBUTE, "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.hidden = true;

  const shade = element("button", "dealerkit-review__shade");
  shade.type = "button";
  shade.setAttribute("aria-label", "Close DealerKit vehicle review");

  const panel = element("aside", "dealerkit-review__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "DealerKit vehicle review");

  const header = element("header", "dealerkit-review__header");
  const heading = element("div", "dealerkit-review__heading");
  heading.append(
    element("span", "dealerkit-review__eyebrow", "DEALERKIT · REVIEW WORKSPACE"),
    element("strong", "dealerkit-review__title", "Vehicle review"),
    element("span", "dealerkit-review__subtitle", ""),
  );
  heading.children[1].setAttribute("data-dealerkit-review-title", "true");
  heading.children[2].setAttribute("data-dealerkit-review-subtitle", "true");

  const close = element("button", "dealerkit-review__close", "Close");
  close.type = "button";
  header.append(heading, close);

  const body = element("div", "dealerkit-review__body");
  body.setAttribute("data-dealerkit-review-body", "true");
  panel.append(header, body);
  overlay.append(shade, panel);

  shade.addEventListener("click", () => closeWorkspace(overlay));
  close.addEventListener("click", () => closeWorkspace(overlay));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) closeWorkspace(overlay);
  });
  document.body.appendChild(overlay);
  return overlay;
}

function getWorkspace() {
  return document.querySelector(`[${WORKSPACE_ATTRIBUTE}]`) || createWorkspace();
}

async function openWorkspace(registration) {
  const workspace = getWorkspace();
  workspace.hidden = false;
  workspace.setAttribute("aria-hidden", "false");
  document.body.classList.add("dealerkit-review-open");
  setLoading(workspace, registration);

  const requestId = ++activeRequest;
  try {
    const response = await fetch(`/api/dealerkit-stock-detail?registration=${encodeURIComponent(registration)}`, {
      method: "GET",
      headers: buildMarketingAccessHeaders({ accept: "application/json" }),
      cache: "no-store",
    });
    const payload = await parseMarketingJsonResponse(response, "Could not load DealerKit vehicle review.");
    if (requestId !== activeRequest) return;
    renderVehicle(workspace, payload);
  } catch (error) {
    if (requestId !== activeRequest) return;
    setError(workspace, error?.message || "Could not load DealerKit vehicle review. No stock data was changed.");
  }
}

function installReviewButtons() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  for (const row of document.querySelectorAll(".dealerkit-comparison__row")) {
    if (row.querySelector(`[${BUTTON_ATTRIBUTE}]`)) continue;
    const registration = clean(row.querySelector(".dealerkit-comparison__row-top strong")?.textContent).replace(/\s+/g, "");
    if (!registration || registration.toLowerCase() === "no registration") continue;

    const links = row.querySelector(".dealerkit-comparison__links") || element("div", "dealerkit-comparison__links");
    const button = element("button", "dealerkit-comparison__review-button", "Review vehicle");
    button.type = "button";
    button.setAttribute(BUTTON_ATTRIBUTE, "true");
    button.addEventListener("click", () => openWorkspace(registration));
    links.prepend(button);
    if (!links.parentElement) row.appendChild(links);
  }
}

function scheduleScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    installReviewButtons();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
