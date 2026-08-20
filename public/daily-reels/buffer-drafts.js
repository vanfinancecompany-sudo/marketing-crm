const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";
const R2B_BATCH_SIZE = 10;

const R2B_FRAME_PACKS = [
  [
    { headline: "NO CREDIT CHECK VANS", support: "RENT IT - DRIVE IT - OWN IT" },
    {}, {},
    { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE CHECK" },
    { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
    { headline: "VANS READY TO GO", support: "PICKUPS, LUTONS AND PANEL VANS" },
    { headline: "NO CREDIT CHECK", support: "CHECK IF YOU QUALIFY" },
    { headline: "DRIVE IT, THEN OWN IT", support: "FLEXIBLE RENT2BUY" },
    { headline: "GET BACK TO WORK FAST", support: "CHOOSE YOUR VAN TODAY" },
    { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
  ],
  [
    { headline: "DRIVE IT, THEN OWN IT", support: "RENT2BUY VANS" },
    {}, {},
    { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
    { headline: "NO CREDIT CHECK", support: "SIMPLE QUALIFYING CHECK" },
    { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
    { headline: "FLEXIBLE RENT2BUY", support: "RENT IT - DRIVE IT - OWN IT" },
    { headline: "VANS READY TO GO", support: "PICK YOUR NEXT VAN" },
    { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
    { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
  ],
  [
    { headline: "GET BACK ON THE ROAD", support: "APPLY IN 60 SECONDS" },
    {}, {},
    { headline: "NO CREDIT CHECK", support: "FAST ONLINE CHECK" },
    { headline: "CHECK IF YOU QUALIFY", support: "SIMPLE ONLINE APPLICATION" },
    { headline: "VANS READY TO GO", support: "CHOOSE YOUR VEHICLE TODAY" },
    { headline: "RENT IT - DRIVE IT - OWN IT", support: "FLEXIBLE RENT2BUY" },
    { headline: "FINAL PAYMENT IT'S YOURS", support: "WORK TOWARDS OWNERSHIP" },
    { headline: "FAST ONLINE APPLICATION", support: "GET STARTED TODAY" },
    { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
  ],
  [
    { headline: "YOUR NEXT VAN IS READY", support: "FLEXIBLE RENT2BUY OPTIONS" },
    {}, {},
    { headline: "NO CREDIT CHECK VANS", support: "SIMPLE QUALIFYING CHECK" },
    { headline: "VANS READY TO GO", support: "PANEL VANS, LUTONS AND PICKUPS" },
    { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
    { headline: "DRIVE IT, THEN OWN IT", support: "RENT IT - DRIVE IT - OWN IT" },
    { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
    { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
    { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
  ],
];

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

function frameSpecsForBatchIndex(index) {
  const selected = R2B_FRAME_PACKS[index % R2B_FRAME_PACKS.length] || [];
  return Array.from({ length: 10 }, (_, frameIndex) => ({ ...(selected[frameIndex] || {}) }));
}

async function renderBatchCandidate(candidate, index) {
  const renderResponse = await fetch("/api/youtube-mp4-render", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      productKey: "rent2buy",
      registration: candidate.registration,
      title: candidate.title,
      imageUrls: candidate.images,
      frameSpecs: frameSpecsForBatchIndex(index),
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
  return rendered;
}

async function runRent2BuyBatchProof(button) {
  const accessKey = storedAccessKey();
  if (!accessKey) {
    setPageStatus("Open and unlock the Marketing CRM first, then try Buffer again.", true);
    return;
  }

  const confirmed = window.confirm(
    "Queue 10 real Rent2Buy Reels in Buffer now? Buffer may publish them to RENT to BUY VANS according to that channel's queue schedule.",
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Finding 10 Rent2Buy vans...";
  setPageStatus("Preparing the 10-Reel Rent2Buy Buffer proof. This does not change today's Daily Reels 10 + 10 counter.");

  let queued = 0;
  const failures = [];
  try {
    const candidateResponse = await fetch("/api/buffer-reel-test-candidate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ACCESS_HEADER]: accessKey,
      },
      body: JSON.stringify({ productKey: "rent2buy", limit: R2B_BATCH_SIZE }),
    });
    const candidatePayload = await candidateResponse.json().catch(() => ({}));
    if (!candidateResponse.ok || candidatePayload.ok === false) {
      throw new Error(candidatePayload.error || candidatePayload.message || `Candidate request returned HTTP ${candidateResponse.status}.`);
    }

    const candidates = Array.isArray(candidatePayload.candidates) ? candidatePayload.candidates : [];
    if (candidates.length < R2B_BATCH_SIZE) {
      throw new Error(`Only ${candidates.length} eligible Rent2Buy vans with 10 usable images are available. Nothing was queued.`);
    }

    for (let index = 0; index < R2B_BATCH_SIZE; index += 1) {
      const candidate = candidates[index];
      const registration = normalizeRegistration(candidate.registration);
      button.textContent = `Building Reel ${index + 1}/${R2B_BATCH_SIZE}...`;
      setPageStatus(`Rent2Buy Reel ${index + 1}/${R2B_BATCH_SIZE}: rendering ${registration}...`);

      try {
        const rendered = await renderBatchCandidate(candidate, index);
        button.textContent = `Queueing Reel ${index + 1}/${R2B_BATCH_SIZE}...`;
        const result = await bufferRequest({
          action: "createFacebookReelQueue",
          confirmQueue: true,
          productKey: "rent2buy",
          text: buildCaption({
            productKey: "rent2buy",
            registration,
            title: candidate.title,
          }),
          mediaUrl: rendered.downloadUrl,
          registration,
        });
        queued += 1;
        button.dataset[`bufferPost${index + 1}`] = result.bufferPostId || "";
      } catch (error) {
        failures.push(`${registration}: ${error.message || error}`);
      }
    }

    if (failures.length) {
      button.textContent = `${queued}/${R2B_BATCH_SIZE} Reels queued - check Buffer`;
      setPageStatus(`${queued}/${R2B_BATCH_SIZE} Rent2Buy Reels reached Buffer. ${failures.length} failed: ${failures.join(" | ")}`, true);
      return;
    }

    button.textContent = "10 Rent2Buy Reels Queued ✓";
    setPageStatus("All 10 Rent2Buy Reels are in the RENT to BUY VANS Buffer queue. Check Buffer before we automate anything else.");
  } catch (error) {
    if (queued === 0) {
      button.disabled = false;
      button.textContent = "Queue 10 Rent2Buy Reels to Buffer";
    } else {
      button.textContent = `${queued}/${R2B_BATCH_SIZE} Reels queued - check Buffer`;
    }
    setPageStatus(error.message || "Ten-Reel Buffer proof failed.", true);
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

function addBatchProofButton() {
  const oldButton = document.getElementById("singleBufferReelProof");
  if (oldButton) oldButton.remove();
  if (document.getElementById("rent2BuyBufferBatchProof")) return;
  const footnote = document.querySelector(".footnote-card");
  if (!footnote) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "rent2BuyBufferBatchProof";
  button.className = "primary-button";
  button.textContent = "Queue 10 Rent2Buy Reels to Buffer";
  button.addEventListener("click", () => runRent2BuyBatchProof(button));
  footnote.appendChild(button);
}

const observer = new MutationObserver(() => {
  decorateRows();
  addBatchProofButton();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(() => {
  decorateRows();
  addBatchProofButton();
}, 1500);
decorateRows();
addBatchProofButton();
