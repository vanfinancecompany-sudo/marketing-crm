import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";
import {
  decodeDealerKitProductImageState,
  encodeDealerKitProductImageState,
} from "../lib/dealerKitProductImageState.js";
import "../styles/dealerkit-product-gallery-workspace.css";

const WORKSPACE_SELECTOR = "[data-dealerkit-review-workspace]";
const ROOT_ATTRIBUTE = "data-dealerkit-product-gallery";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PRODUCTS = Object.freeze({
  finance: Object.freeze({
    label: "Van Finance",
    purpose: "van_finance_replacement",
    uploadLabel: "Finance template / showroom image",
  }),
  rent2buy: Object.freeze({
    label: "Rent2Buy",
    purpose: "rent2buy_template",
    uploadLabel: "Rent2Buy template / showroom image",
  }),
});
const CATEGORY_KEYS = Object.freeze({
  Small: "small",
  "Medium / MWB": "medium_mwb",
  "LWB / Large": "lwb_large",
  Crew: "crew",
  "9 Seater": "nine_seater",
  Automatic: "automatic",
  Electric: "electric",
  "Pickup / 4x4": "pickup_4x4",
  "Tipper / Dropside / Luton": "tipper_dropside_luton",
});

let scanQueued = false;
let renderingScan = false;
let requestCounter = 0;

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

function money(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `£${number.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`
    : "–";
}

function validateFile(file) {
  if (!file) return "Choose an image first.";
  if (!ALLOWED_TYPES.has(clean(file.type).toLowerCase())) return "Choose a JPEG, PNG or WebP image.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "That image has an invalid file size.";
  if (file.size > MAX_BYTES) return "Images are limited to 10 MB.";
  return null;
}

async function apiJson(url, options = {}, fallback) {
  const response = await fetch(url, {
    ...options,
    headers: buildMarketingAccessHeaders({
      accept: "application/json",
      ...(options.headers || {}),
    }),
    cache: "no-store",
  });
  return parseMarketingJsonResponse(response, fallback);
}

async function postManualMedia(registration, body, fallback) {
  return apiJson("/api/dealerkit-wix-manual-media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ registration, ...body }),
  }, fallback);
}

function copyMutableImageState(decoded) {
  return {
    split: decoded.split,
    sourceIds: [...decoded.sourceIds],
    finance: {
      orderIds: [...decoded.finance.orderIds],
      excludedIds: [...decoded.finance.excludedIds],
      includedOrderIds: [...decoded.finance.includedOrderIds],
      primaryId: decoded.finance.primaryId || null,
    },
    rent2buy: {
      orderIds: [...decoded.rent2buy.orderIds],
      excludedIds: [...decoded.rent2buy.excludedIds],
      includedOrderIds: [...decoded.rent2buy.includedOrderIds],
      primaryId: decoded.rent2buy.primaryId || null,
    },
  };
}

function refreshIncluded(state, product) {
  const productState = state.imageState[product];
  const excluded = new Set(productState.excludedIds);
  productState.includedOrderIds = productState.orderIds.filter((id) => !excluded.has(id));
  if (product === "finance") {
    if (!productState.primaryId || excluded.has(productState.primaryId) || !productState.orderIds.includes(productState.primaryId)) {
      productState.primaryId = productState.includedOrderIds[0] || null;
    }
  } else {
    productState.primaryId = productState.includedOrderIds[0] || null;
  }
}

function manualForProduct(state, product) {
  const purpose = PRODUCTS[product].purpose;
  return state.manualMedia.filter((item) => item?.purpose === purpose);
}

function selectedManual(state, product) {
  return manualForProduct(state, product).find((item) => item?.selected && item?.ready) || null;
}

function findLegacyGallerySection(body) {
  return Array.from(body.querySelectorAll(".dealerkit-review__section")).find((section) => {
    const heading = clean(section.querySelector("h3")?.textContent).toLowerCase();
    return heading.startsWith("dealerkit images");
  }) || null;
}

function hideLegacyImageUi(workspace, body) {
  const localGrid = body.querySelector(".dealerkit-review__local-grid");
  if (localGrid) localGrid.hidden = true;
  const gallery = findLegacyGallerySection(body);
  if (gallery) gallery.hidden = true;
  const oldFooter = body.querySelector(".dealerkit-review__decisions .dealerkit-review__decision-footer");
  if (oldFooter) oldFooter.hidden = true;
  workspace.querySelectorAll("[data-dealerkit-wix-manual-media]").forEach((node) => { node.hidden = true; });
}

function readCurrentReviewControls(body, fallback = {}) {
  const decisions = body.querySelector(".dealerkit-review__decisions");
  if (!decisions) return { ...fallback };

  const status = decisions.querySelector("select")?.value || fallback.reviewStatus || "needs_review";
  let financeEnabled = fallback.financeEnabled !== false;
  let rent2buyEnabled = Boolean(fallback.rent2buyEnabled);
  for (const label of decisions.querySelectorAll(".dealerkit-review__toggle")) {
    const text = clean(label.textContent).toLowerCase();
    const input = label.querySelector('input[type="checkbox"]');
    if (!input) continue;
    if (text.includes("van finance enabled")) financeEnabled = input.checked;
    if (text.includes("rent2buy")) rent2buyEnabled = input.checked;
  }

  const financeCategories = ["all_vans"];
  for (const label of decisions.querySelectorAll(".dealerkit-review__category-grid .dealerkit-review__check")) {
    const input = label.querySelector('input[type="checkbox"]');
    if (!input?.checked) continue;
    const text = clean(label.textContent).replace(/\s*·\s*fixed\s*$/i, "");
    const key = CATEGORY_KEYS[text];
    if (key && !financeCategories.includes(key)) financeCategories.push(key);
  }

  const notes = decisions.querySelector(".dealerkit-review__notes textarea")?.value ?? fallback.notes ?? "";
  return {
    ...fallback,
    reviewStatus: status,
    financeEnabled,
    financeCategories,
    rent2buyEnabled,
    notes,
  };
}

function setMessage(state, text, tone = "") {
  state.message = text || "";
  state.messageTone = tone;
  const node = state.root?.querySelector("[data-product-gallery-message]");
  if (!node) return;
  node.textContent = state.message;
  node.className = `dealerkit-product-gallery__message${tone ? ` is-${tone}` : ""}`;
}

function markDirty(state, text = "Image changes not saved yet.") {
  state.dirty = true;
  setMessage(state, text, "warning");
}

function fact(label, value, note = "") {
  const card = element("div", "dealerkit-product-gallery__fact");
  card.append(element("span", "", label), element("strong", "", value || "–"));
  if (note) card.appendChild(element("small", "", note));
  return card;
}

function renderPricing(state, product, host) {
  host.replaceChildren();
  const vehicle = state.vehicle;
  const local = state.local?.[product] || null;
  if (product === "finance") {
    host.append(
      fact("DealerKit retail", money(vehicle.retailPrice), vehicle.vatStatus === "plus_vat" ? "+ VAT" : vehicle.vatStatus || ""),
      fact("Current Finance advert", local ? money(local.price) : "Not advertised"),
      fact("Current monthly", local ? money(local.monthly) : "–"),
      fact("Images selected", String(state.imageState.finance.includedOrderIds.length)),
    );
  } else {
    host.append(
      fact("Current Rent2Buy monthly", local ? money(local.monthly) : "Not advertised"),
      fact("Weekly", local ? money(local.week) : "–"),
      fact("Initial rental", local ? money(local.initialRental) : "–"),
      fact("Images selected", String(state.imageState.rent2buy.includedOrderIds.length)),
    );
  }
}

function moveImage(state, product, draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const order = state.imageState[product].orderIds;
  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(to, 0, draggedId);
  refreshIncluded(state, product);
  markDirty(state, `${PRODUCTS[product].label} image order changed. Save the gallery when you are happy.`);
  renderActiveProduct(state);
}

function sourceCard(state, product, image, displayIndex) {
  const id = clean(image?.id);
  const productState = state.imageState[product];
  const excluded = productState.excludedIds.includes(id);
  const card = element("article", `dealerkit-product-gallery__image${excluded ? " is-excluded" : ""}`);
  card.draggable = true;
  card.dataset.imageId = id;

  const imageNode = document.createElement("img");
  imageNode.src = image.url;
  imageNode.alt = `${state.vehicle.registration || "Vehicle"} source image ${displayIndex + 1}`;
  imageNode.loading = "lazy";
  card.appendChild(imageNode);

  const top = element("div", "dealerkit-product-gallery__image-top");
  const position = productState.includedOrderIds.indexOf(id);
  top.append(
    element("strong", "", position >= 0 ? `#${position + 1}` : "Excluded"),
    element("span", "", "DealerKit"),
  );
  card.appendChild(top);

  const controls = element("div", "dealerkit-product-gallery__image-controls");
  const includeLabel = element("label", "dealerkit-product-gallery__include");
  const include = document.createElement("input");
  include.type = "checkbox";
  include.checked = !excluded;
  include.addEventListener("change", () => {
    if (include.checked) productState.excludedIds = productState.excludedIds.filter((value) => value !== id);
    else if (!productState.excludedIds.includes(id)) productState.excludedIds.push(id);
    refreshIncluded(state, product);
    markDirty(state, `${PRODUCTS[product].label} image selection changed.`);
    renderActiveProduct(state);
  });
  includeLabel.append(include, element("span", "", "Use image"));
  controls.appendChild(includeLabel);

  if (product === "finance" && !excluded) {
    const primary = element("button", "dealerkit-product-gallery__mini-button", productState.primaryId === id ? "Source primary" : "Set source primary");
    primary.type = "button";
    primary.disabled = productState.primaryId === id;
    primary.addEventListener("click", () => {
      productState.primaryId = id;
      markDirty(state, "Van Finance source primary changed. A selected Finance template image still takes precedence as the live cover image.");
      renderActiveProduct(state);
    });
    controls.appendChild(primary);
  }
  card.appendChild(controls);

  card.addEventListener("dragstart", (event) => {
    state.draggedImageId = id;
    card.classList.add("is-dragging");
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => {
    state.draggedImageId = "";
    card.classList.remove("is-dragging");
  });
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    card.classList.add("is-drop-target");
  });
  card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    card.classList.remove("is-drop-target");
    const dragged = state.draggedImageId || event.dataTransfer?.getData("text/plain");
    moveImage(state, product, dragged, id);
  });
  return card;
}

async function refreshOneManual(state, item) {
  if (!item?.id || !item?.processing) return item;
  try {
    const result = await postManualMedia(state.registration, { action: "refresh_status", mediaId: item.id }, "Could not refresh Wix Media.");
    return result.media || item;
  } catch {
    return item;
  }
}

async function loadManualMedia(state, { quiet = false } = {}) {
  if (!state.decision?.persisted) {
    state.manualMedia = [];
    if (!quiet) setMessage(state, "Save the review once before uploading a Finance or Rent2Buy template image.", "warning");
    return;
  }
  try {
    const payload = await apiJson(
      `/api/dealerkit-wix-manual-media?registration=${encodeURIComponent(state.registration)}`,
      {},
      "Could not load staged Wix images.",
    );
    let media = Array.isArray(payload.media) ? payload.media : [];
    const refreshed = [];
    for (const item of media) refreshed.push(await refreshOneManual(state, item));
    state.manualMedia = refreshed;
  } catch (error) {
    state.manualMedia = [];
    if (!quiet) setMessage(state, error?.message || "Could not load staged Wix images.", "warning");
  }
}

function manualCard(state, product, item) {
  const selected = Boolean(item?.selected);
  const ready = Boolean(item?.ready);
  const card = element("article", `dealerkit-product-gallery__manual${selected ? " is-primary" : ""}`);
  const imageUrl = item.thumbnailUrl || item.url;
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${PRODUCTS[product].label} uploaded image`;
    image.loading = "lazy";
    card.appendChild(image);
  }
  const copy = element("div", "dealerkit-product-gallery__manual-copy");
  copy.append(
    element("strong", "", item.displayName || PRODUCTS[product].uploadLabel),
    element("span", selected ? "dealerkit-product-gallery__primary-badge" : "", selected ? "PRODUCT PRIMARY" : (item.operationStatus || "STAGED")),
  );
  const actions = element("div", "dealerkit-product-gallery__manual-actions");
  if (ready && !selected) {
    const choose = element("button", "dealerkit-product-gallery__mini-button is-primary-action", "Set as primary");
    choose.type = "button";
    choose.addEventListener("click", async () => {
      choose.disabled = true;
      setMessage(state, `Selecting ${PRODUCTS[product].label} primary image…`);
      try {
        await postManualMedia(state.registration, { action: "select_media", mediaId: item.id }, "Could not select this Wix image.");
        await loadManualMedia(state, { quiet: true });
        setMessage(state, `${PRODUCTS[product].label} primary image selected. This still does not publish the vehicle.`, "good");
        renderActiveProduct(state);
      } catch (error) {
        choose.disabled = false;
        setMessage(state, error?.message || "Could not select that image.", "warning");
      }
    });
    actions.appendChild(choose);
  } else if (!ready) {
    const recheck = element("button", "dealerkit-product-gallery__mini-button", "Recheck Wix");
    recheck.type = "button";
    recheck.addEventListener("click", async () => {
      recheck.disabled = true;
      const refreshed = await refreshOneManual(state, { ...item, processing: true });
      state.manualMedia = state.manualMedia.map((value) => value.id === refreshed.id ? refreshed : value);
      renderActiveProduct(state);
    });
    actions.appendChild(recheck);
  }
  copy.appendChild(actions);
  card.appendChild(copy);
  return card;
}

function renderPendingUpload(state, product, host) {
  const pending = state.pendingUploads[product];
  if (!pending?.url) return;
  const card = element("article", "dealerkit-product-gallery__manual is-local-preview");
  const image = document.createElement("img");
  image.src = pending.url;
  image.alt = `${PRODUCTS[product].label} local upload preview`;
  card.appendChild(image);
  const copy = element("div", "dealerkit-product-gallery__manual-copy");
  copy.append(
    element("strong", "", pending.file?.name || "Selected image"),
    element("span", "dealerkit-product-gallery__local-badge", "LOCAL PREVIEW"),
  );
  card.appendChild(copy);
  host.appendChild(card);
}

function uploadPanel(state, product) {
  const panel = element("div", "dealerkit-product-gallery__upload");
  const copy = element("div", "dealerkit-product-gallery__upload-copy");
  copy.append(
    element("strong", "", `Add ${PRODUCTS[product].label} image`),
    element("span", "", "Choose a prepared/template image. You will see it in this gallery before it is uploaded."),
  );

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
  input.setAttribute("aria-label", `Choose ${PRODUCTS[product].label} image`);
  input.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    const issue = validateFile(file);
    if (issue) {
      setMessage(state, issue, "warning");
      return;
    }
    const previous = state.pendingUploads[product];
    if (previous?.url) URL.revokeObjectURL(previous.url);
    state.pendingUploads[product] = { file, url: URL.createObjectURL(file) };
    setMessage(state, `${file.name} is previewing in the ${PRODUCTS[product].label} gallery. Upload it when ready.`, "good");
    renderActiveProduct(state);
  });

  const upload = element("button", "dealerkit-product-gallery__upload-button", "Upload image");
  upload.type = "button";
  upload.disabled = !state.pendingUploads[product]?.file || !state.decision?.persisted || state.uploading;
  upload.addEventListener("click", async () => {
    const pending = state.pendingUploads[product];
    const file = pending?.file;
    const issue = validateFile(file);
    if (issue) {
      setMessage(state, issue, "warning");
      return;
    }
    if (!state.decision?.persisted) {
      setMessage(state, "Save the review first, then upload the product image.", "warning");
      return;
    }

    state.uploading = true;
    renderActiveProduct(state);
    setMessage(state, `Preparing secure ${PRODUCTS[product].label} upload…`);
    try {
      const prepared = await postManualMedia(state.registration, {
        action: "prepare_upload",
        purpose: PRODUCTS[product].purpose,
        fileName: file.name,
        mimeType: file.type,
        sizeInBytes: file.size,
      }, "Could not prepare the Wix Media upload.");

      setMessage(state, `Uploading ${file.name} to Wix Media…`);
      const uploadResponse = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": prepared.mimeType || file.type },
        body: file,
      });
      const uploaded = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploaded?.message || `Wix Media upload returned ${uploadResponse.status}.`);
      const wixFileId = clean(uploaded?.file?.id);
      if (!wixFileId) throw new Error("Wix accepted the image but did not return a file ID.");

      await postManualMedia(state.registration, {
        action: "register_upload",
        purpose: PRODUCTS[product].purpose,
        wixFileId,
      }, "The image reached Wix, but the CRM could not register it.");
      if (pending?.url) URL.revokeObjectURL(pending.url);
      state.pendingUploads[product] = null;
      await loadManualMedia(state, { quiet: true });
      setMessage(state, `${PRODUCTS[product].label} image uploaded. It is now visible in this gallery; choose Set as primary when Wix reports READY.`, "good");
    } catch (error) {
      setMessage(state, error?.message || "Image upload failed.", "warning");
    } finally {
      state.uploading = false;
      renderActiveProduct(state);
    }
  });

  const actions = element("div", "dealerkit-product-gallery__upload-actions");
  actions.append(input, upload);
  panel.append(copy, actions);
  if (!state.decision?.persisted) panel.appendChild(element("small", "dealerkit-product-gallery__save-first", "Save the review once before uploading to Wix Media."));
  return panel;
}

async function saveProductState(state) {
  const body = state.workspace.querySelector("[data-dealerkit-review-body]");
  const liveReview = readCurrentReviewControls(body, state.decision);
  const encoded = encodeDealerKitProductImageState(state.imageState);
  setMessage(state, "Saving review choices and both product galleries…");
  state.saving = true;
  renderSaveButton(state);
  try {
    const payload = await apiJson("/api/dealerkit-review-decision", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierStockId: state.vehicle.supplierStockId,
        registration: state.registration,
        reviewStatus: liveReview.reviewStatus || "needs_review",
        financeEnabled: liveReview.financeEnabled !== false,
        financeCategories: liveReview.financeCategories || ["all_vans"],
        rent2buyEnabled: Boolean(liveReview.rent2buyEnabled),
        excludedImageIds: encoded.excludedImageIds,
        primaryImageId: encoded.primaryImageId,
        imageOrderIds: encoded.imageOrderIds,
        reviewedSourceUpdatedAt: state.vehicle.sourceUpdatedAt || null,
        notes: liveReview.notes || "",
      }),
    }, "Could not save product gallery choices.");
    state.decision = payload.decision || { ...state.decision, ...liveReview, ...encoded, persisted: true };
    state.imageState = copyMutableImageState(decodeDealerKitProductImageState(state.decision, state.sourceIds));
    state.dirty = false;
    await loadManualMedia(state, { quiet: true });
    setMessage(state, "Saved. Van Finance and Rent2Buy now keep their own image selection and order. Nothing has been published.", "good");
    renderActiveProduct(state);
  } catch (error) {
    setMessage(state, error?.message || "Could not save product gallery choices.", "warning");
  } finally {
    state.saving = false;
    renderSaveButton(state);
  }
}

function renderSaveButton(state) {
  const button = state.root?.querySelector("[data-product-gallery-save]");
  if (!button) return;
  button.disabled = Boolean(state.saving);
  button.textContent = state.saving ? "Saving…" : (state.dirty ? "Save gallery changes" : "Save review & galleries");
}

function renderActiveProduct(state) {
  if (!state.root) return;
  const product = state.activeProduct;
  const config = PRODUCTS[product];
  state.root.querySelectorAll("[data-product-tab]").forEach((button) => {
    const active = button.dataset.productTab === product;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  const title = state.root.querySelector("[data-product-gallery-title]");
  if (title) title.textContent = `${config.label} images`;
  const subtitle = state.root.querySelector("[data-product-gallery-subtitle]");
  if (subtitle) subtitle.textContent = product === "finance"
    ? "This is the image order that will be used for Van Finance. A selected Finance template image becomes its cover/listing image."
    : "This is the separate Rent2Buy image order. A selected Rent2Buy template image becomes its cover/listing image.";

  const pricing = state.root.querySelector("[data-product-gallery-pricing]");
  if (pricing) renderPricing(state, product, pricing);

  const manualHost = state.root.querySelector("[data-product-gallery-manual]");
  if (manualHost) {
    manualHost.replaceChildren();
    renderPendingUpload(state, product, manualHost);
    for (const item of manualForProduct(state, product)) manualHost.appendChild(manualCard(state, product, item));
    if (!manualHost.childElementCount) manualHost.appendChild(element("div", "dealerkit-product-gallery__empty", `No ${config.label} template image uploaded yet.`));
  }

  const uploadHost = state.root.querySelector("[data-product-gallery-upload]");
  if (uploadHost) uploadHost.replaceChildren(uploadPanel(state, product));

  const gallery = state.root.querySelector("[data-product-gallery-source]");
  if (gallery) {
    gallery.replaceChildren();
    const imageById = new Map((state.vehicle.images || []).map((image) => [clean(image.id), image]));
    state.imageState[product].orderIds.forEach((id, index) => {
      const image = imageById.get(id);
      if (image?.url) gallery.appendChild(sourceCard(state, product, image, index));
    });
    if (!gallery.childElementCount) gallery.appendChild(element("div", "dealerkit-product-gallery__empty", "No DealerKit source images returned."));
  }

  const selected = selectedManual(state, product);
  const primaryNote = state.root.querySelector("[data-product-gallery-primary-note]");
  if (primaryNote) {
    if (selected) primaryNote.textContent = `${selected.displayName || "Uploaded image"} is the ${config.label} product primary.`;
    else if (product === "finance" && state.imageState.finance.primaryId) primaryNote.textContent = "No Finance template selected. The chosen DealerKit source primary will be used as the Finance cover.";
    else primaryNote.textContent = "No product template is selected as primary yet.";
  }

  const upload = state.root.querySelector(".dealerkit-product-gallery__upload-button");
  if (upload) upload.textContent = state.uploading ? "Uploading…" : "Upload image";
  renderSaveButton(state);
}

function buildRoot(state) {
  const root = element("section", "dealerkit-product-gallery");
  root.setAttribute(ROOT_ATTRIBUTE, "true");
  root.dataset.registration = state.registration;

  const top = element("div", "dealerkit-product-gallery__top");
  const heading = element("div", "dealerkit-product-gallery__heading");
  heading.append(
    element("span", "dealerkit-product-gallery__eyebrow", "PRODUCT WORKSPACE"),
    element("strong", "", "Choose where you are preparing this van"),
    element("p", "", "Finance and Rent2Buy now have separate image selections and image order. Switching tabs never publishes anything."),
  );
  const tabs = element("div", "dealerkit-product-gallery__tabs");
  tabs.setAttribute("role", "tablist");
  for (const [key, config] of Object.entries(PRODUCTS)) {
    const button = element("button", "dealerkit-product-gallery__tab", config.label);
    button.type = "button";
    button.dataset.productTab = key;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => {
      state.activeProduct = key;
      renderActiveProduct(state);
    });
    tabs.appendChild(button);
  }
  top.append(heading, tabs);

  const pricing = element("div", "dealerkit-product-gallery__pricing");
  pricing.setAttribute("data-product-gallery-pricing", "true");

  const galleryTop = element("div", "dealerkit-product-gallery__gallery-top");
  const galleryCopy = element("div", "");
  const galleryTitle = element("strong", "", "Product images");
  galleryTitle.setAttribute("data-product-gallery-title", "true");
  const gallerySubtitle = element("p", "", "");
  gallerySubtitle.setAttribute("data-product-gallery-subtitle", "true");
  galleryCopy.append(galleryTitle, gallerySubtitle);
  const primaryNote = element("span", "dealerkit-product-gallery__primary-note", "");
  primaryNote.setAttribute("data-product-gallery-primary-note", "true");
  galleryTop.append(galleryCopy, primaryNote);

  const manual = element("div", "dealerkit-product-gallery__manual-grid");
  manual.setAttribute("data-product-gallery-manual", "true");
  const upload = element("div", "");
  upload.setAttribute("data-product-gallery-upload", "true");

  const sourceHeading = element("div", "dealerkit-product-gallery__source-heading");
  sourceHeading.append(
    element("strong", "", "DealerKit source photos"),
    element("span", "", "Drag the cards to change their order. Untick Use image to remove a photo from this product only."),
  );
  const source = element("div", "dealerkit-product-gallery__source-grid");
  source.setAttribute("data-product-gallery-source", "true");

  const footer = element("div", "dealerkit-product-gallery__footer");
  const message = element("div", "dealerkit-product-gallery__message", "Nothing here publishes a vehicle. Save stores review and gallery choices only.");
  message.setAttribute("data-product-gallery-message", "true");
  const save = element("button", "dealerkit-product-gallery__save", "Save review & galleries");
  save.type = "button";
  save.setAttribute("data-product-gallery-save", "true");
  save.addEventListener("click", () => saveProductState(state));
  footer.append(message, save);

  root.append(top, pricing, galleryTop, manual, upload, sourceHeading, source, footer);
  return root;
}

async function initialiseWorkspace(workspace, body, registration) {
  const requestId = ++requestCounter;
  const existing = body.querySelector(`[${ROOT_ATTRIBUTE}]`);
  if (existing) existing.remove();
  const loading = element("section", "dealerkit-product-gallery is-loading", "Loading separate Van Finance and Rent2Buy galleries…");
  loading.setAttribute(ROOT_ATTRIBUTE, "true");
  loading.dataset.registration = registration;
  const hero = body.querySelector(".dealerkit-review__hero");
  if (hero) hero.insertAdjacentElement("afterend", loading);
  else body.prepend(loading);

  try {
    const payload = await apiJson(
      `/api/dealerkit-stock-detail?registration=${encodeURIComponent(registration)}`,
      {},
      "Could not load product gallery workspace.",
    );
    if (requestId !== requestCounter) return;
    const vehicle = payload.vehicle || {};
    const decision = payload.reviewDecision || {};
    const sourceIds = (vehicle.images || []).map((image) => clean(image.id)).filter(Boolean);
    const state = {
      workspace,
      body,
      root: null,
      registration,
      vehicle,
      local: payload.local || {},
      decision,
      sourceIds,
      imageState: copyMutableImageState(decodeDealerKitProductImageState(decision, sourceIds)),
      manualMedia: [],
      pendingUploads: { finance: null, rent2buy: null },
      activeProduct: "finance",
      dirty: false,
      saving: false,
      uploading: false,
      draggedImageId: "",
      message: "",
      messageTone: "",
    };
    await loadManualMedia(state, { quiet: true });
    if (requestId !== requestCounter) return;
    const root = buildRoot(state);
    state.root = root;
    loading.replaceWith(root);
    workspace._dealerKitProductGalleryState = state;
    hideLegacyImageUi(workspace, body);
    renderActiveProduct(state);
  } catch (error) {
    if (requestId !== requestCounter) return;
    loading.classList.add("is-error");
    loading.textContent = error?.message || "Could not load separate product galleries.";
  }
}

function scan() {
  if (renderingScan || typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  renderingScan = true;
  try {
    const workspace = document.querySelector(WORKSPACE_SELECTOR);
    if (!workspace || workspace.hidden) return;
    const body = workspace.querySelector("[data-dealerkit-review-body]");
    const registration = normaliseRegistration(workspace.querySelector("[data-dealerkit-review-title]")?.textContent);
    if (!body || !registration) return;

    hideLegacyImageUi(workspace, body);
    const current = body.querySelector(`[${ROOT_ATTRIBUTE}]`);
    if (current?.dataset.registration === registration && !current.classList.contains("is-loading")) return;
    if (current?.dataset.registration === registration && current.classList.contains("is-loading")) return;
    initialiseWorkspace(workspace, body, registration);
  } finally {
    renderingScan = false;
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
  window.addEventListener("popstate", scheduleScan);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
}
