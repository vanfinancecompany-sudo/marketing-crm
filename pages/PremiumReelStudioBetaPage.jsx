import { useEffect, useMemo, useRef, useState } from "react";
import {
  financeReelHooks,
  reelHookModes,
  reelSources,
  reelTypes,
  rentReelHooks,
} from "../data/mockData.js";
import {
  buildFinanceReelContent,
  buildRentReelContent,
  createReelRecord,
} from "../utils/creativeUtils.js";
import {
  downloadPremiumReelMp4,
  generatePremiumReelVideoAsset,
} from "../utils/premiumReelVideoExport.js";

const TRACK_BASE_URL = "https://marketing-crm-six.vercel.app/track?src=reel";
const DEFAULT_FINANCE_DESCRIPTION = `🚐 VAN FINANCE AVAILABLE NOW
💰 From £99 deposit
⚡ Approved in 60 minutes

👇 Apply now
${TRACK_BASE_URL}&type=finance&reel={reelId}&reg={reg}`;
const DEFAULT_RENT_DESCRIPTION = `🚐 RENT TO BUY YOUR VAN
🚫 NO CREDIT CHECK
🔑 RENT IT - DRIVE IT - OWN IT

👇 Apply now
${TRACK_BASE_URL}&type=rent2buy&reel={reelId}`;
const LOW_DEPOSIT_FINANCE_DESCRIPTION = `🚐 VAN FINANCE AVAILABLE NOW
💰 Low deposit options available
⚡ Fast decision

👇 Apply now
${TRACK_BASE_URL}&type=finance&reel={reelId}&reg={reg}`;
const NO_CREDIT_CHECK_RENT_DESCRIPTION = `🚐 RENT TO BUY YOUR VAN
🚫 NO CREDIT CHECK
🔑 RENT IT - DRIVE IT - OWN IT

👇 Apply now
${TRACK_BASE_URL}&type=rent2buy&reel={reelId}`;
const PREMIUM_FINANCE_DESCRIPTION_LABELS = ["Finance Default", "Finance Low Deposit", "My Finance Caption"];
const PREMIUM_RENT_DESCRIPTION_LABELS = ["Rent2Buy Default", "Rent2Buy No Credit Check", "My Rent2Buy Caption"];
const DEFAULT_PREMIUM_FINANCE_DESCRIPTIONS = [
  DEFAULT_FINANCE_DESCRIPTION,
  LOW_DEPOSIT_FINANCE_DESCRIPTION,
  DEFAULT_FINANCE_DESCRIPTION,
];
const DEFAULT_PREMIUM_RENT_DESCRIPTIONS = [
  DEFAULT_RENT_DESCRIPTION,
  NO_CREDIT_CHECK_RENT_DESCRIPTION,
  DEFAULT_RENT_DESCRIPTION,
];
const PREMIUM_FINANCE_DESCRIPTIONS_STORAGE_KEY = "premiumFinanceDescriptions";
const PREMIUM_RENT_DESCRIPTIONS_STORAGE_KEY = "premiumRentDescriptions";
const PREMIUM_SELECTED_FINANCE_DESCRIPTION_INDEX_KEY = "premiumSelectedFinanceDescriptionIndex";
const PREMIUM_SELECTED_RENT_DESCRIPTION_INDEX_KEY = "premiumSelectedRentDescriptionIndex";
const LOCAL_MP4_CONVERSION_MESSAGE =
  "MP4 conversion requires the Vercel API route. Preview works locally, but MP4 export must be tested on the live Vercel deployment.";
const DEFAULT_BETA_REEL_FORM = {
  reelSource: "Mixed",
  quantity: 1,
  hookMode: "Auto rotate hooks",
  reelType: "Mixed",
  financeHook: financeReelHooks[0],
  rentHook: rentReelHooks[0],
  customHook: "",
  musicOn: true,
  ignoreVehicleCooldown: false,
};
const PREMIUM_USP_STORAGE_KEY = "premiumReelStudioBetaUsps";
const DEFAULT_PREMIUM_USPS = {
  finance: "200 VANS IN STOCK",
  rent2buy: "NO CREDIT CHECKS",
};

function normalizePipeline(value) {
  return value === "rent2buy" ? "rent2buy" : "vanFinance";
}

function cleanDisplayText(value) {
  return String(value || "").replace(/Â£/g, "£").trim();
}

function vehicleLabel(vehicle) {
  return cleanDisplayText(vehicle?.vanDescription || vehicle?.description || vehicle?.title || vehicle?.name || "Vehicle");
}

function vehicleRegistration(vehicle) {
  return cleanDisplayText(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name || "");
}

function reelContentForVehicle(vehicle) {
  return vehicle?.pipeline === "rent2buy" ? buildRentReelContent(vehicle) : buildFinanceReelContent(vehicle);
}

function hooksForPipeline(pipeline) {
  return pipeline === "rent2buy" ? rentReelHooks : financeReelHooks;
}

function queueLabel(queueKey) {
  return queueKey === "rent2buy" ? "Rent2Buy" : "Finance";
}

function loadPremiumUsps() {
  if (typeof window === "undefined") return DEFAULT_PREMIUM_USPS;

  try {
    return {
      ...DEFAULT_PREMIUM_USPS,
      ...JSON.parse(localStorage.getItem(PREMIUM_USP_STORAGE_KEY) || "{}"),
    };
  } catch {
    return DEFAULT_PREMIUM_USPS;
  }
}

function savePremiumUsps(usps) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREMIUM_USP_STORAGE_KEY, JSON.stringify(usps));
}

function loadDescriptionList(storageKey, defaults) {
  if (typeof window === "undefined") return defaults;

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return defaults.map((fallback, index) => (typeof stored[index] === "string" ? stored[index] : fallback));
  } catch {
    return defaults;
  }
}

function saveDescriptionList(storageKey, descriptions) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(descriptions));
}

function loadSelectedDescriptionIndex(storageKey) {
  if (typeof window === "undefined") return 0;

  const parsed = Number(localStorage.getItem(storageKey));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function saveSelectedDescriptionIndex(storageKey, index) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey, String(index));
}

function clampDescriptionIndex(index, descriptions) {
  if (!descriptions.length) return 0;
  return Math.min(Math.max(Number(index) || 0, 0), descriptions.length - 1);
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFilePart(value) {
  return String(value || "premium-reel")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function queueItemRegistration(value) {
  return String(value?.reg || value?.registration || value?.title || value?.name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function vehicleQueueKey(vehicle) {
  return String(vehicle?.id || vehicle?.reg || vehicle?.registration || vehicle?.name || "");
}

function resolveQueuedVehicle(queueItem, vehicles) {
  if (!queueItem) return null;
  const id = String(queueItem.id || "").trim();
  const reg = queueItemRegistration(queueItem);
  const targetPipeline = queueItem.targetPipeline || (queueItem.reelType === "rent2buy" ? "rent2buy" : "");
  const matched =
    (id ? vehicles.find((vehicle) => String(vehicle.id || "").trim() === id) : null) ||
    (reg ? vehicles.find((vehicle) => queueItemRegistration(vehicle) === reg) : null);

  if (!matched) return null;

  const rentData = matched.rent2buyData || queueItem.rent2buyData || {};
  const resolvedPipeline = targetPipeline || matched.pipeline;
  const sourceVehicle =
    resolvedPipeline === "rent2buy" && rentData
      ? { ...matched, ...rentData, id: matched.id }
      : matched;
  const resolvedImage =
    sourceVehicle.image ||
    sourceVehicle.picture ||
    sourceVehicle.mainImage ||
    queueItem.image ||
    queueItem.picture ||
    "";

  return {
    ...sourceVehicle,
    image: resolvedImage,
    picture: sourceVehicle.picture || resolvedImage,
    pipeline: resolvedPipeline,
    source: resolvedPipeline === "rent2buy" ? "rent2buy" : "finance",
    reelType: resolvedPipeline === "rent2buy" ? "rent2buy" : "finance",
    rent2buyData: matched.rent2buyData || queueItem.rent2buyData || null,
  };
}

function getReelRegistration(reel) {
  return String(reel?.registration || reel?.vehicle?.reg || reel?.reg || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function fillDescriptionTemplate(template, reelId, reel = null) {
  const reg = getReelRegistration(reel);

  return template
    .replaceAll("{reelId}", encodeURIComponent(reelId))
    .replaceAll("{reg}", encodeURIComponent(reg));
}

function isLocalDevelopmentHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function formatPremiumMp4Error(error) {
  const message = error?.message || "";
  const looksLikeMp4ConversionFailure =
    message.includes("Could not convert premium reel to MP4") ||
    message.includes("convert-reel-mp4") ||
    message.includes("Failed to fetch") ||
    message.includes("Unexpected token");

  if (isLocalDevelopmentHost() && looksLikeMp4ConversionFailure) {
    return LOCAL_MP4_CONVERSION_MESSAGE;
  }

  return message || "Could not export the premium MP4.";
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

function buildPremiumReel(vehicle, hook, musicOn = true, uspLine = "") {
  const content = reelContentForVehicle(vehicle);
  const pipeline = normalizePipeline(vehicle?.pipeline);

  const reel = createReelRecord({
    vehicle,
    image: vehicle?.image || vehicle?.picture || "",
    pipeline,
    hook,
    templateName: content.templateName,
    sourceLabel: content.sourceLabel,
    sourceType: "stock",
    subtext: content.subtext,
    priceLine: content.priceLine,
    ctaLine: content.ctaLine,
    musicOn,
  });

  return {
    ...reel,
    priceLine: cleanDisplayText(reel.priceLine),
    subtext: cleanDisplayText(reel.subtext),
    ctaLine: cleanDisplayText(reel.ctaLine),
    uspLine: cleanDisplayText(uspLine),
    vehicleName: reel.title || vehicleLabel(vehicle),
    fileName: reel.fileName || safeFilePart(`${pipeline}-${vehicleRegistration(vehicle)}-${hook}`),
  };
}

export default function PremiumReelStudioBetaPage({
  vehicles,
  vehiclesLoading,
  vehiclesError,
  manualReelQueues = { finance: [], rent2buy: [] },
  manualReelQueueVehicles = { finance: null, rent2buy: null },
  manualReelQueueLocks = { finance: null, rent2buy: null },
  manualReelQueueType = "finance",
  onManualReelQueueTypeChange,
  onNextManualQueuedVehicle,
  onRemoveManualQueuedVehicle,
  onClearManualReelQueue,
  onReelDownloadComplete,
  reelActionLocks = {},
  ignoreReelLock = false,
}) {
  const [formValues, setFormValues] = useState(DEFAULT_BETA_REEL_FORM);
  const [premiumUsps, setPremiumUsps] = useState(loadPremiumUsps);
  const [financeDescriptions, setFinanceDescriptions] = useState(() =>
    loadDescriptionList(PREMIUM_FINANCE_DESCRIPTIONS_STORAGE_KEY, DEFAULT_PREMIUM_FINANCE_DESCRIPTIONS)
  );
  const [rentDescriptions, setRentDescriptions] = useState(() =>
    loadDescriptionList(PREMIUM_RENT_DESCRIPTIONS_STORAGE_KEY, DEFAULT_PREMIUM_RENT_DESCRIPTIONS)
  );
  const [selectedFinanceDescriptionIndex, setSelectedFinanceDescriptionIndex] = useState(() =>
    loadSelectedDescriptionIndex(PREMIUM_SELECTED_FINANCE_DESCRIPTION_INDEX_KEY)
  );
  const [selectedRentDescriptionIndex, setSelectedRentDescriptionIndex] = useState(() =>
    loadSelectedDescriptionIndex(PREMIUM_SELECTED_RENT_DESCRIPTION_INDEX_KEY)
  );
  const [descriptionPanelsOpen, setDescriptionPanelsOpen] = useState({ finance: true, rent2buy: false });
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [generatedReel, setGeneratedReel] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [copyMessage, setCopyMessage] = useState("");
  const [error, setError] = useState("");
  const [exportResult, setExportResult] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ active: false, label: "Ready", percent: 0, detail: "" });
  const [exportProgress, setExportProgress] = useState({ active: false, label: "Ready", percent: 0, detail: "" });
  const [queueProcessing, setQueueProcessing] = useState({ label: "", index: 0, total: 0 });
  const [queueStatus, setQueueStatus] = useState({ finance: "Ready", rent2buy: "Ready" });
  const [queueProgress, setQueueProgress] = useState({
    finance: { completed: 0, total: 0 },
    rent2buy: { completed: 0, total: 0 },
  });
  const [autoQueueRunning, setAutoQueueRunning] = useState(false);
  const [autoQueueCancelRequested, setAutoQueueCancelRequested] = useState(false);
  const autoQueueCancelRef = useRef(false);

  const pipeline = formValues.reelType === "Rent2Buy" ? "rent2buy" : "vanFinance";

  const eligibleVehicles = useMemo(
    () =>
      (vehicles || [])
        .filter((vehicle) => normalizePipeline(vehicle.pipeline) === pipeline)
        .filter((vehicle) => vehicle?.image || vehicle?.picture),
    [vehicles, pipeline]
  );

  const selectedVehicle = useMemo(
    () => eligibleVehicles.find((vehicle) => vehicle.id === selectedVehicleId) || eligibleVehicles[0] || null,
    [eligibleVehicles, selectedVehicleId]
  );

  const selectedHook = pickHookForPipeline(pipeline, 0);
  const hookOptions = hooksForPipeline(pipeline);
  const previewContent = selectedVehicle ? reelContentForVehicle(selectedVehicle) : null;
  const financeDescriptionIndex = clampDescriptionIndex(selectedFinanceDescriptionIndex, financeDescriptions);
  const rentDescriptionIndex = clampDescriptionIndex(selectedRentDescriptionIndex, rentDescriptions);
  const activePreviewReel =
    generatedReel ||
    (selectedVehicle
      ? {
          id: "premium-preview",
          creativeId: "premium-preview",
          pipeline,
          registration: vehicleRegistration(selectedVehicle),
          vehicle: selectedVehicle,
        }
      : null);
  const activeFinanceDescriptionPreview = fillDescriptionTemplate(
    financeDescriptions[financeDescriptionIndex] || DEFAULT_FINANCE_DESCRIPTION,
    activePreviewReel?.creativeId || activePreviewReel?.id || "premium-preview",
    activePreviewReel
  );
  const activeRentDescriptionPreview = fillDescriptionTemplate(
    rentDescriptions[rentDescriptionIndex] || DEFAULT_RENT_DESCRIPTION,
    activePreviewReel?.creativeId || activePreviewReel?.id || "premium-preview",
    activePreviewReel
  );
  const activeQueueKey = manualReelQueueType === "rent2buy" ? "rent2buy" : "finance";
  const activeQueue = manualReelQueues[activeQueueKey] || [];
  const activeQueuedItem = activeQueue[0] || null;
  const activeQueuedVehicle =
    manualReelQueueVehicles[activeQueueKey] || resolveQueuedVehicle(activeQueuedItem, vehicles || []);
  const activeQueueLock = manualReelQueueLocks[activeQueueKey] || null;
  const activeQueueLocked = Boolean(activeQueueLock?.locked) && !ignoreReelLock;
  const activeQueueProgress = queueProgress[activeQueueKey] || { completed: 0, total: activeQueue.length };
  const activeProgressTotal = activeQueueProgress.total || activeQueue.length;
  const activeProgressCompleted = Math.min(activeQueueProgress.completed || 0, activeProgressTotal || 0);
  const activeProgressPercent = activeProgressTotal ? Math.round((activeProgressCompleted / activeProgressTotal) * 100) : 0;
  const activeQueuedReg =
    activeQueuedVehicle?.reg || activeQueuedVehicle?.registration || activeQueuedItem?.reg || activeQueuedItem?.registration || "";
  const activeQueuedTitle = activeQueuedVehicle
    ? vehicleLabel(activeQueuedVehicle)
    : activeQueuedReg || activeQueuedItem?.id || "Queued vehicle";
  const activeQueuedImage = activeQueuedVehicle?.image || activeQueuedVehicle?.picture || "";
  const activeQueueStatus = activeQueueLocked
    ? `Locked until ${activeQueueLock?.until ? new Date(activeQueueLock.until).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "72-hour cooldown ends"}`
    : queueStatus[activeQueueKey] || "Ready";

  useEffect(() => {
    setGeneratedReel(null);
    setExportResult(null);
    setStatus("Ready");
    setCopyMessage("");
    setError("");
    setGenerationProgress({ active: false, label: "Ready", percent: 0, detail: "" });
    setExportProgress({ active: false, label: "Ready", percent: 0, detail: "" });
  }, [pipeline]);

  useEffect(() => {
    if (selectedVehicle && selectedVehicle.id !== selectedVehicleId) {
      setSelectedVehicleId(selectedVehicle.id);
    }
  }, [selectedVehicle, selectedVehicleId]);

  function updatePremiumUsp(queueKey, value) {
    const next = {
      ...premiumUsps,
      [queueKey]: value,
    };
    setPremiumUsps(next);
    savePremiumUsps(next);
    setGeneratedReel(null);
  }

  function updateDescriptionList(type, index, value) {
    if (type === "rent2buy") {
      const next = rentDescriptions.map((description, descriptionIndex) =>
        descriptionIndex === index ? value : description
      );
      setRentDescriptions(next);
      saveDescriptionList(PREMIUM_RENT_DESCRIPTIONS_STORAGE_KEY, next);
      return;
    }

    const next = financeDescriptions.map((description, descriptionIndex) =>
      descriptionIndex === index ? value : description
    );
    setFinanceDescriptions(next);
    saveDescriptionList(PREMIUM_FINANCE_DESCRIPTIONS_STORAGE_KEY, next);
  }

  function selectDescription(type, value) {
    const index = Number(value) || 0;

    if (type === "rent2buy") {
      const next = clampDescriptionIndex(index, rentDescriptions);
      setSelectedRentDescriptionIndex(next);
      saveSelectedDescriptionIndex(PREMIUM_SELECTED_RENT_DESCRIPTION_INDEX_KEY, next);
      return;
    }

    const next = clampDescriptionIndex(index, financeDescriptions);
    setSelectedFinanceDescriptionIndex(next);
    saveSelectedDescriptionIndex(PREMIUM_SELECTED_FINANCE_DESCRIPTION_INDEX_KEY, next);
  }

  function toggleDescriptionPanel(type) {
    setDescriptionPanelsOpen((current) => ({
      ...current,
      [type]: !current[type],
    }));
  }

  function updateGenerationProgress(label, percent, detail = "") {
    setGenerationProgress({
      active: label !== "Ready" || percent < 100,
      label,
      percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
      detail,
    });
  }

  function updateExportProgress(label, percent, detail = "") {
    setExportProgress({
      active: !["Ready", "Complete", "Failed"].includes(label),
      label,
      percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
      detail,
    });
  }

  function resetExportProgress() {
    setExportProgress({ active: false, label: "Ready", percent: 0, detail: "" });
  }

  function uspForPipeline(targetPipeline) {
    return targetPipeline === "rent2buy" ? premiumUsps.rent2buy : premiumUsps.finance;
  }

  async function generatePremiumReelForVehicle(vehicle, options = {}) {
    if (!vehicle) return null;

    const targetPipeline = normalizePipeline(vehicle.pipeline);
    const hookIndex = options.hookIndex || 0;
    const hook = options.hook || pickHookForPipeline(targetPipeline, hookIndex);
    const sourceLabel = options.sourceLabel || (targetPipeline === "rent2buy" ? "Rent2Buy stock" : "Finance stock");
    const progressDetail = options.progressDetail || vehicleRegistration(vehicle) || vehicleLabel(vehicle);

    setStatus(options.status || "Preparing reel");
    updateGenerationProgress("Preparing reel", 5, progressDetail);
    const reel = {
      ...buildPremiumReel(vehicle, hook, formValues.musicOn, uspForPipeline(targetPipeline)),
      sourceLabel,
      manualQueueType: options.queueKey || "",
      manualQueueVehicleId: options.queueItem?.id || options.queueItem?.reg || "",
    };
    const asset = await generatePremiumReelVideoAsset(reel, {
      onProgress: ({ label, percent }) => {
        setStatus(label);
        updateGenerationProgress(label, percent, progressDetail);
        if (options.queueKey) {
          setQueueStatus((current) => ({ ...current, [options.queueKey]: label }));
        }
      },
    });
    const nextReel = {
      ...reel,
      ...asset,
      fileName: asset.downloadName,
      blob: asset.blob,
    };

    setGeneratedReel(nextReel);
    setStatus("Ready");
    updateGenerationProgress("Ready", 100, progressDetail);
    return nextReel;
  }

  async function generateSelectedPremiumReel() {
    return generatePremiumReelForVehicle(selectedVehicle, { hook: selectedHook, status: "Preparing reel" });
  }

  function updateFormValue(name, value) {
    setFormValues((current) => {
      const next = { ...current, [name]: value };

      if (name === "reelType") {
        next.reelSource =
          value === "Finance" ? "Finance stock" : value === "Rent2Buy" ? "Rent2Buy stock" : "Mixed";
      }

      if (name === "reelSource") {
        next.reelType =
          value === "Finance stock" ? "Finance" : value === "Rent2Buy stock" ? "Rent2Buy" : current.reelType;
      }

      return next;
    });
    setGeneratedReel(null);
    setExportResult(null);
    setCopyMessage("");
  }

  function pickHookForPipeline(targetPipeline, index = 0) {
    const isRent = targetPipeline === "rent2buy";
    const pipelineHooks = isRent ? rentReelHooks : financeReelHooks;

    if (formValues.hookMode === "Custom hook" && formValues.customHook.trim()) {
      return formValues.customHook.trim().toUpperCase();
    }

    if (formValues.hookMode === "Single selected hook") {
      const selected = isRent ? formValues.rentHook : formValues.financeHook;
      return pipelineHooks.includes(selected) ? selected : pipelineHooks[0];
    }

    return pipelineHooks[index % pipelineHooks.length];
  }

  function selectedDescriptionTemplateForReel(reel) {
    const type = reel.pipeline === "rent2buy" ? "rent2buy" : "finance";

    if (type === "rent2buy") {
      return rentDescriptions[rentDescriptionIndex] || DEFAULT_RENT_DESCRIPTION;
    }

    return financeDescriptions[financeDescriptionIndex] || DEFAULT_FINANCE_DESCRIPTION;
  }

  async function copyReelDescription(reel) {
    const template = selectedDescriptionTemplateForReel(reel);
    const reelId = reel.creativeId || reel.id || "unknown";
    const copied = await copyTextToClipboard(fillDescriptionTemplate(template, reelId, reel));

    setCopyMessage(copied ? "Caption copied. MP4 download started." : "Caption could not auto-copy.");
    return copied;
  }

  async function downloadPremiumReelWithStatuses(reel, queueKey = "") {
    const exportDetail = reel.registration || reel.title || reel.id || "Premium reel";
    setStatus("Copying caption");
    updateExportProgress("Copying caption", 10, exportDetail);
    if (queueKey) setQueueStatus((current) => ({ ...current, [queueKey]: "Copying caption" }));
    await copyReelDescription(reel);

    const result = await downloadPremiumReelMp4(reel, {
      onPreparing: () => {
        setStatus("Preparing MP4");
        updateExportProgress("Preparing MP4", 25, exportDetail);
        if (queueKey) setQueueStatus((current) => ({ ...current, [queueKey]: "Preparing MP4" }));
      },
      onUploading: () => {
        setStatus("Uploading reel");
        updateExportProgress("Uploading reel", 45, exportDetail);
        if (queueKey) setQueueStatus((current) => ({ ...current, [queueKey]: "Uploading reel" }));
      },
      onConverting: () => {
        setStatus("Converting MP4");
        updateExportProgress("Converting MP4", 70, exportDetail);
        if (queueKey) setQueueStatus((current) => ({ ...current, [queueKey]: "Converting MP4" }));
      },
      onDownloading: () => {
        setStatus("Downloading MP4");
        updateExportProgress("Downloading MP4", 90, exportDetail);
        if (queueKey) setQueueStatus((current) => ({ ...current, [queueKey]: "Downloading MP4" }));
      },
    });

    onReelDownloadComplete?.(reel);
    updateExportProgress("Complete", 100, exportDetail);
    return result;
  }

  async function handleGenerate() {
    if (!selectedVehicle || isBusy) return null;

    setIsBusy(true);
    setError("");
    setCopyMessage("");
    setExportResult(null);
    resetExportProgress();

    try {
      return await generateSelectedPremiumReel();
    } catch (caughtError) {
      setError(caughtError.message || "Could not generate the premium reel.");
      setGenerationProgress((current) => ({ ...current, active: false, label: "Failed", percent: current.percent || 0 }));
      setStatus("Ready");
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportMp4() {
    if (isBusy) return;

    setIsBusy(true);
    setError("");
    setCopyMessage("");
    setExportResult(null);

    try {
      let reel = generatedReel;
      if (!reel) {
        reel = await generateSelectedPremiumReel();
      }

      if (!reel) return;

      const result = await downloadPremiumReelWithStatuses(reel);

      setExportResult(result);
      setStatus("Complete");
    } catch (caughtError) {
      setError(formatPremiumMp4Error(caughtError));
      updateExportProgress("Failed", exportProgress.percent || 70, "");
      setStatus("Failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGenerateCurrentQueuedReel() {
    if (isBusy || autoQueueRunning || !activeQueuedVehicle || activeQueueLocked) return;

    console.log("Premium queued reel lock check", {
      registration: activeQueuedReg || vehicleRegistration(activeQueuedVehicle),
      selectedReelType: activeQueueKey,
      selectedSource: activeQueuedVehicle?.source || activeQueuedVehicle?.pipeline || activeQueueKey,
      locked: Boolean(activeQueueLock?.locked),
      bypassed: ignoreReelLock,
      imageFields: {
        image: activeQueuedVehicle?.image || "",
        picture: activeQueuedVehicle?.picture || "",
        rent2buyDataPicture: activeQueuedVehicle?.rent2buyData?.picture || "",
        financePicture: activeQueuedVehicle?.financePicture || "",
      },
    });

    setIsBusy(true);
    setError("");
    setCopyMessage("");
    setExportResult(null);
    resetExportProgress();
    setQueueStatus((current) => ({ ...current, [activeQueueKey]: "Generating premium reel" }));

    try {
      const reel = await generatePremiumReelForVehicle(activeQueuedVehicle, {
        queueKey: activeQueueKey,
        queueItem: activeQueuedItem,
        sourceLabel: `Premium ${queueLabel(activeQueueKey)} queue`,
        progressDetail: `${activeQueuedReg || vehicleRegistration(activeQueuedVehicle)} | 1 of ${activeQueue.length}`,
      });
      setQueueStatus((current) => ({ ...current, [activeQueueKey]: reel ? "Complete" : "Failed" }));
    } catch (caughtError) {
      setError(caughtError.message || "Could not generate queued premium reel.");
      setQueueStatus((current) => ({ ...current, [activeQueueKey]: "Failed" }));
      setStatus("Failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAutoGeneratePremiumQueue() {
    if (isBusy || autoQueueRunning || activeQueueLocked || !activeQueue.length) return;

    const queueKey = activeQueueKey;
    const queueSnapshot = [...activeQueue];
    let completed = 0;

    setIsBusy(true);
    setAutoQueueRunning(true);
    setAutoQueueCancelRequested(false);
    autoQueueCancelRef.current = false;
    setError("");
    setCopyMessage("");
    setExportResult(null);
    resetExportProgress();
    setQueueProcessing({ label: "", index: 0, total: queueSnapshot.length });
    setQueueProgress((current) => ({ ...current, [queueKey]: { completed: 0, total: queueSnapshot.length } }));
    setQueueStatus((current) => ({ ...current, [queueKey]: "Preparing" }));

    try {
      for (const [queueIndex, queueItem] of queueSnapshot.entries()) {
        if (autoQueueCancelRef.current) break;

        const queuedVehicle = resolveQueuedVehicle(queueItem, vehicles || []);
        if (!queuedVehicle) {
          throw new Error("Queued vehicle no longer found in current stock.");
        }

        const lock = reelActionLocks[vehicleQueueKey(queuedVehicle)];
        console.log("Premium auto queue lock check", {
          registration: vehicleRegistration(queuedVehicle),
          selectedReelType: queuedVehicle?.pipeline,
          selectedSource: queuedVehicle?.source || queuedVehicle?.pipeline || activeQueueKey,
          locked: Boolean(lock?.locked),
          bypassed: ignoreReelLock,
          imageFields: {
            image: queuedVehicle?.image || "",
            picture: queuedVehicle?.picture || "",
            rent2buyDataPicture: queuedVehicle?.rent2buyData?.picture || "",
            financePicture: queuedVehicle?.financePicture || "",
          },
        });
        if (lock?.locked && !ignoreReelLock) {
          throw new Error("This vehicle is locked for reels for 72 hours after download.");
        }

        const queueDetail = `${vehicleRegistration(queuedVehicle) || vehicleLabel(queuedVehicle)} | ${queueIndex + 1} of ${queueSnapshot.length}`;
        setQueueProcessing({ label: vehicleLabel(queuedVehicle), index: queueIndex + 1, total: queueSnapshot.length });
        setQueueStatus((current) => ({ ...current, [queueKey]: "Generating premium reel" }));
        const reel = await generatePremiumReelForVehicle(queuedVehicle, {
          queueKey,
          queueItem,
          sourceLabel: `Premium ${queueLabel(queueKey)} queue`,
          progressDetail: queueDetail,
        });

        if (!reel) throw new Error("Queued vehicle could not be generated.");

        const result = await downloadPremiumReelWithStatuses(reel, queueKey);
        setExportResult(result);
        completed += 1;
        setQueueProgress((current) => ({ ...current, [queueKey]: { completed, total: queueSnapshot.length } }));
        onRemoveManualQueuedVehicle?.(queueKey);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      setQueueStatus((current) => ({
        ...current,
        [queueKey]: completed === queueSnapshot.length ? "Complete" : "Cancelled",
      }));
      setStatus(completed === queueSnapshot.length ? "Complete" : "Ready");
    } catch (caughtError) {
      setError(formatPremiumMp4Error(caughtError) || "Premium queue failed.");
      updateExportProgress("Failed", exportProgress.percent || 70, "");
      setQueueStatus((current) => ({ ...current, [queueKey]: "Failed" }));
      setStatus("Failed");
    } finally {
      setAutoQueueRunning(false);
      setAutoQueueCancelRequested(false);
      autoQueueCancelRef.current = false;
      setQueueProcessing({ label: "", index: 0, total: 0 });
      setIsBusy(false);
    }
  }

  function handleCancelPremiumQueue() {
    if (!autoQueueRunning) return;
    autoQueueCancelRef.current = true;
    setAutoQueueCancelRequested(true);
    setQueueStatus((current) => ({ ...current, [activeQueueKey]: "Cancelling" }));
  }

  function renderDescriptionPanel(type) {
    const isRent = type === "rent2buy";
    const labels = isRent ? PREMIUM_RENT_DESCRIPTION_LABELS : PREMIUM_FINANCE_DESCRIPTION_LABELS;
    const descriptions = isRent ? rentDescriptions : financeDescriptions;
    const selectedIndex = isRent ? rentDescriptionIndex : financeDescriptionIndex;
    const preview = isRent ? activeRentDescriptionPreview : activeFinanceDescriptionPreview;
    const title = isRent ? "Rent2Buy Reel Description" : "Finance Reel Description";
    const storageHint = selectedIndex === 2 ? "Saved automatically" : "Default preset";
    const bodyId = isRent ? "premium-rent-description-panel" : "premium-finance-description-panel";
    const selectId = isRent ? "premium-rent-description-select" : "premium-finance-description-select";
    const textareaId = isRent ? "premium-rent-custom-caption" : "premium-finance-custom-caption";

    return (
      <article className="premium-reel-beta__description-card">
        <div className="premium-reel-beta__description-header">
          <div>
            <h4>{title}</h4>
            <span>{storageHint}</span>
          </div>
          <button
            type="button"
            className="premium-reel-beta__description-toggle"
            onClick={() => toggleDescriptionPanel(type)}
            aria-expanded={descriptionPanelsOpen[type]}
            aria-controls={bodyId}
          >
            {descriptionPanelsOpen[type] ? "Hide" : "Show"}
          </button>
        </div>

        {descriptionPanelsOpen[type] ? (
          <div id={bodyId} className="premium-reel-beta__description-body">
            <label className="premium-reel-beta__label" htmlFor={selectId}>
              Caption option
            </label>
            <select
              id={selectId}
              className="premium-reel-beta__select"
              value={selectedIndex}
              onChange={(event) => selectDescription(type, event.target.value)}
              disabled={isBusy}
            >
              {labels.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>

            {selectedIndex === 2 ? (
              <div className="premium-reel-beta__control-group">
                <label className="premium-reel-beta__label" htmlFor={textareaId}>
                  My caption text
                </label>
                <textarea
                  id={textareaId}
                  className="premium-reel-beta__textarea"
                  value={descriptions[2] || ""}
                  onChange={(event) => updateDescriptionList(type, 2, event.target.value)}
                  disabled={isBusy}
                  rows={7}
                />
              </div>
            ) : null}

            <div className="premium-reel-beta__caption-preview">
              <span>Active preview</span>
              <pre>{preview}</pre>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  function renderProgressBar(title, progress, variant = "") {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
    const className = ["premium-reel-beta__progress", variant ? `premium-reel-beta__progress--${variant}` : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={className}>
        <div className="premium-reel-beta__progress-header">
          <strong>{title}</strong>
          <span>{percent}%</span>
        </div>
        <div className="premium-reel-beta__progress-track">
          <div style={{ width: `${percent}%` }} />
        </div>
        <p>{progress.label}</p>
        {progress.detail ? <small>{progress.detail}</small> : null}
      </div>
    );
  }

  function renderPremiumQueueSection() {
    return (
      <section className="premium-reel-beta__queue">
        <div className="premium-reel-beta__queue-header">
          <div>
            <span className="premium-reel-beta__eyebrow">Premium reel queue</span>
            <h3>Manual Premium Reel Queue</h3>
          </div>
          <strong>{activeQueue.length} queued</strong>
        </div>

        <div className="premium-reel-beta__queue-tabs">
          <button
            type="button"
            className={activeQueueKey === "finance" ? "is-active" : ""}
            onClick={() => onManualReelQueueTypeChange?.("finance")}
            disabled={autoQueueRunning}
          >
            Finance ({manualReelQueues.finance?.length || 0})
          </button>
          <button
            type="button"
            className={activeQueueKey === "rent2buy" ? "is-active" : ""}
            onClick={() => onManualReelQueueTypeChange?.("rent2buy")}
            disabled={autoQueueRunning}
          >
            Rent2Buy ({manualReelQueues.rent2buy?.length || 0})
          </button>
        </div>

        {activeQueuedItem ? (
          <div className="premium-reel-beta__queue-card">
            <div className="premium-reel-beta__queue-thumb">
              {activeQueuedImage ? <img src={activeQueuedImage} alt={activeQueuedTitle} /> : <span>No image</span>}
            </div>
            <div className="premium-reel-beta__queue-info">
              <strong>{activeQueuedReg || "No reg"}</strong>
              <span>{activeQueuedTitle}</span>
              <em>
                {queueLabel(activeQueueKey)} | Position 1 of {activeQueue.length}
              </em>
              <div className="premium-reel-beta__queue-progress">
                <div style={{ width: `${activeProgressPercent}%` }} />
              </div>
              <small>
                {activeProgressCompleted} of {activeProgressTotal || activeQueue.length} complete | Status: {activeQueueStatus}
              </small>
            </div>
          </div>
        ) : (
          <div className="premium-reel-beta__empty">No vehicles in the {queueLabel(activeQueueKey)} premium reel queue.</div>
        )}

        {queueProcessing.total ? (
          <div className="premium-reel-beta__queue-current">
            <strong>Current vehicle being processed</strong>
            <span>
              {queueProcessing.label || activeQueuedTitle} | {queueProcessing.index} of {queueProcessing.total}
            </span>
          </div>
        ) : null}

        <div className="premium-reel-beta__queue-actions">
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--primary"
            onClick={handleGenerateCurrentQueuedReel}
            disabled={isBusy || autoQueueRunning || !activeQueuedVehicle || activeQueueLocked}
          >
            {activeQueueLocked ? "Reel Locked" : "Generate Current Premium Reel"}
          </button>
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--primary"
            onClick={handleAutoGeneratePremiumQueue}
            disabled={isBusy || autoQueueRunning || !activeQueue.length || activeQueueLocked}
          >
            Auto Generate + Download Premium Queue
          </button>
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--secondary"
            onClick={handleCancelPremiumQueue}
            disabled={!autoQueueRunning || autoQueueCancelRequested}
          >
            Stop / Cancel Queue
          </button>
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--secondary"
            onClick={() => onNextManualQueuedVehicle?.(activeQueueKey)}
            disabled={isBusy || autoQueueRunning || activeQueue.length < 2}
          >
            Next
          </button>
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--secondary"
            onClick={() => onRemoveManualQueuedVehicle?.(activeQueueKey)}
            disabled={isBusy || autoQueueRunning || !activeQueue.length}
          >
            Remove
          </button>
          <button
            type="button"
            className="premium-reel-beta__button premium-reel-beta__button--danger"
            onClick={() => onClearManualReelQueue?.(activeQueueKey)}
            disabled={isBusy || autoQueueRunning || !activeQueue.length}
          >
            Clear queue
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="premium-reel-beta">
      <div className="premium-reel-beta__header">
        <div>
          <span className="premium-reel-beta__eyebrow">Premium reel studio</span>
          <h2>Premium Reel Studio</h2>
          <p>Original stock photos, existing hooks, red/black/white frame, 1080 x 1920 MP4 export with the current reel audio.</p>
        </div>
        <div className="premium-reel-beta__status">{status}</div>
      </div>

      {vehiclesError ? <div className="premium-reel-beta__error">{vehiclesError}</div> : null}
      {error ? <div className="premium-reel-beta__error">{error}</div> : null}
      {copyMessage ? <div className="premium-reel-beta__success">{copyMessage}</div> : null}

      <div className="premium-reel-beta__layout">
        <div className="premium-reel-beta__controls">
          <div className="premium-reel-beta__control-group">
            <label className="premium-reel-beta__label" htmlFor="premium-reel-pipeline">
              Reel type
            </label>
            <select
              id="premium-reel-pipeline"
              className="premium-reel-beta__select"
              value={formValues.reelType === "Rent2Buy" ? "Rent2Buy" : "Finance"}
              onChange={(event) => updateFormValue("reelType", event.target.value)}
              disabled={isBusy}
            >
              {reelTypes.filter((type) => type !== "Mixed").map((type) => (
                <option key={type} value={type}>
                  {type === "Finance" ? "Van Finance" : type}
                </option>
              ))}
            </select>
          </div>

          <div className="premium-reel-beta__control-group">
            <label className="premium-reel-beta__label" htmlFor="premium-reel-source">
              Reel source
            </label>
            <select
              id="premium-reel-source"
              className="premium-reel-beta__select"
              value={formValues.reelSource}
              onChange={(event) => updateFormValue("reelSource", event.target.value)}
              disabled={isBusy}
            >
              {reelSources.filter((source) => source !== "Uploaded images").map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>

          <div className="premium-reel-beta__control-group">
            <label className="premium-reel-beta__label" htmlFor="premium-reel-vehicle">
              Vehicle
            </label>
            <select
              id="premium-reel-vehicle"
              className="premium-reel-beta__select"
              value={selectedVehicle?.id || ""}
              onChange={(event) => {
                setSelectedVehicleId(event.target.value);
                setGeneratedReel(null);
                setExportResult(null);
              }}
              disabled={isBusy || vehiclesLoading || !eligibleVehicles.length}
            >
              {eligibleVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicleRegistration(vehicle) || vehicleLabel(vehicle)}
                </option>
              ))}
            </select>
          </div>

          <div className="premium-reel-beta__control-group">
            <label className="premium-reel-beta__label" htmlFor="premium-reel-hook-mode">
              Hook mode
            </label>
            <select
              id="premium-reel-hook-mode"
              className="premium-reel-beta__select"
              value={formValues.hookMode}
              onChange={(event) => updateFormValue("hookMode", event.target.value)}
              disabled={isBusy}
            >
              {reelHookModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>

          {formValues.hookMode === "Single selected hook" ? (
            <div className="premium-reel-beta__control-group">
              <label className="premium-reel-beta__label" htmlFor="premium-reel-hook">
                Existing hook
              </label>
              <select
                id="premium-reel-hook"
                className="premium-reel-beta__select"
                value={pipeline === "rent2buy" ? formValues.rentHook : formValues.financeHook}
                onChange={(event) =>
                  updateFormValue(pipeline === "rent2buy" ? "rentHook" : "financeHook", event.target.value)
                }
                disabled={isBusy}
              >
                {hookOptions.map((hook) => (
                  <option key={hook} value={hook}>
                    {hook}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {formValues.hookMode === "Custom hook" ? (
            <div className="premium-reel-beta__control-group">
              <label className="premium-reel-beta__label" htmlFor="premium-reel-custom-hook">
                Custom hook
              </label>
              <input
                id="premium-reel-custom-hook"
                className="premium-reel-beta__input"
                value={formValues.customHook}
                onChange={(event) => updateFormValue("customHook", event.target.value)}
                disabled={isBusy}
                placeholder={pipeline === "rent2buy" ? "RENT2BUY THIS VAN" : "£99 DEPOSIT VAN FINANCE"}
              />
            </div>
          ) : null}

          <div className="premium-reel-beta__usp-grid">
            <div className="premium-reel-beta__control-group">
              <label className="premium-reel-beta__label" htmlFor="premium-finance-usp">
                Finance USP
              </label>
              <input
                id="premium-finance-usp"
                className="premium-reel-beta__input"
                value={premiumUsps.finance}
                onChange={(event) => updatePremiumUsp("finance", event.target.value)}
                disabled={isBusy}
              />
            </div>
            <div className="premium-reel-beta__control-group">
              <label className="premium-reel-beta__label" htmlFor="premium-rent-usp">
                Rent2Buy USP
              </label>
              <input
                id="premium-rent-usp"
                className="premium-reel-beta__input"
                value={premiumUsps.rent2buy}
                onChange={(event) => updatePremiumUsp("rent2buy", event.target.value)}
                disabled={isBusy}
              />
            </div>
          </div>

          <section className="premium-reel-beta__descriptions">
            <div className="premium-reel-beta__descriptions-heading">
              <span className="premium-reel-beta__eyebrow">Caption copy</span>
              <h3>Reel Descriptions</h3>
            </div>
            {renderDescriptionPanel("finance")}
            {renderDescriptionPanel("rent2buy")}
          </section>

          <div className="premium-reel-beta__details">
            <div>
              <span>Photo source</span>
              <strong>Original stock yard image</strong>
            </div>
            <div>
              <span>Format</span>
              <strong>1080 x 1920 vertical MP4</strong>
            </div>
            <div>
              <span>Audio</span>
              <strong>Existing reel music</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong>11 seconds</strong>
            </div>
          </div>

          <label className="premium-reel-beta__toggle">
            <input
              type="checkbox"
              checked={formValues.musicOn}
              onChange={(event) => {
                updateFormValue("musicOn", event.target.checked);
              }}
              disabled={isBusy}
            />
            <span>Use existing reel music</span>
          </label>

          <div className="premium-reel-beta__actions">
            <button
              className="premium-reel-beta__button premium-reel-beta__button--secondary"
              type="button"
              onClick={handleGenerate}
              disabled={isBusy || !selectedVehicle}
            >
              Generate Preview
            </button>
            <button
              className="premium-reel-beta__button premium-reel-beta__button--primary"
              type="button"
              onClick={handleExportMp4}
              disabled={isBusy || !selectedVehicle}
            >
              Export MP4
            </button>
          </div>

        </div>

        <div className="premium-reel-beta__output">
          <div className="premium-reel-beta__stage">
            <div className="premium-reel-beta__phone">
              {generatedReel?.url ? (
                <video
                  className="premium-reel-beta__video"
                  src={generatedReel.url}
                  poster={generatedReel.posterUrl}
                  controls
                  playsInline
                />
              ) : selectedVehicle ? (
                <div className="premium-reel-beta__mock-reel">
                  <img src={selectedVehicle.image || selectedVehicle.picture} alt={vehicleLabel(selectedVehicle)} />
                  <div className="premium-reel-beta__mock-frame">
                    <span>{pipeline === "rent2buy" ? "RENT2BUY VANS" : "VAN FINANCE COMPANY"}</span>
                    <strong>{selectedHook}</strong>
                    <em>{cleanDisplayText(previewContent?.priceLine)}</em>
                    <small>{cleanDisplayText(previewContent?.ctaLine)}</small>
                  </div>
                </div>
              ) : (
                <div className="premium-reel-beta__empty">
                  {vehiclesLoading ? "Loading vehicles..." : "No vehicles with stock photos found."}
                </div>
              )}
            </div>
          </div>

          <section className="premium-reel-beta__generated">
            <div>
              <span className="premium-reel-beta__eyebrow">Output</span>
              <h3>Generated Premium Reels</h3>
            </div>
            <div className="premium-reel-beta__generated-card">
              <strong>{generatedReel ? generatedReel.title || generatedReel.vehicleName || "Latest premium reel" : "No premium reel generated yet"}</strong>
              <span>Status: {status}</span>
              {generatedReel ? (
                <em>
                  {generatedReel.registration || "No reg"} | {generatedReel.pipeline === "rent2buy" ? "Rent2Buy" : "Finance"} |{" "}
                  {generatedReel.musicOn ? "Music on" : "Music off"}
                </em>
              ) : (
                <em>Generate a preview or queue reel to show the latest output here.</em>
              )}
              {copyMessage ? <small>{copyMessage}</small> : null}
              {exportResult ? (
                <small>
                  Downloaded {exportResult.filename}
                  {exportResult.size ? ` (${formatBytes(exportResult.size)})` : ""}
                </small>
              ) : null}
            </div>
            {renderProgressBar("Generation progress", generationProgress, "generation")}
            {renderProgressBar("MP4 export progress", exportProgress, "export")}
            {generatedReel ? (
              <button
                className="premium-reel-beta__button premium-reel-beta__button--primary"
                type="button"
                onClick={handleExportMp4}
                disabled={isBusy}
              >
                Export Latest MP4
              </button>
            ) : null}
          </section>

          {renderPremiumQueueSection()}
        </div>
      </div>
    </section>
  );
}
