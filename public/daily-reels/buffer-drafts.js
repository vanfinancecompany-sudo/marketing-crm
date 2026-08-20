const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";

function storedAccessKey() {
  try {
    return localStorage.getItem(ACCESS_STORAGE_KEY) || sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function productKeyForRow(row) {
  const list = row.closest("#financeList, #rentList");
  return list?.id === "rentList" ? "rent2buy" : "vanFinance";
}

function buildCaption({ productKey, registration, title }) {
  const cleanTitle = String(title || "Vehicle reel").replace(/\s*·\s*[0-9.]+\s*(?:KB|MB|GB).*$/i, "").trim();
  if (productKey === "rent2buy") {
    return `${cleanTitle}\n\nREGISTRATION: ${registration}\n\nRENT IT! - DRIVE IT! - OWN IT!\nCheck if you qualify online.\n\nhttps://www.rent2buyvans.co.uk/van-pages/${registration}`;
  }
  return `${cleanTitle}\n\nREGISTRATION: ${registration}\n\nVan finance available. Free UK delivery. Apply online today.\n\nhttps://www.vanfinancecompany.co.uk/van-finance/${registration}`;
}

function setPageStatus(message, error = false) {
  const text = document.getElementById("statusText");
  const dot = document.getElementById("statusDot");
  if (text) text.textContent = message;
  if (dot) dot.className = `status-dot ${error ? "is-error" : "is-ready"}`;
}

async function bufferRequest(payload) {
  const accessKey = storedAccessKey();
  if (!accessKey) throw new Error("Open and unlock the Marketing CRM first, then try Buffer again.");
  const response = await fetch("/api/buffer-publishing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ACCESS_HEADER]: accessKey,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || result.message || `Buffer returned HTTP ${response.status}.`);
  }
  return result;
}

async function createReelDraft(row, button) {
  const registration = normalizeRegistration(row.querySelector(".reel-reg")?.textContent);
  const title = row.querySelector(".reel-title")?.textContent?.trim() || "Vehicle reel";
  const videoUrl = row.querySelector('a[href*=".mp4"], a.reel-link')?.href || "";
  const productKey = productKeyForRow(row);

  if (!registration || !videoUrl) {
    setPageStatus("Could not find the registration or public MP4 URL for this reel.", true);
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Sending...";
  setPageStatus(`Sending ${registration} to Buffer Drafts...`);

  try {
    const result = await bufferRequest({
      action: "createFacebookReelDraft",
      productKey,
      text: buildCaption({ productKey, registration, title }),
      mediaUrl: videoUrl,
      registration,
    });
    button.textContent = "Buffer Draft ✓";
    button.dataset.bufferPostId = result.bufferPostId || "";
    setPageStatus(`${registration} is safely sitting in Buffer Drafts.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    setPageStatus(error.message || "Buffer reel draft creation failed.", true);
  }
}

function decorateRows() {
  for (const row of document.querySelectorAll(".reel-row")) {
    if (row.querySelector("[data-buffer-reel-draft]")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reel-link buffer-reel-button";
    button.dataset.bufferReelDraft = "true";
    button.textContent = "Buffer Draft";
    button.addEventListener("click", () => createReelDraft(row, button));
    row.appendChild(button);
  }
}

const observer = new MutationObserver(() => decorateRows());
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(decorateRows, 1500);
decorateRows();
