import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";
import "../styles/dealerkit-wix-manual-media.css";

const ROOT_ATTRIBUTE = "data-dealerkit-wix-manual-media";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
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

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSavedMedia(root, media = []) {
  const list = root.querySelector("[data-manual-media-list]");
  if (!list) return;
  list.replaceChildren();
  if (!media.length) {
    list.appendChild(element("div", "dealerkit-manual-media__empty", "No manual Wix images staged for this vehicle yet."));
    return;
  }

  for (const item of media) {
    const row = element("article", "dealerkit-manual-media__saved");
    if (item.thumbnailUrl || item.url) {
      const image = document.createElement("img");
      image.src = item.thumbnailUrl || item.url;
      image.alt = `${item.purposeLabel || "Manual Wix"} image`;
      image.loading = "lazy";
      row.appendChild(image);
    }
    const copy = element("div", "dealerkit-manual-media__saved-copy");
    const top = element("div", "dealerkit-manual-media__saved-top");
    top.append(
      element("strong", "", item.purposeLabel || item.purpose || "Manual Wix image"),
      element("span", `dealerkit-manual-media__state ${item.ready ? "is-ready" : "is-pending"}`, item.operationStatus || "PENDING"),
    );
    copy.append(
      top,
      element("div", "dealerkit-manual-media__filename", item.displayName || item.wixFileId || "Wix Media image"),
      element("div", "dealerkit-manual-media__meta", [item.siteScope === "rent2buy" ? "Rent2Buy Wix" : "Van Finance Wix", formatSize(item.sizeInBytes)].filter(Boolean).join(" · ")),
    );
    row.appendChild(copy);
    list.appendChild(row);
  }
}

async function loadSavedMedia(root) {
  const registration = normaliseRegistration(root.dataset.registration);
  if (!registration) return;
  const list = root.querySelector("[data-manual-media-list]");
  if (list) list.replaceChildren(element("div", "dealerkit-manual-media__empty", "Checking staged Wix images…"));
  try {
    const response = await fetch(`/api/dealerkit-wix-manual-media?registration=${encodeURIComponent(registration)}`, {
      headers: buildMarketingAccessHeaders({ accept: "application/json" }),
      cache: "no-store",
    });
    const payload = await parseMarketingJsonResponse(response, "Could not load staged Wix images.");
    renderSavedMedia(root, payload.media || []);
  } catch (error) {
    if (list) list.replaceChildren(element("div", "dealerkit-manual-media__empty is-warning", error?.message || "Could not load staged Wix images."));
  }
}

function selectedPurposeLabel(select) {
  return select.options?.[select.selectedIndex]?.textContent || "Wix Media";
}

function validateClientFile(file) {
  if (!file) return "Choose an image first.";
  if (!ALLOWED_TYPES.has(clean(file.type).toLowerCase())) return "Choose a JPEG, PNG or WebP image.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "That image does not have a valid file size.";
  if (file.size > MAX_BYTES) return "Manual image uploads are limited to 10 MB at this stage.";
  return null;
}

function setStatus(root, text, state = "") {
  const status = root.querySelector("[data-manual-media-status]");
  if (!status) return;
  status.textContent = text;
  status.classList.remove("is-good", "is-warning", "is-busy");
  if (state) status.classList.add(state);
}

function createManualMediaPanel(registration) {
  const root = element("section", "dealerkit-manual-media");
  root.setAttribute(ROOT_ATTRIBUTE, "true");
  root.dataset.registration = registration;

  const heading = element("div", "dealerkit-manual-media__heading");
  const copy = element("div", "dealerkit-manual-media__copy");
  copy.append(
    element("span", "dealerkit-manual-media__eyebrow", "WIX MEDIA · MANUAL STAGING"),
    element("strong", "", "Upload a replacement / template image"),
    element("p", "", "For prepared showroom or Rent2Buy template images. The file goes directly from this browser to the chosen Wix Media library. Uploading does not attach it to a vehicle, alter categories or publish anything."),
  );
  const status = element("span", "dealerkit-manual-media__status", "MEDIA ONLY");
  status.setAttribute("data-manual-media-status", "true");
  heading.append(copy, status);

  const controls = element("div", "dealerkit-manual-media__controls");
  const destinationLabel = document.createElement("label");
  destinationLabel.textContent = "Destination";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Manual Wix image destination");
  select.innerHTML = `
    <option value="van_finance_replacement">Van Finance replacement image</option>
    <option value="rent2buy_template">Rent2Buy template / replacement image</option>
  `;
  destinationLabel.appendChild(select);

  const fileLabel = document.createElement("label");
  fileLabel.textContent = "Image";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
  input.setAttribute("aria-label", "Choose a replacement or template image");
  fileLabel.appendChild(input);

  const button = element("button", "dealerkit-manual-media__upload", "Upload to Wix Media");
  button.type = "button";
  button.disabled = true;
  controls.append(destinationLabel, fileLabel, button);

  const note = element("div", "dealerkit-manual-media__note", "JPEG, PNG or WebP · maximum 10 MB · vehicle publishing remains locked");
  const list = element("div", "dealerkit-manual-media__list");
  list.setAttribute("data-manual-media-list", "true");

  input.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    const issue = validateClientFile(file);
    button.disabled = Boolean(issue);
    setStatus(root, issue || "READY TO STAGE", issue ? "is-warning" : "is-good");
  });

  button.addEventListener("click", async () => {
    const file = input.files?.[0] || null;
    const issue = validateClientFile(file);
    if (issue) {
      setStatus(root, issue, "is-warning");
      return;
    }
    const currentRegistration = normaliseRegistration(root.dataset.registration);
    if (!currentRegistration) return;
    const purpose = select.value;
    const destination = selectedPurposeLabel(select);
    const approved = window.confirm(
      `Upload ${file.name} to ${destination} for ${currentRegistration}?\n\nThis uploads media only. It will NOT attach the image to a vehicle, create or update a Wix CMS row, alter categories, or publish anything.`,
    );
    if (!approved) return;

    input.disabled = true;
    select.disabled = true;
    button.disabled = true;
    button.textContent = "Preparing secure upload…";
    setStatus(root, "VERIFYING VEHICLE", "is-busy");

    try {
      const prepareResponse = await fetch("/api/dealerkit-wix-manual-media", {
        method: "POST",
        headers: buildMarketingAccessHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          action: "prepare_upload",
          registration: currentRegistration,
          purpose,
          fileName: file.name,
          mimeType: file.type,
          sizeInBytes: file.size,
        }),
      });
      const prepared = await parseMarketingJsonResponse(prepareResponse, "Could not prepare the Wix Media upload.");

      button.textContent = "Uploading to Wix Media…";
      setStatus(root, "UPLOADING MEDIA", "is-busy");
      const uploadResponse = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": prepared.mimeType || file.type },
        body: file,
      });
      const uploadPayload = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) {
        throw new Error(uploadPayload?.message || `Wix Media upload returned status ${uploadResponse.status}.`);
      }
      const wixFileId = clean(uploadPayload?.file?.id);
      if (!wixFileId) throw new Error("Wix accepted the upload but did not return a file ID.");

      button.textContent = "Verifying Wix image…";
      setStatus(root, "VERIFYING MEDIA", "is-busy");
      const registerResponse = await fetch("/api/dealerkit-wix-manual-media", {
        method: "POST",
        headers: buildMarketingAccessHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          action: "register_upload",
          registration: currentRegistration,
          purpose,
          wixFileId,
        }),
      });
      const registered = await parseMarketingJsonResponse(registerResponse, "Wix received the image, but the CRM could not verify it.");
      setStatus(root, registered.media?.ready ? "WIX MEDIA READY" : "WIX PROCESSING", registered.media?.ready ? "is-good" : "is-busy");
      input.value = "";
      await loadSavedMedia(root);
    } catch (error) {
      setStatus(root, error?.message || "UPLOAD BLOCKED", "is-warning");
    } finally {
      input.disabled = false;
      select.disabled = false;
      button.textContent = "Upload to Wix Media";
      button.disabled = !input.files?.[0];
    }
  });

  root.append(heading, controls, note, list);
  queueMicrotask(() => loadSavedMedia(root));
  return root;
}

function installPanel() {
  if (typeof window === "undefined" || window.location.pathname !== "/vansco-stock-watch") return;
  const publishPanel = document.querySelector("[data-dealerkit-wix-publish-preview]");
  if (!publishPanel) return;
  const registration = normaliseRegistration(publishPanel.dataset.registration);
  if (!registration) return;

  let root = publishPanel.querySelector(`[${ROOT_ATTRIBUTE}]`);
  if (!root) {
    root = createManualMediaPanel(registration);
    const result = publishPanel.querySelector("[data-dealerkit-wix-preview-result]");
    if (result) result.insertAdjacentElement("beforebegin", root);
    else publishPanel.appendChild(root);
  } else if (root.dataset.registration !== registration) {
    root.dataset.registration = registration;
    const input = root.querySelector('input[type="file"]');
    if (input) input.value = "";
    setStatus(root, "MEDIA ONLY");
    loadSavedMedia(root);
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
