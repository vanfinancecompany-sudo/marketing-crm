import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";
import { convertWixImage } from "../services/marketingVehicleContract.js";
import { WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

const ATTRIBUTE = "data-wix-advert-image-editor";
let activeRequest = 0;

function node(tag, className = "", text = "") {
  const result = document.createElement(tag);
  result.className = className;
  if (text) result.textContent = text;
  return result;
}

async function api(state, action, extra = {}) {
  const response = await fetch("/api/wix-advert-images", {
    method: "POST", headers: buildMarketingAccessHeaders({ "content-type": "application/json", accept: "application/json" }),
    cache: "no-store", body: JSON.stringify({ action, registration: state.registration, pipeline: state.pipeline, ...extra }),
  });
  return parseMarketingJsonResponse(response, "Wix images could not be verified.");
}

function draftKey(state) { return "wix-advert-images:" + state.pipeline + ":" + state.registration; }
function message(state, text) { state.message.textContent = text; }

function changed(state) {
  state.draft.confirmation = null;
  state.hasLocalChanges = true;
  state.confirmInput.value = "";
  state.confirmCheck.checked = false;
  message(state, "Proposed images changed locally. Prepare and confirm reconciliation to update Wix.");
  render(state);
}

export function render(state) {
  const { draft } = state;
  state.gallery.replaceChildren();
  draft.items.forEach((item, index) => {
    const card = node("figure", "dealerkit-review__image-card");
    card.draggable = !state.busy;
    card.dataset.imageKey = item.key;
    const image = node("img");
    image.src = item.src;
    image.alt = "Wix gallery image " + (index + 1);
    card.append(image, node("figcaption", "", "#" + (index + 1) + (index === 0 ? (state.hasLocalChanges ? " · Primary in proposed gallery" : " · Current gallery primary") : "") + (item.kind === "upload" ? " · New upload" : "")));
    const controls = node("div", "dealerkit-review__image-actions");
    const remove = node("button", "dealerkit-review__image-primary", "Remove from proposed gallery");
    remove.type = "button"; remove.disabled = state.busy;
    remove.addEventListener("click", () => { removeWixImage(draft, item.key); changed(state); });
    controls.appendChild(remove);
    card.appendChild(controls);
    card.addEventListener("dragstart", (event) => {
      if (state.busy) return;
      state.draggedKey = item.key;
      event.dataTransfer?.setData("text/plain", item.key);
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      if (state.busy) return;
      moveWixImage(draft, state.draggedKey || event.dataTransfer?.getData("text/plain"), item.key);
      changed(state);
    });
    // Keyboard-accessible alternatives to dragging.
    for (const [label, target] of [["Move earlier", index - 1], ["Move later", index + 1]]) {
      const move = node("button", "dealerkit-review__image-primary", label);
      move.type = "button"; move.disabled = state.busy || target < 0 || target >= draft.items.length;
      move.addEventListener("click", () => { moveWixImage(draft, item.key, draft.items[target].key); changed(state); });
      controls.appendChild(move);
    }
    state.gallery.appendChild(card);
  });
  if (!draft.items.length) state.gallery.appendChild(node("p", "", "The proposed gallery is empty. Add an image before reconciling."));
  state.prepareButton.disabled = state.busy || !draft.items.length || Boolean(state.pendingUpload);
  state.reconcileButton.disabled = state.busy || !draft.confirmation || !state.confirmCheck.checked
    || state.confirmInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "") !== state.registration;
  state.uploadButton.disabled = state.busy || Boolean(state.pendingUpload);
  state.saveButton.disabled = state.busy;
  state.uploadInput.disabled = state.busy || Boolean(state.pendingUpload);
  state.recheckButton.hidden = !state.pendingUpload;
  state.recheckButton.disabled = state.busy;
}

export async function finishUpload(state) {
  if (!state.pendingUpload) return;
  const uploaded = await api(state, "finishUpload", state.pendingUpload);
  if (!uploaded.ready) { message(state, "Wix Media reports " + uploaded.status + ". Recheck when ready; the live advert is unchanged."); return; }
  appendWixImage(state.draft, uploaded);
  state.pendingUpload = null;
  state.uploadInput.value = "";
  changed(state);
  message(state, "Uploaded to Wix Media and appended to the proposed gallery. Gallery position #1 is unchanged.");
}

export async function uploadImage(state, file) {
  if (!file) throw new Error("Choose an image first.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP image up to 10 MB.");
  }
  const prepared = await api(state, "prepareUpload", { fileName: file.name, mimeType: file.type, sizeInBytes: file.size });
  const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.mimeType }, body: file });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.file?.id) throw new Error("Wix Media upload did not return a verified file ID.");
  state.pendingUpload = { fileId: payload.file.id, uploadTicket: prepared.uploadTicket };
  await finishUpload(state);
}

export async function prepareReconciliation(state) {
  state.draft.confirmation = null;
  state.confirmInput.value = "";
  state.confirmCheck.checked = false;
  const result = await api(state, "prepare", wixImageProposal(state.draft));
  state.draft.confirmation = result.confirmation;
  message(state, "Prepared " + result.gallery.length + " images. Gallery #1 becomes the listing picture. Type the registration and confirm to reconcile.");
}

export async function reconcileImages(state) {
  if (!state.draft.confirmation || !state.confirmCheck.checked
    || state.confirmInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "") !== state.registration) throw new Error("Prepare, type the registration and confirm before reconciling.");
  const result = await api(state, "reconcile", { ...wixImageProposal(state.draft), confirmation: state.draft.confirmation,
    confirmRegistration: state.confirmInput.value, confirmed: true });
  state.draft = createWixImageDraft(result.snapshot);
  state.hasLocalChanges = false;
  state.confirmInput.value = ""; state.confirmCheck.checked = false;
  try { localStorage.removeItem(draftKey(state)); } catch {}
  showCurrent(state);
  message(state, "Verified: the exact ordered Wix gallery and listing picture were updated. Other vehicle fields were unchanged.");
  window.dispatchEvent(new CustomEvent("wix-advert-images-reconciled", { detail: { registration: state.registration, pipeline: state.pipeline } }));
}

function showCurrent(state) {
  const snapshot = state.draft.snapshot;
  state.current.replaceChildren(node("strong", "dealerkit-review__current-image-label", "Current listing picture"));
  const picture = convertWixImage(typeof snapshot.picture === "string" ? snapshot.picture : snapshot.picture?.url || snapshot.picture?.src || "");
  if (picture) { const image = node("img"); image.src = picture; image.alt = "Current Wix listing picture"; state.current.appendChild(image); }
  state.current.appendChild(node("div", "dealerkit-review__facts", "Published Wix advert · " + (snapshot.priceText || snapshot.monthly || "Price unavailable")));
}

function saveDraft(state) {
  localStorage.setItem(draftKey(state), JSON.stringify({ baseline: state.draft.snapshot.baseline, items: state.draft.items }));
  message(state, "Draft saved locally. No Wix listing or detail fields were written.");
}

async function run(state, action) {
  if (state.busy) return;
  state.busy = true; render(state);
  try { await action(); } catch (error) { state.draft.confirmation = null; message(state, error.message || "Wix image action failed."); }
  finally { state.busy = false; render(state); }
}

export async function openWixImageEditor(registrationInput, pipeline) {
  const registration = String(registrationInput || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  if (!registration || !lane) throw new Error("A verified Wix vehicle and lane are required.");
  const requestId = ++activeRequest;
  document.querySelector("[" + ATTRIBUTE + "]")?.remove();
  const overlay = node("div", "dealerkit-review");
  overlay.setAttribute(ATTRIBUTE, "true");
  const shade = node("button", "dealerkit-review__shade");
  shade.type = "button"; shade.setAttribute("aria-label", "Close Wix image editor");
  const panel = node("aside", "dealerkit-review__panel");
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Current Wix images");
  const header = node("header", "dealerkit-review__header");
  const heading = node("div", "dealerkit-review__heading");
  heading.append(node("strong", "dealerkit-review__title", registration + " · " + lane.label), node("span", "", "Current Wix images"));
  const close = node("button", "dealerkit-review__close", "Close");
  close.type = "button";
  const closeEditor = () => { activeRequest += 1; overlay.remove(); document.body.classList.remove("dealerkit-review-open"); };
  shade.addEventListener("click", closeEditor); close.addEventListener("click", closeEditor);
  header.append(heading, close);
  const body = node("div", "dealerkit-review__body");
  body.appendChild(node("p", "", "Reading the published Wix listing and detail gallery…"));
  panel.append(header, body); overlay.append(shade, panel); document.body.appendChild(overlay);
  document.body.classList.add("dealerkit-review-open");
  const state = { registration, pipeline, overlay, body, busy: false, pendingUpload: null };
  try {
    const snapshot = await api(state, "load");
    if (requestId !== activeRequest) return;
    state.draft = createWixImageDraft(snapshot);
    body.replaceChildren();
    state.current = node("section", "dealerkit-review__hero"); showCurrent(state);
    const gallerySection = node("section", "dealerkit-review__section");
    gallerySection.append(node("h3", "", "Current Wix images"), node("p", "", "Loaded in the exact stored order. #1 is the gallery primary. Drag images to reorder the proposed gallery; the live advert changes only after confirmed Reconcile."));
    state.gallery = node("div", "dealerkit-review__gallery");
    gallerySection.appendChild(state.gallery);
    const uploadSection = node("section", "dealerkit-review__section");
    uploadSection.appendChild(node("h3", "", "Add an image to Wix Media"));
    state.uploadInput = node("input"); state.uploadInput.type = "file"; state.uploadInput.accept = "image/jpeg,image/png,image/webp";
    state.uploadInput.setAttribute("aria-label", "Choose a Wix gallery image");
    state.uploadButton = node("button", "dealerkit-review__save", "Upload and append");
    state.uploadButton.type = "button";
    state.uploadButton.addEventListener("click", () => run(state, () => uploadImage(state, state.uploadInput.files?.[0])));
    state.recheckButton = node("button", "dealerkit-review__save", "Recheck uploaded image");
    state.recheckButton.type = "button"; state.recheckButton.addEventListener("click", () => run(state, () => finishUpload(state)));
    uploadSection.append(state.uploadInput, state.uploadButton, state.recheckButton);
    const confirm = node("section", "dealerkit-review__section");
    state.saveButton = node("button", "dealerkit-review__save", "Save draft locally");
    state.saveButton.type = "button"; state.saveButton.addEventListener("click", () => run(state, () => saveDraft(state)));
    state.prepareButton = node("button", "dealerkit-review__save", "Prepare reconciliation");
    state.prepareButton.type = "button"; state.prepareButton.addEventListener("click", () => run(state, () => prepareReconciliation(state)));
    const typedLabel = node("label", "dealerkit-review__field", "Type " + registration + " to reconcile");
    state.confirmInput = node("input"); state.confirmInput.type = "text"; state.confirmInput.autocomplete = "off"; state.confirmInput.addEventListener("input", () => render(state));
    typedLabel.appendChild(state.confirmInput);
    const checkLabel = node("label", "dealerkit-review__image-toggle");
    state.confirmCheck = node("input"); state.confirmCheck.type = "checkbox"; state.confirmCheck.addEventListener("change", () => render(state));
    checkLabel.append(state.confirmCheck, node("span", "", "Update only this Wix gallery and listing picture"));
    state.reconcileButton = node("button", "dealerkit-review__save", "Reconcile advert images");
    state.reconcileButton.type = "button"; state.reconcileButton.addEventListener("click", () => run(state, () => reconcileImages(state)));
    state.message = node("p", "dealerkit-review__section-note", "Save and Prepare keep the live advert unchanged.");
    confirm.append(state.saveButton, state.prepareButton, typedLabel, checkLabel, state.reconcileButton, state.message);
    body.append(state.current, gallerySection, uploadSection, confirm);
    // A saved draft is offered explicitly, never substituted for the live gallery on opening.
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey(state)) || "null");
      if (saved?.baseline === snapshot.baseline && Array.isArray(saved.items)) {
        const restore = node("button", "dealerkit-review__save", "Restore local draft");
        restore.type = "button";
        restore.addEventListener("click", () => run(state, async () => {
          const proposal = { baseline: saved.baseline, images: saved.items.map((item) => item.kind === "existing"
            ? { kind: "existing", index: item.index } : { kind: "upload", token: item.token }) };
          const verified = await api(state, "prepare", proposal);
          state.draft.items = saved.items.map((item, index) => ({ ...item, src: convertWixImage(wixGalleryImageSource(verified.gallery[index])) }));
          changed(state); restore.remove();
        }));
        confirm.prepend(restore);
      }
    } catch {}
    overlay._wixImageEditorState = state;
    render(state);
    return state;
  } catch (error) {
    if (requestId !== activeRequest) return;
    body.replaceChildren(node("p", "dealerkit-review__error", error.message || "Wix gallery could not be verified. No images were changed."));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("wix-open-advert-image-editor", (event) => {
    const detail = event.detail || {};
    openWixImageEditor(detail.registration, detail.pipeline).catch(() => null);
  });
}
