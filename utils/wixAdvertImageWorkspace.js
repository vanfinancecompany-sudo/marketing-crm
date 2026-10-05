import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";
import { convertWixImage } from "../services/marketingVehicleContract.js";
import { WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

const ATTRIBUTE = "data-wix-advert-image-editor";
let activeRequest = 0;

async function requestJson(url, options, fallback) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return await parseMarketingJsonResponse(response, fallback);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Wix request timed out. Please try again.");
    throw error;
  } finally { clearTimeout(timer); }
}

function node(tag, className = "", text = "") {
  const result = document.createElement(tag);
  result.className = className;
  if (text) result.textContent = text;
  return result;
}

async function api(state, action, extra = {}) {
  return requestJson("/api/wix-advert-images", {
    method: "POST", headers: buildMarketingAccessHeaders({ "content-type": "application/json", accept: "application/json" }),
    cache: "no-store", body: JSON.stringify({ action, registration: state.registration, pipeline: state.pipeline, ...extra }),
  }, "Wix images could not be verified.");
}

function message(state, text, kind = "info") {
  state.message.dataset.kind = kind;
  state.message.className = "wix-image-review__notice wix-image-review__notice--" + kind;
  state.message.setAttribute("role", kind === "error" ? "alert" : "status");
  state.message.textContent = text;
}

function changed(state) {
  state.prepared = null;
  state.draft.confirmation = null;
  state.hasLocalChanges = true;
  message(state, "Changes are ready to review. Click Update Wix images when finished.");
  render(state);
}

function renderDestinations(state) {
  state.destinations.replaceChildren();
  state.destinationInputs = [];
  for (const destination of state.draft.snapshot.destinations) {
    const label = node("label", "dealerkit-review__check" + (destination.required ? " dealerkit-review__check--fixed" : ""));
    const input = node("input");
    input.type = "checkbox";
    input.checked = true;
    input.disabled = true;
    input.dataset.collectionId = destination.collectionId;
    const text = node("span", "wix-image-review__destination", destination.label + (destination.required ? " · Required" : ""));
    text.appendChild(node("small", "", destination.collectionId + "." + destination.imageField));
    label.append(input, text);
    state.destinations.appendChild(label);
    state.destinationInputs.push(input);
  }
}

function renderConfirmation(state) {
  state.confirmationPanel.replaceChildren();
  state.confirmationPanel.hidden = !state.prepared;
  state.confirmButton = null;
  if (!state.prepared) return;
  const prepared = state.prepared;
  state.confirmationPanel.appendChild(node("h3", "", "Update Wix images?"));
  const preview = node("div", "wix-image-review__confirmation-preview");
  const image = node("img");
  image.src = convertWixImage(prepared.picture);
  image.alt = "Primary image to publish";
  const facts = node("div");
  facts.append(node("strong", "", prepared.gallery.length + " images · image #1 is Primary"),
    node("p", "", "Vehicle gallery: " + prepared.galleryDestination.label),
    node("small", "", prepared.galleryDestination.collectionId + "." + prepared.galleryDestination.field));
  preview.append(image, facts); state.confirmationPanel.appendChild(preview);
  state.confirmationPanel.appendChild(node("p", "", prepared.primaryChanged === false
    ? "The primary image is unchanged. Listing and category images will be kept."
    : "The primary image will be used in these existing Wix sections:"));
  const list = node("ul");
  for (const destination of prepared.destinations.filter((item) => prepared.primaryChanged !== false && item.selected)) {
    list.appendChild(node("li", "", destination.label + " · " + destination.collectionId + "." + destination.imageField));
  }
  state.confirmationPanel.appendChild(list);
  const controls = node("div", "dealerkit-review__decision-footer");
  const back = node("button", "dealerkit-review__close", "Back to images");
  back.type = "button"; back.disabled = state.busy;
  back.addEventListener("click", () => {
    state.prepared = null; state.draft.confirmation = null;
    message(state, "Review your images, then click Update Wix images.");
    render(state); state.updateButton.focus?.();
  });
  state.confirmButton = node("button", "dealerkit-review__save", state.busy ? "Updating Wix…" : "Confirm update");
  state.confirmButton.type = "button"; state.confirmButton.disabled = state.busy;
  state.confirmButton.addEventListener("click", () => run(state, () => reconcileImages(state)));
  controls.append(back, state.confirmButton); state.confirmationPanel.appendChild(controls);
}

export function render(state) {
  state.gallery.replaceChildren();
  state.draft.items.forEach((item, index) => {
    const card = node("figure", "dealerkit-review__image-card" + (index === 0 ? " is-primary" : ""));
    card.draggable = !state.busy && !state.requiresReload;
    card.dataset.imageKey = item.key;
    const image = node("img"); image.src = item.src; image.alt = "Wix gallery image " + (index + 1);
    card.append(image, node("figcaption", "", "#" + (index + 1) + (index === 0 ? " · Primary" : "") + (item.kind === "upload" ? " · New upload" : "")));
    const controls = node("div", "dealerkit-review__image-actions");
    const remove = node("button", "dealerkit-review__image-primary", "Remove");
    remove.type = "button"; remove.disabled = state.busy || state.requiresReload;
    remove.addEventListener("click", () => { removeWixImage(state.draft, item.key); changed(state); });
    controls.appendChild(remove);
    card.appendChild(controls);
    card.addEventListener("dragstart", (event) => {
      if (state.busy || state.requiresReload) return;
      state.draggedKey = item.key; event.dataTransfer?.setData("text/plain", item.key);
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      if (state.busy || state.requiresReload) return;
      moveWixImage(state.draft, state.draggedKey || event.dataTransfer?.getData("text/plain"), item.key);
      state.draggedKey = null; changed(state);
    });
    for (const [label, target] of [["Move earlier", index - 1], ["Move later", index + 1]]) {
      const move = node("button", "dealerkit-review__image-primary", label);
      move.type = "button"; move.disabled = state.busy || state.requiresReload || target < 0 || target >= state.draft.items.length;
      move.addEventListener("click", () => { moveWixImage(state.draft, item.key, state.draft.items[target].key); changed(state); });
      controls.appendChild(move);
    }
    state.gallery.appendChild(card);
  });
  state.galleryHeading.textContent = "Current Wix images (" + state.draft.items.length + ")";
  state.galleryNote.textContent = state.hasLocalChanges
    ? "Proposed order — changes have not been saved to Wix. Image #1 will be Primary."
    : "Current published order. Image #1 is Primary. Drag images to reorder, or upload additional images.";
  if (!state.draft.items.length) state.gallery.appendChild(node("p", "", "Add at least one image before updating Wix."));
  renderDestinations(state);
  renderConfirmation(state);
  state.updateButton.hidden = Boolean(state.prepared);
  const pendingUploadCount = state.pendingUploads?.length || 0;
  state.updateButton.disabled = state.busy || state.requiresReload || !state.draft.items.length || pendingUploadCount > 0;
  state.updateButton.textContent = state.busy ? "Checking Wix…" : "Update Wix images";
  state.uploadButton.disabled = state.busy || state.requiresReload || pendingUploadCount > 0;
  state.uploadInput.disabled = state.uploadButton.disabled;
  state.recheckButton.hidden = pendingUploadCount === 0;
  state.recheckButton.disabled = state.busy || state.requiresReload;
  state.cancelButton.disabled = state.busy;
  state.closeButton.disabled = state.busy;
}

export async function finishUploads(state) {
  const pendingUploads = Array.isArray(state.pendingUploads) ? state.pendingUploads : [];
  if (!pendingUploads.length) return;
  const uploadedImages = await Promise.all(pendingUploads.map((pending) => api(state, "finishUpload", pending)));
  const waiting = uploadedImages.filter((uploaded) => !uploaded.ready).length;
  if (waiting) {
    message(state, `${waiting} of ${pendingUploads.length} uploaded image${pendingUploads.length === 1 ? "" : "s"} ${waiting === 1 ? "is" : "are"} still processing in Wix Media. Recheck when ready; the advert is unchanged.`);
    return;
  }
  uploadedImages.forEach((uploaded) => appendWixImage(state.draft, uploaded));
  state.pendingUploads = []; state.uploadInput.value = "";
  changed(state);
  message(state, `${uploadedImages.length} image${uploadedImages.length === 1 ? "" : "s"} added. The primary image is unchanged. Click Update Wix images when ready.`);
}

export async function uploadImages(state, files) {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) return;
  if (state.draft.items.length + selectedFiles.length > 80) {
    throw new Error(`This advert can contain up to 80 images. Choose no more than ${Math.max(0, 80 - state.draft.items.length)} additional image${80 - state.draft.items.length === 1 ? "" : "s"}.`);
  }
  selectedFiles.forEach((file) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new Error(`${file.name || "One selected file"} is not a JPEG, PNG or WebP image up to 10 MB.`);
    }
  });
  message(state, `Uploading ${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} to Wix Media…`);
  state.pendingUploads = await Promise.all(selectedFiles.map(async (file) => {
    const prepared = await api(state, "prepareUpload", { fileName: file.name, mimeType: file.type, sizeInBytes: file.size });
    if (!prepared.uploadUrl || !prepared.mimeType || !prepared.fileName || !prepared.uploadTicket) {
      throw new Error(`Wix did not return a complete upload session for ${file.name || "one selected image"}.`);
    }
    const payload = await requestJson(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.mimeType }, body: file }, "Wix Media upload failed.");
    if (typeof payload.file?.id !== "string" || !payload.file.id) throw new Error(`Wix Media did not return a verified file ID for ${file.name || "one selected image"}.`);
    return { fileId: payload.file.id, uploadTicket: prepared.uploadTicket };
  }));
  await finishUploads(state);
}

// Keep the original single-image helpers callable for older tests/integrations while
// routing all UI behaviour through the new batch implementation.
export async function uploadImage(state, file) {
  return uploadImages(state, file ? [file] : []);
}

export async function finishUpload(state) {
  return finishUploads(state);
}

export async function prepareReconciliation(state) {
  state.prepared = null; state.draft.confirmation = null;
  message(state, "Checking the current Wix advert…");
  const input = wixImageProposal(state.draft);
  const result = await api(state, "prepare", input);
  if (!result.confirmation || !Array.isArray(result.gallery) || !result.gallery.length
    || !Array.isArray(result.destinations) || !result.galleryDestination) throw new Error("Wix did not return a verified update summary.");
  state.draft.snapshot.destinations = result.destinations;
  state.prepared = { ...result, input };
  state.draft.confirmation = result.confirmation;
  message(state, "Review the summary below, then Confirm update.");
}

function matchesPrepared(snapshot, prepared) {
  const sources = (gallery) => Array.isArray(gallery) ? gallery.map(wixGalleryImageSource) : [];
  if (JSON.stringify(sources(snapshot.gallery)) !== JSON.stringify(sources(prepared.gallery))
    || wixGalleryImageSource(snapshot.picture) !== (prepared.primaryChanged === false ? wixGalleryImageSource(prepared.currentPicture) : prepared.picture)
    || String(snapshot.imageCount?.value) !== String(prepared.gallery.length)) return false;
  return prepared.destinations.filter((item) => prepared.primaryChanged !== false && item.selected).every((destination) => {
    const actual = snapshot.destinations?.find((item) => item.collectionId === destination.collectionId && item.itemId === destination.itemId);
    return actual && wixGalleryImageSource(actual.currentImage) === prepared.picture;
  });
}

export async function reconcileImages(state) {
  const prepared = state.prepared;
  if (!prepared?.confirmation) throw new Error("Click Update Wix images and review the summary before confirming.");
  message(state, "Updating Wix images and checking the saved result…");
  const result = await api(state, "reconcile", { ...prepared.input, confirmation: prepared.confirmation, confirmed: true });
  if (result.verified !== true) { state.requiresReload = true; throw new Error("Wix could not verify the image update. Reopen the advert before retrying."); }
  state.prepared = null; state.draft.confirmation = null;
  state.requiresReload = true;
  const snapshot = result.snapshot;
  if (!snapshot || !matchesPrepared(snapshot, prepared)) throw new Error("Wix saved result did not match the confirmed primary, gallery order, count or destinations. Reopen this advert to check the saved result.");
  applySnapshot(state, snapshot);
  message(state, "✓ Wix images updated successfully", "success");
  window.dispatchEvent(new CustomEvent("wix-advert-images-reconciled", { detail: { registration: state.registration, pipeline: state.pipeline } }));
}

function showCurrent(state) {
  const snapshot = state.draft.snapshot;
  state.title.textContent = snapshot.registration + " · " + WIX_ADVERT_IMAGE_LANES[state.pipeline].label;
  state.subtitle.textContent = snapshot.title || "Published Wix vehicle";
  state.current.replaceChildren(node("strong", "dealerkit-review__current-image-label", "Current primary image"));
  const picture = convertWixImage(wixGalleryImageSource(snapshot.picture));
  if (picture) { const image = node("img"); image.src = picture; image.alt = "Current published Wix primary image"; state.current.appendChild(image); }
  const facts = node("div", "dealerkit-review__facts wix-image-review__facts");
  const advert = node("div", "dealerkit-review__detail");
  advert.append(node("span", "", "Current published Wix advert"), node("strong", "", "Published · " + WIX_ADVERT_IMAGE_LANES[state.pipeline].label));
  if (/^https?:\/\//i.test(snapshot.advertUrl || "")) {
    const link = node("a", "dealerkit-review__link", "Open current advert");
    link.href = snapshot.advertUrl; link.target = "_blank"; link.rel = "noreferrer";
    advert.appendChild(link);
  }
  const price = node("div", "dealerkit-review__detail");
  price.append(node("span", "", "Current Wix price"), node("strong", "", snapshot.priceText || snapshot.monthly || "Price unavailable"));
  facts.append(advert, price); state.current.appendChild(facts);
}

function applySnapshot(state, snapshot) {
  if (!Array.isArray(snapshot.destinations) || !snapshot.destinations.some((item) => item.required && item.collectionId === snapshot.listingCollection)) {
    throw new Error("The published Wix sections could not be verified. No update is available.");
  }
  state.draft = createWixImageDraft(snapshot);
  state.requiresReload = false; state.hasLocalChanges = false; state.prepared = null;
  showCurrent(state);
}

async function run(state, action) {
  if (state.busy) return;
  state.busy = true; render(state);
  try { await action(); }
  catch (error) {
    state.prepared = null; state.draft.confirmation = null;
    message(state, error.message || "Wix image update failed.", "error");
  } finally {
    state.busy = false; render(state);
    if (state.prepared) { state.confirmationPanel.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); state.confirmButton?.focus?.(); }
    else if (["success", "error"].includes(state.message.dataset.kind)) {
      state.message.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }
}

export async function openWixImageEditor(registrationInput, pipeline) {
  const registration = String(registrationInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  if (!registration || !lane) throw new Error("A verified Wix vehicle and lane are required.");
  const requestId = ++activeRequest;
  document.querySelector("[" + ATTRIBUTE + "]")?.remove();
  const overlay = node("div", "dealerkit-review"); overlay.setAttribute(ATTRIBUTE, "true");
  const shade = node("button", "dealerkit-review__shade"); shade.type = "button"; shade.setAttribute("aria-label", "Close Wix image review");
  const panel = node("aside", "dealerkit-review__panel");
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Review vehicle — Wix images");
  const header = node("header", "dealerkit-review__header");
  const heading = node("div", "dealerkit-review__heading");
  const title = node("strong", "dealerkit-review__title", registration);
  const subtitle = node("span", "dealerkit-review__subtitle", "Loading published Wix advert…");
  heading.append(node("span", "dealerkit-review__eyebrow", "REVIEW VEHICLE"), title, subtitle);
  const close = node("button", "dealerkit-review__close", "Close"); close.type = "button";
  const body = node("div", "dealerkit-review__body");
  body.appendChild(node("p", "dealerkit-review__loading", "Loading current Wix images and published sections…"));
  panel.append(header, body); header.append(heading, close); overlay.append(shade, panel); document.body.appendChild(overlay);
  document.body.classList.add("dealerkit-review-open");
  const state = { registration, pipeline, overlay, body, title, subtitle, closeButton: close, busy: false, pendingUploads: [], requiresReload: false };
  const closeEditor = () => { if (state.busy) return; activeRequest += 1; overlay.remove(); document.body.classList.remove("dealerkit-review-open"); };
  shade.addEventListener("click", closeEditor); close.addEventListener("click", closeEditor);
  try {
    const snapshot = await api(state, "load");
    if (requestId !== activeRequest) return;
    body.replaceChildren();
    state.message = node("p", "wix-image-review__notice"); state.message.setAttribute("aria-live", "polite");
    state.current = node("section", "dealerkit-review__hero");
    const gallerySection = node("section", "dealerkit-review__section");
    state.galleryHeading = node("h3"); state.galleryNote = node("p", "dealerkit-review__section-note");
    state.gallery = node("div", "dealerkit-review__gallery");
    const upload = node("div", "wix-image-review__upload");
    state.uploadInput = node("input"); state.uploadInput.type = "file"; state.uploadInput.accept = "image/jpeg,image/png,image/webp"; state.uploadInput.multiple = true;
    state.uploadInput.hidden = true; state.uploadInput.setAttribute("aria-label", "Upload additional Wix images");
    state.uploadInput.addEventListener("change", () => run(state, async () => {
      try { await uploadImages(state, state.uploadInput.files); } finally { state.uploadInput.value = ""; }
    }));
    state.uploadButton = node("button", "dealerkit-review__close", "Upload additional images"); state.uploadButton.type = "button";
    state.uploadButton.addEventListener("click", () => state.uploadInput.click());
    state.recheckButton = node("button", "dealerkit-review__close", "Recheck uploaded images"); state.recheckButton.type = "button";
    state.recheckButton.addEventListener("click", () => run(state, () => finishUploads(state)));
    upload.append(state.uploadInput, state.uploadButton, state.recheckButton);
    gallerySection.append(state.galleryHeading, state.galleryNote, state.gallery, upload);
    const sections = node("section", "dealerkit-review__section dealerkit-review__decisions");
    sections.append(node("h3", "", "Wix primary image destinations"),
      node("p", "dealerkit-review__section-note", "Changing image #1 updates the listing and all verified published category images. Categories are checked when you review a primary change. Adding images keeps the current primary."));
    state.destinations = node("div", "dealerkit-review__category-grid"); sections.appendChild(state.destinations);
    sections.appendChild(node("p", "dealerkit-review__routing-note", "The vehicle gallery is always updated: " + snapshot.detailCollection + "." + snapshot.galleryField));
    state.confirmationPanel = node("section", "dealerkit-review__section wix-image-review__confirmation"); state.confirmationPanel.hidden = true;
    const footer = node("div", "wix-image-review__footer");
    state.cancelButton = node("button", "dealerkit-review__close", "Cancel"); state.cancelButton.type = "button";
    state.cancelButton.addEventListener("click", closeEditor);
    state.updateButton = node("button", "dealerkit-review__save", "Update Wix images"); state.updateButton.type = "button";
    state.updateButton.addEventListener("click", () => run(state, () => prepareReconciliation(state)));
    footer.append(state.cancelButton, state.updateButton);
    body.append(state.message, state.current, gallerySection, sections, state.confirmationPanel, footer);
    applySnapshot(state, snapshot);
    message(state, "Choose your images, then click Update Wix images.");
    overlay._wixImageEditorState = state;
    render(state);
    return state;
  } catch (error) {
    if (requestId !== activeRequest) return;
    body.replaceChildren(node("p", "dealerkit-review__error wix-image-review__notice--error", error.message || "Wix images could not be verified. No update is available."));
    body.firstElementChild?.setAttribute("role", "alert");
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("wix-open-advert-image-editor", (event) => {
    const detail = event.detail || {};
    openWixImageEditor(detail.registration, detail.pipeline).catch(() => null);
  });
}
