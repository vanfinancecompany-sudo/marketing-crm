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

async function runSingleRent2BuyReelProof(button) {
  const accessKey = storedAccessKey();
  if (!accessKey) {
    setPageStatus("Open and unlock the Marketing CRM first, then try Buffer again.", true);
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Building one test Reel...";
  setPageStatus("Preparing one Rent2Buy Reel for the Buffer proof. This does not change today's 10 + 10 totals.");

  try {
    const candidateResponse = await fetch("/api/buffer-reel-test-candidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ACCESS_HEADER]: accessKey,
      },
      body: JSON.stringify({ productKey: "rent2buy" }),
    });
    const candidate = await candidateResponse.json().catch(() => ({}));
    if (!candidateResponse.ok || candidate.ok === false) {
      throw new Error(candidate.error || candidate.message || `Candidate request returned HTTP ${candidateResponse.status}.`);
    }

    const renderResponse = await fetch("/api/youtube-mp4-render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        productKey: "rent2buy",
        registration: candidate.registration,
        title: candidate.title,
        imageUrls: candidate.images,
        frameCount: 10,
        durationSeconds: 20,
        fps: 24,
        templateKey: "tiktokPunch",
        premiumMotion: true,
      }),
    });
    const rendered = await renderResponse.json().catch(() => ({}));
    if (!renderResponse.ok || !rendered.downloadUrl) {
      throw new Error(rendered.error || rendered.message || `MP4 render returned HTTP ${renderResponse.status}.`);
    }

    button.textContent = "Sending to Buffer...";
    const result = await bufferRequest({
      action: "createFacebookReelDraft",
      productKey: "rent2buy",
      text: buildCaption({
        productKey: "rent2buy",
        registration: candidate.registration,
        title: candidate.title,
      }),
      mediaUrl: rendered.downloadUrl,
      registration: candidate.registration,
    });

    button.textContent = "Reel Proof Sent ✓";
    button.dataset.bufferPostId = result.bufferPostId || "";
    setPageStatus(`${candidate.registration} Reel sent safely to Buffer. Check RENT to BUY VANS in Buffer.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    setPageStatus(error.message || "Single Buffer Reel proof failed.", true);
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

function addSingleProofButton() {
  if (document.getElementById("singleBufferReelProof")) return;
  const footnote = document.querySelector(".footnote-card");
  if (!footnote) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "singleBufferReelProof";
  button.className = "primary-button";
  button.textContent = "Create 1 Buffer Reel Test";
  button.addEventListener("click", () => runSingleRent2BuyReelProof(button));
  footnote.appendChild(button);
}

const observer = new MutationObserver(() => {
  decorateRows();
  addSingleProofButton();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(() => {
  decorateRows();
  addSingleProofButton();
}, 1500);
decorateRows();
addSingleProofButton();
