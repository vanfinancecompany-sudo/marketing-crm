function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function productKeyForRow(row) {
  const list = row.closest("#financeList, #rentList");
  return list?.id === "rentList" ? "rent2buy" : "vanFinance";
}

function setPageStatus(message, error = false) {
  const text = document.getElementById("statusText");
  const dot = document.getElementById("statusDot");
  if (text) text.textContent = message;
  if (dot) dot.className = `status-dot ${error ? "is-error" : "is-ready"}`;
}

async function bufferRequest(payload) {
  const response = await fetch("/api/buffer-publishing-ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      title,
      mediaUrl: videoUrl,
      registration,
    });
    button.textContent = "Buffer Draft ✓";
    button.dataset.bufferPostId = result.bufferPostId || "";
    setPageStatus(`${registration} is safely sitting in Buffer Drafts with the full vehicle advert copy.`);
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

let decorateQueued = false;
function queueDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  setTimeout(() => {
    decorateQueued = false;
    decorateRows();
  }, 50);
}

for (const list of [document.getElementById("financeList"), document.getElementById("rentList")]) {
  if (!list) continue;
  const observer = new MutationObserver(queueDecorate);
  observer.observe(list, { childList: true });
}

decorateRows();
