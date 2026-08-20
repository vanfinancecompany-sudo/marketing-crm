const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";
const SUPPORTED_DESTINATIONS = new Set([
  "Van Finance Facebook",
  "Rent2Buy Facebook",
]);

let automationConfig = null;
let automationLoading = false;

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

async function authenticatedJson(path, options = {}) {
  const accessKey = storedAccessKey();
  if (!accessKey) throw new Error("Open and unlock the Marketing CRM first.");
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      [ACCESS_HEADER]: accessKey,
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || result.message || `Request returned HTTP ${response.status}.`);
  }
  return result;
}

async function createBufferDraft(card, button) {
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
    const result = await authenticatedJson("/api/buffer-publishing", {
      method: "POST",
      body: JSON.stringify({
        action: "createFacebookImageDraft",
        destination,
        text,
        mediaUrl: imageUrl,
        registration,
      }),
    });
    button.textContent = "Buffer Draft ✓";
    button.dataset.bufferPostId = result.bufferPostId || "";
    showToast(`${registration || "Vehicle"} is safely sitting in Buffer Drafts.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    showToast(error.message || "Buffer draft creation failed.", true);
  }
}

function countInput(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : 0;
}

function panelMarkup(destination) {
  const finance = destination === "Van Finance Facebook";
  const config = automationConfig || {};
  const postCount = finance ? config.vanFinancePostsPerDay : config.rent2buyPostsPerDay;
  const reelCount = finance ? config.vanFinanceReelsPerDay : config.rent2buyReelsPerDay;
  const mode = config.mode || "off";
  return `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;margin:12px 0;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.035)">
      <strong>Buffer Automation</strong>
      <span data-buffer-mode-label style="font-weight:800">${mode.toUpperCase()}</span>
      <label style="display:flex;gap:6px;align-items:center">Posts/day
        <input data-buffer-post-count type="number" min="0" max="10" value="${postCount ?? 0}" style="width:58px;padding:6px;border-radius:7px">
      </label>
      <label style="display:flex;gap:6px;align-items:center">Reels/day
        <input data-buffer-reel-count type="number" min="0" max="10" value="${reelCount ?? 0}" style="width:58px;padding:6px;border-radius:7px">
      </label>
      <select data-buffer-mode style="padding:7px;border-radius:7px">
        <option value="off" ${mode === "off" ? "selected" : ""}>OFF</option>
        <option value="draft" ${mode === "draft" ? "selected" : ""}>DRAFT TEST</option>
        <option value="queue" ${mode === "queue" ? "selected" : ""}>LIVE BUFFER QUEUE</option>
      </select>
      <button type="button" data-buffer-save-automation>Save Automation</button>
      <small style="opacity:.72">Queue times are controlled in Buffer. OFF is the emergency stop.</small>
    </div>
  `;
}

async function loadAutomationSettings() {
  if (automationLoading || automationConfig) return;
  automationLoading = true;
  try {
    const result = await authenticatedJson("/api/buffer-automation-settings", { method: "GET" });
    automationConfig = result.config || { mode: "off" };
  } catch (error) {
    console.warn("[buffer-automation] settings unavailable", error);
  } finally {
    automationLoading = false;
    decorateAutomationPanel();
  }
}

async function saveAutomationPanel(panel, destination) {
  if (!automationConfig) return;
  const mode = panel.querySelector("[data-buffer-mode]")?.value || "off";
  const posts = countInput(panel.querySelector("[data-buffer-post-count]")?.value);
  const reels = countInput(panel.querySelector("[data-buffer-reel-count]")?.value);
  if (mode === "queue") {
    const confirmed = window.confirm(
      "LIVE BUFFER QUEUE can publish to Facebook using your Buffer schedule. Continue?",
    );
    if (!confirmed) return;
  }

  const next = { ...automationConfig, mode };
  if (destination === "Rent2Buy Facebook") {
    next.rent2buyPostsPerDay = posts;
    next.rent2buyReelsPerDay = reels;
  } else {
    next.vanFinancePostsPerDay = posts;
    next.vanFinanceReelsPerDay = reels;
  }

  const button = panel.querySelector("[data-buffer-save-automation]");
  const original = button?.textContent || "Save Automation";
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }
  try {
    const result = await authenticatedJson("/api/buffer-automation-settings", {
      method: "POST",
      body: JSON.stringify({
        config: next,
        confirmQueue: mode === "queue" ? "ENABLE_BUFFER_QUEUE" : "",
      }),
    });
    automationConfig = result.config;
    showToast(`Buffer automation saved: ${automationConfig.mode.toUpperCase()}.`);
    panel.remove();
    decorateAutomationPanel();
  } catch (error) {
    showToast(error.message || "Could not save Buffer automation.", true);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function decorateAutomationPanel() {
  const destination = currentDestination();
  if (!SUPPORTED_DESTINATIONS.has(destination)) return;
  if (!automationConfig) {
    loadAutomationSettings();
    return;
  }
  if (document.querySelector("[data-buffer-automation-panel]")) return;

  const host = document.querySelector(".posting-destination-hero") || document.querySelector("main");
  if (!host) return;
  const panel = document.createElement("div");
  panel.dataset.bufferAutomationPanel = "true";
  panel.innerHTML = panelMarkup(destination);
  panel.querySelector("[data-buffer-save-automation]")?.addEventListener(
    "click",
    () => saveAutomationPanel(panel, destination),
  );
  host.appendChild(panel);
}

function decorateDraftButtons() {
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

function decorate() {
  decorateDraftButtons();
  decorateAutomationPanel();
}

const observer = new MutationObserver(() => decorate());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", () => {
  automationConfig = null;
  document.querySelector("[data-buffer-automation-panel]")?.remove();
  decorate();
});
setInterval(decorate, 1500);
decorate();
