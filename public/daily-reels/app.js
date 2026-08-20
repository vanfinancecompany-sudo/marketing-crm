const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";
const TARGET_PER_PRODUCT = 10;
const FRAME_COUNT = 10;
const TEMPLATE_KEY = "tiktokPunch";
const PRODUCT_LABELS = {
  vanFinance: "Finance",
  rent2buy: "Rent2Buy",
};

const MESSAGE_PACKS = {
  vanFinance: [
    [
      { headline: "FROM £99 DEPOSIT", support: "VAN FINANCE COMPANY" },
      {},
      {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE VAN FINANCE" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FAST VAN FINANCE", support: "APPROVED IN 60 MINUTES" },
      {},
      {},
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE VAN FINANCE" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "200+ VANS AVAILABLE", support: "CHOOSE YOUR NEXT VAN" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FINANCE YOUR NEXT WORK VAN", support: "KEEP YOUR CASH FLOW MOVING" },
      {},
      {},
      { headline: "FINANCE THE VAT", support: "BUSINESS-FRIENDLY VAN FINANCE" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE FINANCE OPTIONS" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "YOUR NEXT VAN IS HERE", support: "200+ VANS AVAILABLE" },
      {},
      {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "VANS READY TO GO", support: "CHOOSE YOUR NEXT VAN TODAY" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
  ],
  rent2buy: [
    [
      { headline: "NO CREDIT CHECK VANS", support: "RENT IT - DRIVE IT - OWN IT" },
      {},
      {},
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
      {},
      {},
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
      {},
      {},
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
      {},
      {},
      { headline: "NO CREDIT CHECK VANS", support: "SIMPLE QUALIFYING CHECK" },
      { headline: "VANS READY TO GO", support: "PANEL VANS, LUTONS AND PICKUPS" },
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
      { headline: "DRIVE IT, THEN OWN IT", support: "RENT IT - DRIVE IT - OWN IT" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
      { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
  ],
};

const state = {
  overview: null,
  busy: false,
};

const el = {
  prepare: document.getElementById("prepareButton"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  progressTrack: document.getElementById("progressTrack"),
  progressBar: document.getElementById("progressBar"),
  errorBox: document.getElementById("errorBox"),
  financeCount: document.getElementById("financeCount"),
  rentCount: document.getElementById("rentCount"),
  financeNote: document.getElementById("financeNote"),
  rentNote: document.getElementById("rentNote"),
  financeList: document.getElementById("financeList"),
  rentList: document.getElementById("rentList"),
  financeZip: document.getElementById("financeZip"),
  rentZip: document.getElementById("rentZip"),
  financeClear: document.getElementById("financeClear"),
  rentClear: document.getElementById("rentClear"),
};

function renderSidebar() {
  const navigation = window.MarketingCrmNavigation;
  const nav = document.getElementById("sidebarNav");
  if (!navigation || !nav) return;
  nav.innerHTML = "";
  for (const item of navigation.items || []) {
    const href = item.href || item.path || "/";
    const link = document.createElement("a");
    link.href = href;
    link.textContent = item.label;
    link.className = item.variant === "primary"
      ? "marketing-sidebar__main-crm"
      : `marketing-sidebar__link${navigation.isItemActive(location.pathname, item) ? " is-active" : ""}`;
    if (item.external) link.rel = "noopener noreferrer";
    nav.appendChild(link);
  }
}

function storedAccessKey() {
  try {
    return localStorage.getItem(ACCESS_STORAGE_KEY) || sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

async function api(action, payload = {}) {
  const key = storedAccessKey();
  if (!key) {
    throw new Error("Marketing CRM access is not unlocked in this browser. Open the main CRM once, unlock it, then return to Daily Reels.");
  }
  const response = await fetch("/api/youtube-daily-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ACCESS_HEADER]: key,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || result.error || `Daily Reels request failed with HTTP ${response.status}.`);
  }
  return result;
}

function setStatus(message, mode = "ready") {
  el.statusText.textContent = message;
  el.statusDot.className = `status-dot${mode === "working" ? " is-working" : mode === "error" ? " is-error" : " is-ready"}`;
}

function setError(message = "") {
  const text = String(message || "").trim();
  el.errorBox.hidden = !text;
  el.errorBox.textContent = text;
  if (text) setStatus("Daily Reels needs attention.", "error");
}

function setProgress(current, total) {
  if (!total) {
    el.progressTrack.hidden = true;
    el.progressBar.style.width = "0%";
    return;
  }
  el.progressTrack.hidden = false;
  el.progressBar.style.width = `${Math.max(0, Math.min(100, Math.round((current / total) * 100)))}%`;
}

function normalizeRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function displayRegistration(value) {
  const registration = normalizeRegistration(value);
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(registration)
    ? `${registration.slice(0, 4)} ${registration.slice(4)}`
    : registration;
}

function cleanFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "reel";
}

function renderFilename(candidate) {
  const prefix = candidate.productKey === "rent2buy" ? "rent2buy" : "van-finance";
  return `${prefix}-${cleanFilePart(candidate.registration).toLowerCase()}-tiktok.mp4`;
}

function humanBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function noteForSummary(summary, label) {
  const generated = Number(summary?.generatedToday || 0);
  const ready = Array.isArray(summary?.ready) ? summary.ready.length : 0;
  if (generated >= TARGET_PER_PRODUCT && ready === 0) {
    return `Today's ${label} batch has been used and cleared. The 48-hour cooldown remains active.`;
  }
  if (generated >= TARGET_PER_PRODUCT) {
    return `Today's ${label} batch is complete and ready to download.`;
  }
  if (generated > 0) {
    return `${generated} generated today. Prepare Today's 10 + 10 will fill the remaining ${TARGET_PER_PRODUCT - generated} if eligible stock is available.`;
  }
  return `No ${label} reels prepared yet today.`;
}

function renderReelList(container, reels) {
  container.innerHTML = "";
  if (!reels.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No ready reels sitting in today's tray.";
    container.appendChild(empty);
    return;
  }

  for (const reel of reels) {
    const row = document.createElement("div");
    row.className = "reel-row";

    const reg = document.createElement("div");
    reg.className = "reel-reg";
    reg.textContent = displayRegistration(reel.registration);

    const title = document.createElement("div");
    title.className = "reel-title";
    const size = humanBytes(reel.sizeBytes);
    title.textContent = `${reel.title || "Vehicle reel"}${size ? ` · ${size}` : ""}`;
    title.title = reel.title || "";

    const download = document.createElement("a");
    download.className = "reel-link";
    download.href = reel.downloadUrl;
    download.target = "_blank";
    download.rel = "noopener";
    download.textContent = "MP4";

    row.append(reg, title, download);
    container.appendChild(row);
  }
}

function renderOverview(overview) {
  state.overview = overview;
  const finance = overview?.vanFinance || { generatedToday: 0, ready: [] };
  const rent = overview?.rent2buy || { generatedToday: 0, ready: [] };
  const financeReady = Array.isArray(finance.ready) ? finance.ready : [];
  const rentReady = Array.isArray(rent.ready) ? rent.ready : [];

  el.financeCount.textContent = `${Number(finance.generatedToday || 0)} / ${TARGET_PER_PRODUCT}`;
  el.rentCount.textContent = `${Number(rent.generatedToday || 0)} / ${TARGET_PER_PRODUCT}`;
  el.financeNote.textContent = noteForSummary(finance, "Finance");
  el.rentNote.textContent = noteForSummary(rent, "Rent2Buy");
  renderReelList(el.financeList, financeReady);
  renderReelList(el.rentList, rentReady);

  el.financeZip.disabled = state.busy || !financeReady.length;
  el.rentZip.disabled = state.busy || !rentReady.length;
  el.financeClear.disabled = state.busy || !financeReady.length;
  el.rentClear.disabled = state.busy || !rentReady.length;
  el.prepare.disabled = state.busy || (
    Number(finance.generatedToday || 0) >= TARGET_PER_PRODUCT &&
    Number(rent.generatedToday || 0) >= TARGET_PER_PRODUCT
  );
}

function setBusy(value) {
  state.busy = Boolean(value);
  if (state.overview) renderOverview(state.overview);
  else el.prepare.disabled = state.busy;
}

async function refreshOverview() {
  const overview = await api("overview");
  renderOverview(overview);
  const finance = Number(overview.vanFinance?.generatedToday || 0);
  const rent = Number(overview.rent2buy?.generatedToday || 0);
  if (finance >= TARGET_PER_PRODUCT && rent >= TARGET_PER_PRODUCT) {
    setStatus("Today's reel allowance is complete. Download the two ZIPs when you're ready.");
  } else {
    setStatus("Daily reel tray ready.");
  }
  return overview;
}

function getMessagePack(productKey, packIndex = 0) {
  const packs = MESSAGE_PACKS[productKey] || [];
  if (!packs.length) return Array.from({ length: FRAME_COUNT }, () => ({}));
  const selected = packs[Math.abs(Number(packIndex) || 0) % packs.length];
  return Array.from({ length: FRAME_COUNT }, (_, index) => ({ ...(selected[index] || {}) }));
}

function renderPayload(candidate, messagePackIndex = 0) {
  const vehicle = candidate.vehicle || {};
  return {
    productKey: candidate.productKey,
    registration: candidate.registration,
    title: candidate.title || vehicle.vanDescription || vehicle.description || candidate.registration,
    priceText: vehicle.price || vehicle.initialRental || "",
    monthlyText: vehicle.monthly || vehicle.salePrice || vehicle.week || "",
    imageUrls: (candidate.images || []).slice(0, FRAME_COUNT),
    frameSpecs: getMessagePack(candidate.productKey, messagePackIndex),
    frameCount: FRAME_COUNT,
    durationSeconds: 20,
    fps: 24,
    templateKey: TEMPLATE_KEY,
    premiumMotion: true,
  };
}

async function renderCandidate(candidate, messagePackIndex = 0) {
  const response = await fetch("/api/youtube-mp4-render", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(renderPayload(candidate, messagePackIndex)),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.downloadUrl) {
    throw new Error(result.error || result.message || `MP4 render failed with HTTP ${response.status}.`);
  }
  return result;
}

async function recordRenderedCandidate(candidate, renderResult) {
  const payload = {
    productKey: candidate.productKey,
    registration: candidate.registration,
    title: candidate.title,
    filename: renderFilename(candidate),
    downloadUrl: renderResult.downloadUrl,
    blobPathname: renderResult.blobPathname || "",
    sizeBytes: renderResult.sizeBytes || renderResult.actualSizeBytes || 0,
  };
  try {
    return await api("record", payload);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      return await api("record", payload);
    } catch {
      throw firstError;
    }
  }
}

async function prepareToday() {
  if (state.busy) return;
  setBusy(true);
  setError("");
  setProgress(0, 1);
  setStatus("Checking live Wix images and the 48-hour rotation history...", "working");

  const failures = [];
  const messagePackCounters = { vanFinance: 0, rent2buy: 0 };
  let completed = 0;
  try {
    const plan = await api("candidates");
    const finance = Array.isArray(plan.finance) ? plan.finance : [];
    const rent = Array.isArray(plan.rent2buy) ? plan.rent2buy : [];
    const queue = [...finance, ...rent];

    if (!queue.length) {
      await refreshOverview();
      const financeDone = Number(plan.vanFinance?.generatedToday || 0) >= TARGET_PER_PRODUCT;
      const rentDone = Number(plan.rent2buySummary?.generatedToday || 0) >= TARGET_PER_PRODUCT;
      setStatus(
        financeDone && rentDone
          ? "Today's 10 + 10 is already complete."
          : "No additional eligible vehicles are available right now. Vehicles need 10+ images and must be outside the 48-hour cooldown.",
      );
      return;
    }

    setProgress(0, queue.length);
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = queue[index];
      const label = PRODUCT_LABELS[candidate.productKey] || "Reel";
      const reg = displayRegistration(candidate.registration);
      const packIndex = messagePackCounters[candidate.productKey] || 0;
      messagePackCounters[candidate.productKey] = packIndex + 1;
      const packCount = (MESSAGE_PACKS[candidate.productKey] || []).length || 1;
      setStatus(
        `${label} ${index + 1}/${queue.length}: rendering ${reg} in TikTok Punch · message pack ${(packIndex % packCount) + 1}...`,
        "working",
      );
      try {
        const rendered = await renderCandidate(candidate, packIndex);
        await recordRenderedCandidate(candidate, rendered);
        completed += 1;
      } catch (error) {
        failures.push(`${label} ${reg}: ${error.message || error}`);
      }
      setProgress(index + 1, queue.length);
      if (index < queue.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    await refreshOverview();
    setProgress(0, 0);
    if (failures.length) {
      setError(`${completed} reel${completed === 1 ? "" : "s"} prepared. ${failures.length} failed and can be retried by pressing Prepare again.\n\n${failures.join("\n")}`);
    } else {
      setStatus(`${completed} reel${completed === 1 ? "" : "s"} prepared with rotating messages. Today's tray is ready.`);
    }
  } catch (error) {
    setProgress(0, 0);
    setError(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function makeLocalHeader(nameBytes, data, crc, date) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  u32(view, 0, 0x04034b50);
  u16(view, 4, 20);
  u16(view, 6, 0x0800);
  u16(view, 8, 0);
  u16(view, 10, date.time);
  u16(view, 12, date.day);
  u32(view, 14, crc);
  u32(view, 18, data.length);
  u32(view, 22, data.length);
  u16(view, 26, nameBytes.length);
  u16(view, 28, 0);
  return header;
}

function makeCentralHeader(nameBytes, data, crc, date, localOffset) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  u32(view, 0, 0x02014b50);
  u16(view, 4, 20);
  u16(view, 6, 20);
  u16(view, 8, 0x0800);
  u16(view, 10, 0);
  u16(view, 12, date.time);
  u16(view, 14, date.day);
  u32(view, 16, crc);
  u32(view, 20, data.length);
  u32(view, 24, data.length);
  u16(view, 28, nameBytes.length);
  u16(view, 30, 0);
  u16(view, 32, 0);
  u16(view, 34, 0);
  u16(view, 36, 0);
  u32(view, 38, 0);
  u32(view, 42, localOffset);
  return header;
}

function makeEndRecord(entryCount, centralSize, centralOffset) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50);
  u16(view, 4, 0);
  u16(view, 6, 0);
  u16(view, 8, entryCount);
  u16(view, 10, entryCount);
  u32(view, 12, centralSize);
  u32(view, 16, centralOffset);
  u16(view, 20, 0);
  return end;
}

async function buildStoredZip(reels, onProgress) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (let index = 0; index < reels.length; index += 1) {
    const reel = reels[index];
    onProgress?.(index, reels.length, reel);
    const response = await fetch(reel.downloadUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not fetch ${displayRegistration(reel.registration)} for ZIP download.`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (!data.length) throw new Error(`${displayRegistration(reel.registration)} returned an empty MP4.`);
    if (data.length > 0xffffffff) throw new Error("A reel is too large for the browser ZIP builder.");

    const filename = cleanFilePart(reel.filename || `${reel.registration}.mp4`).replace(/\.mp4$/i, "") + ".mp4";
    const nameBytes = encoder.encode(filename);
    const crc = crc32(data);
    const date = dosDateTime(new Date(reel.generatedAt || Date.now()));
    const localHeader = makeLocalHeader(nameBytes, data, crc, date);
    const centralHeader = makeCentralHeader(nameBytes, data, crc, date, localOffset);

    localParts.push(localHeader, nameBytes, data);
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + data.length;
    if (localOffset > 0xffffffff) throw new Error("Today's ZIP is too large for the browser ZIP builder.");
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = makeEndRecord(reels.length, centralSize, centralOffset);
  onProgress?.(reels.length, reels.length, null);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function downloadProductZip(key) {
  if (state.busy) return;
  const summary = state.overview?.[key];
  const reels = Array.isArray(summary?.ready) ? summary.ready : [];
  if (!reels.length) return;

  setBusy(true);
  setError("");
  try {
    const label = PRODUCT_LABELS[key];
    const blob = await buildStoredZip(reels, (current, total, reel) => {
      setProgress(current, total);
      if (reel) setStatus(`Building ${label} ZIP ${current + 1}/${total}: ${displayRegistration(reel.registration)}...`, "working");
    });
    const date = state.overview?.date || new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `${label === "Finance" ? "Finance" : "Rent2Buy"}-Reels-${date}.zip`);
    setProgress(0, 0);
    setStatus(`${label} ZIP downloaded. The reels stay here until you delete them.`);
  } catch (error) {
    setProgress(0, 0);
    setError(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function clearProduct(key) {
  if (state.busy) return;
  const summary = state.overview?.[key];
  const ready = Array.isArray(summary?.ready) ? summary.ready : [];
  if (!ready.length) return;
  const label = PRODUCT_LABELS[key];
  if (!window.confirm(`Delete today's ${ready.length} ${label} reel${ready.length === 1 ? "" : "s"} from the CRM tray? The 48-hour no-repeat history will be kept.`)) return;

  setBusy(true);
  setError("");
  setStatus(`Deleting today's ${label} reels...`, "working");
  try {
    const result = await api("clear", { productKey: key });
    renderOverview({
      ok: true,
      date: state.overview?.date || new Date().toISOString().slice(0, 10),
      vanFinance: result.vanFinance,
      rent2buy: result.rent2buy,
    });
    setStatus(`${result.deleted || 0} ${label} reel${result.deleted === 1 ? "" : "s"} deleted. The 48-hour rotation history is still intact.`);
  } catch (error) {
    setError(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

el.prepare.addEventListener("click", prepareToday);
el.financeZip.addEventListener("click", () => downloadProductZip("vanFinance"));
el.rentZip.addEventListener("click", () => downloadProductZip("rent2buy"));
el.financeClear.addEventListener("click", () => clearProduct("vanFinance"));
el.rentClear.addEventListener("click", () => clearProduct("rent2buy"));
window.addEventListener("beforeunload", (event) => {
  if (!state.busy) return;
  event.preventDefault();
  event.returnValue = "";
});

renderSidebar();
refreshOverview().catch((error) => setError(error.message || String(error)));
