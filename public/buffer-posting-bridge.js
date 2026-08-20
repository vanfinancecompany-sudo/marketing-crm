const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";
const SUPPORTED_DESTINATIONS = new Set([
  "Van Finance Facebook",
  "Rent2Buy Facebook",
]);

function storedAccessKey() {
  try {
    return localStorage.getItem(ACCESS_STORAGE_KEY) || sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function normalizeRegistration(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/\b([A-Z]{2}\d{2}\s?[A-Z]{3}|[A-Z]\d{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?\d{1,3}[A-Z]|\d{1,4}\s?[A-Z]{1,3})\b/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function currentDestination() {
  const visibleTag = [...document.querySelectorAll(".posting-destination-tag")]
    .map((node) => node.textContent?.trim())
    .find((value) => SUPPORTED_DESTINATIONS.has(value));
  if (visibleTag) return visibleTag;

  const bodyText = document.body?.innerText || "";
  if (bodyText.includes("Rent2Buy Facebook")) return "Rent2Buy Facebook";
  if (bodyText.includes("Van Finance Facebook")) return "Van Finance Facebook";
  return "";
}

function registrationForCard(card) {
  const caption = card.querySelector(".posting-card__caption")?.textContent || "";
  const fromCaption = normalizeRegistration(caption);
  if (fromCaption) return fromCaption;

  for (const tag of card.querySelectorAll(".tag")) {
    const registration = normalizeRegistration(tag.textContent);
    if (registration) return registration;
  }

  return normalizeRegistration(card.textContent);
}

function buildCaptionMap() {
  const result = new Map();
  for (const card of document.querySelectorAll(".posting-card")) {
    const registration = registrationForCard(card);
    const caption = card.querySelector(".posting-card__caption")?.textContent?.trim() || "";
    if (registration && caption) result.set(registration, caption);
  }
  return result;
}

function showToast(message, isError = false) {
  let toast = document.getElementById("bufferDraftToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "bufferDraftToast";
    Object.assign(toast.style, {
      position: "fixed",
      right: "22px",
      bottom: "22px",
      zIndex: "99999",
      maxWidth: "420px",
      padding: "13px 16px",
      borderRadius: "12px",
      fontWeight: "800",
      boxShadow: "0 18px 50px rgba(0,0,0,.35)",
    });
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.background = isError ? "#5b1720" : "#13251a";
  toast.style.border = `1px solid ${isError ? "#a63a49" : "#2f6f45"}`;
  toast.style.color = "#fff";
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function createBufferDraft(card, button) {
  const accessKey = storedAccessKey();
  if (!accessKey) {
    showToast("Open and unlock the Marketing CRM first, then try Buffer again.", true);
    return;
  }

  const destination = currentDestination();
  if (!SUPPORTED_DESTINATIONS.has(destination)) return;

  const registration = registrationForCard(card);
  const captionMap = buildCaptionMap();
  const text = card.querySelector(".posting-card__caption")?.textContent?.trim()
    || captionMap.get(registration)
    || "";
  const imageUrl = card.querySelector("img.posting-card__image")?.src || "";

  if (!text || !imageUrl) {
    showToast(`Could not find the existing caption or image${registration ? ` for ${registration}` : ""}.`, true);
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Sending to Buffer...";

  try {
    const response = await fetch("/api/buffer-publishing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ACCESS_HEADER]: accessKey,
      },
      body: JSON.stringify({
        action: "createFacebookImageDraft",
        destination,
        text,
        mediaUrl: imageUrl,
        registration,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || result.message || `Buffer returned HTTP ${response.status}.`);
    }

    button.textContent = "Buffer Draft ✓";
    button.dataset.bufferPostId = result.bufferPostId || "";
    showToast(`${registration || "Vehicle"} is safely sitting in Buffer Drafts.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    showToast(error.message || "Buffer draft creation failed.", true);
  }
}

function decorate() {
  const destination = currentDestination();
  if (!SUPPORTED_DESTINATIONS.has(destination)) return;

  const candidateButtons = [...document.querySelectorAll("button")].filter((button) => {
    const label = button.textContent?.trim() || "";
    return label === "Prepare This Van" || label === "Prepare + Open Facebook" || label === "Prepared - Open Facebook Again";
  });

  for (const anchorButton of candidateButtons) {
    const card = anchorButton.closest("article");
    const actions = anchorButton.parentElement;
    if (!card || !actions || actions.querySelector("[data-buffer-draft-button]")) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = anchorButton.className;
    button.dataset.bufferDraftButton = "true";
    button.textContent = "Send to Buffer Draft";
    button.addEventListener("click", () => createBufferDraft(card, button));
    actions.insertBefore(button, anchorButton);
  }
}

const observer = new MutationObserver(() => decorate());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", decorate);
setInterval(decorate, 1500);
decorate();
