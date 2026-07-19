// ðŸš€ INSTANT TRACK + REDIRECT (runs before React loads)
if (
  typeof window !== "undefined" &&
  (window.location.pathname.startsWith("/track") || window.location.pathname.startsWith("/r/"))
) {  try {
    const params = new URLSearchParams(window.location.search);
   let type = params.get("type") === "rent2buy" ? "rent2buy" : "finance";
let reelId = params.get("reel") || "unknown";
const source = params.get("src") || "reel";

if (window.location.pathname.startsWith("/r/")) {
  const parts = window.location.pathname.split("/").filter(Boolean);

  type = parts[1] === "rent2buy" ? "rent2buy" : "finance";
  reelId = parts[2] || "unknown";
}

    // ðŸ”¥ send tracking without blocking redirect
    const payload = JSON.stringify({ type, reelId, source });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", payload);
    } else {
      fetch("/api/track", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    }

    const reg = String(params.get("reg") || params.get("registration") || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "");

const redirects = {
  finance: reg
    ? `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/${encodeURIComponent(reg)}`
    : "https://www.vanfinancecompany.co.uk/",
  rent2buy: "https://www.rent2buyvans.co.uk/",
};

window.location.replace(redirects[type] || "https://www.vanfinancecompany.co.uk/");
  } catch (e) {
    // fallback redirect
    window.location.replace("https://www.vanfinancecompany.co.uk/");
  }
}

import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ControlCentrePage from "./pages/ControlCentrePage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import MarketingTotalsPage from "./pages/MarketingTotalsPage.jsx";
import CustomerDatabasePage from "./pages/CustomerDatabasePage.jsx";
import MarketingCentrePage from "./pages/MarketingCentrePage.jsx";
import StockPage from "./pages/StockPage.jsx";
import VanscoStockWatchPage from "./pages/VanscoStockWatchPage.jsx";
import ReelFactoryPage from "./pages/ReelFactoryPage.jsx";
import PremiumReelStudioBetaPage from "./pages/PremiumReelStudioBetaPage.jsx";
import ReelLabBetaPage from "./pages/ReelLabBetaPage.jsx";
import YouTubeGeneratorPage from "./pages/YouTubeGeneratorPage.jsx";
import CreativeLibraryPage from "./pages/CreativeLibraryPage.jsx";
import PostingDeskPage from "./pages/PostingDeskPage.jsx";
import DailyTargetBanner from "./components/DailyTargetBanner.jsx";
import { londonDateKey } from "./lib/marketingDailyOperations.js";
import { recordDailyMarketingActivity } from "./services/marketingDailyOperations.js";
import {
  ctaOptions,
  financeReelHooks,
  hookOptions,
  reelHookModes,
  reelSources,
  reelTypes,
  rentReelHooks,
  templateOptions,
} from "./data/mockData.js";
import {
  buildFinanceReelContent,
  buildPostingCaption,
  buildRentReelContent,
  cleanPublicReelLabel,
  createCreativeFromReel,
  createReelRecord,
  createCreativeRecord,
  downloadCreativeReelVideo,
  downloadReelVideo,
  filterCreatives,
  filterVehicles,
  generateReelVideoAsset,
  isToday,
  loadReelVideoBlob,
  saveReelVideoBlob,
  sanitizePostingCaption,
  sortVehiclesNewestAddedFirst,
} from "./utils/creativeUtils.js";
import { downloadFacebookMp4Reel } from "./utils/facebookMp4Export.js";
import {
  downloadPremiumReelMp4,
  generatePremiumReelVideoAsset,
} from "./utils/premiumReelVideoExport.js";
import {
  loadYouTubeCmsUploadsAsync,
  loadYouTubeCmsUploads,
  resolveYouTubeImageOrder,
  YOUTUBE_DEFAULT_IMAGE_COUNT,
} from "./utils/youtubeImageResolution.js";
import { fetchMarketingVehicles, getCarsStockLoadState } from "./services/marketingVehicles.js";
import {
  deleteMarketingCreative,
  fetchMarketingCreatives,
  fetchTodayReelCreatives,
  saveMarketingCreatives,
} from "./services/marketingCreatives.js";
import { fetchReelClickDashboard, logReelClick } from "./services/reelClickTracking.js";
import {
  fetchRecentReelVehicleUsage,
  logReelVehicleUsage,
  REEL_VEHICLE_COOLDOWN_DAYS,
} from "./services/reelVehicleUsage.js";

const DEFAULT_STOCK_FILTERS = {
  pipeline: "all",
  search: "",
  minPrice: "",
  maxPrice: "",
};

const DEFAULT_LIBRARY_FILTERS = {
  pipeline: "all",
  search: "",
  minPrice: "",
  maxPrice: "",
  status: "all",
  destination: "all",
};

const DEFAULT_REEL_FACTORY_FORM = {
  reelSource: "Mixed",
  quantity: 10,
  hookMode: "Auto rotate hooks",
  reelType: "Mixed",
  financeHook: financeReelHooks[0],
  rentHook: rentReelHooks[0],
  customHook: "",
  musicOn: true,
  ignoreVehicleCooldown: false,
};

const FINANCE_FACEBOOK_URL = "https://www.facebook.com/VanFinance";
const RENT_FACEBOOK_URL = "https://www.facebook.com/profile.php?id=100076904157939";
const MARKETPLACE_URL = "https://www.facebook.com/marketplace/create/vehicle";
const FINANCE_SYNC_URL = "https://www.vanfinancecompany.co.uk/sync-vans";
const RENT_SYNC_URL = "https://www.rent2buyvans.co.uk/sync-vans";
const TRACK_REDIRECTS = {
  finance: "https://www.vanfinancecompany.co.uk/",
  rent2buy: "https://www.rent2buyvans.co.uk/",
};
const HIDDEN_POSTING_STORAGE_KEYS = {
  vanFinanceFacebook: "marketingHiddenVanFinanceFacebookVehicles",
  rent2BuyFacebook: "marketingHiddenRent2BuyFacebookVehicles",
  marketplace: "marketingHiddenMarketplaceVehicles",
};
const MANUAL_REEL_QUEUE_STORAGE_KEYS = {
  finance: "manualFinanceReelQueue",
  rent2buy: "manualRent2BuyReelQueue",
};
const REEL_LAB_QUEUE_STORAGE_KEYS = {
  vanFinance: "reelLabQueue_vanFinance",
  rent2buy: "reelLabQueue_rent2buy",
};
const YOUTUBE_QUEUE_STORAGE_KEYS = {
  vanFinance: "youtubeGeneratorQueue_vanFinance",
  rent2buy: "youtubeGeneratorQueue_rent2buy",
  cars: "youtubeGeneratorQueue_cars",
};

const REEL_CLICK_HISTORY_STORAGE_KEY = "marketingReelClickHistory";
const RANDOM_REEL_HISTORY_STORAGE_KEY = "marketingRecentRandomReelVehicleIds";
const REEL_DOWNLOAD_COOLDOWN_STORAGE_KEY = "reelDownloadCooldowns";
const ROLLING_REEL_WINDOW_DAYS = 7;
const MAX_RANDOM_REEL_HISTORY = 24;
const REEL_DOWNLOAD_COOLDOWN_HOURS = 72;
const REEL_DOWNLOAD_COOLDOWN_MS = REEL_DOWNLOAD_COOLDOWN_HOURS * 60 * 60 * 1000;

function parseDateValue(value) {
  const date = value ? new Date(value) : null;
  return Number.isNaN(date?.getTime?.()) ? null : date;
}

function isWithinLastDays(value, days = ROLLING_REEL_WINDOW_DAYS) {
  const date = parseDateValue(value);
  if (!date) return false;

  const now = new Date();
  const threshold = new Date(now);
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - (days - 1));

  return date >= threshold;
}

function loadReelClickHistory() {
  if (typeof window === "undefined") return [];

  try {
    const saved = JSON.parse(localStorage.getItem(REEL_CLICK_HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter((entry) => entry?.date && isWithinLastDays(entry.date, ROLLING_REEL_WINDOW_DAYS))
      : [];
  } catch {
    return [];
  }
}

function saveReelClickHistory(history) {
  if (typeof window === "undefined") return;

  localStorage.setItem(REEL_CLICK_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function normalizeStockRegistration(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function creativeRegistration(creative) {
  return normalizeStockRegistration(
    creative?.vehicle?.reg ||
      creative?.vehicle?.registration ||
      creative?.registration ||
      creative?.vehicle?.title ||
      creative?.vehicle?.name ||
      ""
  );
}

function vehicleRegistrationKey(vehicle) {
  return normalizeStockRegistration(
    vehicle?.reg ||
      vehicle?.registration ||
      vehicle?.title ||
      vehicle?.name ||
      ""
  );
}

function vehicleIdKey(value) {
  return String(value || "").trim().toLowerCase();
}

function reelActionCooldownKeys(value) {
  const id = String(value?.vehicleId || value?.id || "").trim();
  const registration = normalizeRegistration(
    value?.registration ||
      value?.reg ||
      value?.vehicle?.registration ||
      value?.vehicle?.reg ||
      value?.title ||
      value?.name ||
      ""
  );

  return [id ? `id:${id}` : "", registration ? `reg:${registration}` : ""].filter(Boolean);
}

function pruneReelDownloadCooldowns(cooldowns, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(cooldowns || {}).filter(([, value]) => {
      const downloadedAt = Number(value?.downloadedAt || 0);
      return downloadedAt && now - downloadedAt < REEL_DOWNLOAD_COOLDOWN_MS;
    })
  );
}

function loadReelDownloadCooldowns() {
  if (typeof window === "undefined") return {};

  try {
    return pruneReelDownloadCooldowns(JSON.parse(localStorage.getItem(REEL_DOWNLOAD_COOLDOWN_STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

function saveReelDownloadCooldowns(cooldowns) {
  if (typeof window === "undefined") return;
  const pruned = pruneReelDownloadCooldowns(cooldowns);

  if (Object.keys(pruned).length) {
    localStorage.setItem(REEL_DOWNLOAD_COOLDOWN_STORAGE_KEY, JSON.stringify(pruned));
  } else {
    localStorage.removeItem(REEL_DOWNLOAD_COOLDOWN_STORAGE_KEY);
  }
}

function getReelActionLock(value, cooldowns, now = Date.now()) {
  const cooldown = reelActionCooldownKeys(value)
    .map((key) => cooldowns[key])
    .filter(Boolean)
    .sort((a, b) => Number(b.downloadedAt || 0) - Number(a.downloadedAt || 0))[0];
  const downloadedAt = Number(cooldown?.downloadedAt || 0);

  if (downloadedAt && now - downloadedAt < REEL_DOWNLOAD_COOLDOWN_MS) {
    return {
      locked: true,
      until: downloadedAt + REEL_DOWNLOAD_COOLDOWN_MS,
    };
  }

  return { locked: false, until: 0 };
}

function findCurrentStockVehicleForCreative(creative, vehicles) {
  const creativeReg = creativeRegistration(creative);
  if (creativeReg) {
    const regMatch = vehicles.find((vehicle) => vehicleRegistrationKey(vehicle) === creativeReg);
    if (regMatch) return regMatch;
  }

  const creativeVehicleId = vehicleIdKey(creative?.vehicle?.id || creative?.vehicleId);
  if (!creativeVehicleId) return null;

  return vehicles.find((vehicle) => vehicleIdKey(vehicle.id) === creativeVehicleId) || null;
}

function mergeReelClickHistory(stats) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const history = loadReelClickHistory();
  const nextEntry = {
    date: todayKey,
    topReels: Array.isArray(stats?.topReels) ? stats.topReels : [],
  };

  const merged = [
    nextEntry,
    ...history.filter((entry) => entry.date !== todayKey),
  ]
    .filter((entry) => isWithinLastDays(entry.date, ROLLING_REEL_WINDOW_DAYS))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  saveReelClickHistory(merged);
  return merged;
}

function buildRollingTopReels(history) {
  const counts = new Map();

  for (const day of history) {
    for (const reel of day.topReels || []) {
      const key = `${reel.type || "finance"}::${reel.reelId || "unknown"}`;
      const previous = counts.get(key) || {
        type: reel.type || "finance",
        reelId: reel.reelId || "unknown",
        clickCount: 0,
      };

      counts.set(key, {
        ...previous,
        clickCount: previous.clickCount + (Number(reel.clickCount) || 0),
      });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.clickCount - a.clickCount)
    .slice(0, 10);
}

function loadRecentRandomReelVehicleIds() {
  if (typeof window === "undefined") return [];

  try {
    const saved = JSON.parse(localStorage.getItem(RANDOM_REEL_HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return [];

    return saved
      .flatMap((entry) => {
        if (entry && typeof entry === "object") {
          return [
            entry.registration,
            entry.id,
            ...(Array.isArray(entry.keys) ? entry.keys : []),
          ];
        }

        return [entry];
      })
      .map((key) => String(key || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveRecentRandomReelVehicleIds(ids) {
  if (typeof window === "undefined") return;

  const seen = new Set();
  const normalized = ids
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_RANDOM_REEL_HISTORY);
  localStorage.setItem(RANDOM_REEL_HISTORY_STORAGE_KEY, JSON.stringify(normalized));
}

function shuffleItems(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function getRandomPoolItemKey(item) {
  if (item.kind === "vehicle") {
    const { registration, id } = getVehicleCooldownKeys(item.vehicle);
    return `vehicle:${registration || id}`;
  }
  if (item.kind === "upload") return `upload:${item.image.id}`;
  return JSON.stringify(item);
}

function isRecentRandomPoolVehicle(item, recentIds) {
  return item.kind === "vehicle" && getVehicleCooldownKeys(item.vehicle).keys.some((key) => recentIds.has(key));
}

function rankRandomPool(pool, recentVehicleIds = []) {
  const recentIds = new Set(recentVehicleIds.map((id) => String(id || "").trim()).filter(Boolean));
  const fresh = [];
  const recent = [];

  for (const item of pool) {
    if (isRecentRandomPoolVehicle(item, recentIds)) {
      recent.push(item);
    } else {
      fresh.push(item);
    }
  }

  return [...shuffleItems(fresh), ...shuffleItems(recent)];
}

const VIEW_PATHS = {
  Dashboard: "/",
  "Marketing Totals": "/marketing-totals",
  Stock: "/stock",
  "Customer Database": "/customer-database",
  "Marketing Centre": "/marketing-centre",
  "Vansco Stock Watch": "/vansco-stock-watch",
  "Reel Factory": "/reel-factory",
  "Premium Reel Studio": "/premium-reel-studio",
  "Reel Lab Beta": "/reel-lab",
  "YouTube Generator": "/youtube-generator",
  "Creative Library": "/creative-library",
  "Van Finance Facebook": "/van-finance-facebook",
  "Rent2Buy Facebook": "/rent2buy-facebook",
  "Facebook Marketplace": "/facebook-marketplace",
};

function viewFromPath() {
  if (typeof window === "undefined") return "Dashboard";

  const path = window.location.pathname;

  if (path === "/stock") return "Stock";
  if (path === "/marketing-totals") return "Marketing Totals";
  if (path === "/customer-database") return "Customer Database";
  if (path === "/marketing-centre") return "Marketing Centre";
  if (path === "/vansco-stock-watch") return "Vansco Stock Watch";
  if (path === "/reel-factory") return "Reel Factory";
  if (path === "/premium-reel-studio" || path === "/reel-studio-beta" || path === "/premium-reels") {
    return "Premium Reel Studio";
  }
  if (path === "/reel-lab") return "Reel Lab Beta";
  if (path === "/youtube-generator" || path === "/youtube-shorts-beta") return "YouTube Generator";
  if (path === "/creative-library") return "Creative Library";
  if (path === "/van-finance-facebook") return "Van Finance Facebook";
  if (path === "/rent2buy-facebook") return "Rent2Buy Facebook";
  if (path === "/facebook-marketplace") return "Facebook Marketplace";

  return "Dashboard";
}

function loadHiddenPostingIds(pageKey) {
  try {
    const saved = localStorage.getItem(HIDDEN_POSTING_STORAGE_KEYS[pageKey]);
    return saved ? JSON.parse(saved).map(normalizePostingVehicleId) : [];
  } catch {
    return [];
  }
}

function normalizePostingVehicleId(vehicleOrId) {
  const rawId =
    vehicleOrId && typeof vehicleOrId === "object"
      ? vehicleOrId.id
      : vehicleOrId;
  return String(rawId ?? "");
}

function normalizeRegistration(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function reelTypeForPipeline(pipeline) {
  return pipeline === "rent2buy" ? "rent2buy" : "finance";
}

function getVehicleCooldownKeys(vehicle) {
  const registration = normalizeRegistration(
    vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name,
  );
  const id = String(vehicle?.id || "").trim();

  return {
    registration,
    id,
    keys: [registration, id].filter(Boolean),
  };
}

function getReelVehicleKey(vehicleOrReel) {
  const registration = normalizeRegistration(
    vehicleOrReel?.reg ||
      vehicleOrReel?.registration ||
      vehicleOrReel?.title ||
      vehicleOrReel?.name,
  );
  if (registration) return registration;

  const id = vehicleOrReel?.id || vehicleOrReel?.vehicleId;
  if (id) return String(id).trim();

  return String(vehicleOrReel?.name || vehicleOrReel?.title || "").trim().toLowerCase();
}

function getReelVehicleUsageKeys(vehicleOrReel) {
  return getVehicleCooldownKeys({
    id: vehicleOrReel?.id || vehicleOrReel?.vehicleId,
    reg: vehicleOrReel?.reg || vehicleOrReel?.registration,
    title: vehicleOrReel?.title,
    name: vehicleOrReel?.name,
  }).keys;
}

function buildRecentUsageLookup(rows) {
  const lookup = {
    finance: new Set(),
    rent2buy: new Set(),
  };

  rows.forEach((row) => {
    const reelType = row.reel_type === "rent2buy" ? "rent2buy" : "finance";
    if (row.vehicle_key) lookup[reelType].add(String(row.vehicle_key));
    const registration = normalizeRegistration(row.registration);
    if (registration) lookup[reelType].add(registration);
  });

  return lookup;
}

function isRecentlyUsedReelVehicle(item, recentUsageLookup) {
  if (item.kind !== "vehicle") return false;
  const reelType = reelTypeForPipeline(item.vehicle.pipeline);
  return getReelVehicleUsageKeys(item.vehicle).some((key) =>
    recentUsageLookup[reelType]?.has(key),
  );
}

function recentUsageKeysFromRows(rows) {
  return rows.flatMap((row) => [
    normalizeRegistration(row.registration),
    String(row.vehicle_key || "").trim(),
  ]).filter(Boolean);
}

function appendCooldownWarning(current, next) {
  if (!next) return current;
  return current ? `${current} ${next}` : next;
}

function reelVehicleUsagePayloadFromReel(reel) {
  if (reel.sourceType !== "stock") return null;
  const vehicleKey = getReelVehicleKey(reel);
  if (!vehicleKey) return null;

  return {
    reel_type: reelTypeForPipeline(reel.pipeline),
    vehicle_key: vehicleKey,
    registration: normalizeRegistration(reel.registration),
    vehicle_title: reel.title || "",
    source: "generate",
  };
}

function saveHiddenPostingIds(pageKey, ids) {
  const storageKey = HIDDEN_POSTING_STORAGE_KEYS[pageKey];
  if (!storageKey) return;

  const normalizedIds = ids.map(normalizePostingVehicleId).filter(Boolean);

  if (normalizedIds.length) {
    localStorage.setItem(storageKey, JSON.stringify(normalizedIds));
  } else {
    localStorage.removeItem(storageKey);
  }
}

function getManualQueueVehicleId(vehicle) {
  return String(vehicle?.id || vehicle?.reg || vehicle?.registration || vehicle?.name || "");
}

function getManualQueueRegistration(value) {
  return normalizeRegistration(
    value?.reg ||
      value?.registration ||
      value?.title ||
      value?.name ||
      value?.vanDescription ||
      value?.description ||
      ""
  );
}

function getManualQueueTargetPipeline(queueKey) {
  return queueKey === "rent2buy" ? "rent2buy" : "vanFinance";
}

function createManualQueueItem(vehicle, queueKey) {
  const targetPipeline = getManualQueueTargetPipeline(queueKey);
  const reelVehicle = asPipelineVehicle(vehicle, targetPipeline);

  console.log("Manual reel queue payload", {
    registration: reelVehicle?.reg || reelVehicle?.registration || vehicle?.reg || "",
    reelType: queueKey,
    source: targetPipeline,
    imageFields: {
      image: reelVehicle?.image || "",
      picture: reelVehicle?.picture || "",
      rent2buyDataPicture: reelVehicle?.rent2buyData?.picture || "",
      financePicture: reelVehicle?.financePicture || "",
    },
  });

  return {
    id: String(vehicle?.id || "").trim(),
    reg: getManualQueueRegistra…15601 tokens truncated…Lock,
    });

    if (lock.locked && !ignoreReelLock) {
      setGenerationMessage("This vehicle is locked for reels for 72 hours after download.");
      setCreativeError("");
      return failManualQueueGeneration("This vehicle is locked for reels for 72 hours after download.");
    }

    setGenerationMessage("");
    setCreativeError("");
    setManualReelQueueType(queueKey);

    const reel = createReelFromVehicle(vehicle, {
      hook: pickHookForPipeline(vehicle.pipeline, 0),
      sourceType: "stock",
      sourceLabel: queueKey === "rent2buy" ? "Manual Rent2Buy queue" : "Manual Finance queue",
    });

    options.onStatus?.("Generating reel...");
    setGenerationMessage(`Generating manual reel for ${vehicle.name || vehicle.reg || "queued vehicle"}...`);

    try {
      const videoAsset = await generateReelVideoAsset(reel);
      const nextReel = {
        ...reel,
        manualQueueType: queueKey,
        manualQueueVehicleId: queueItem.id || queueItem.reg,
        url: videoAsset.url,
        downloadName: videoAsset.downloadName,
        posterUrl: videoAsset.posterUrl,
        extension: videoAsset.extension,
        mimeType: videoAsset.mimeType,
        audioEmbedded: videoAsset.audioEmbedded,
        blob: videoAsset.blob,
        fileName: videoAsset.downloadName,
      };
      let queueMessage = "";

      const generatedUsage = reelVehicleUsagePayloadFromReel(nextReel);
      if (generatedUsage) {
        try {
          const { setupMissing } = await logReelVehicleUsage([generatedUsage]);
          if (setupMissing) {
            queueMessage =
              " Vehicle usage was not logged because reel_vehicle_usage is not set up yet.";
          }
        } catch (error) {
          queueMessage = ` Vehicle usage could not be logged: ${error.message || "unknown error"}.`;
        }
      }

      setTodayReels((prev) => [nextReel, ...prev].slice(0, 20));

      try {
        options.onStatus?.("Saving reel...");
        const [libraryCreative] = await addReelsToCreativeLibrary([nextReel]);
        if (libraryCreative) {
          await saveReelVideoBlob(libraryCreative.id, nextReel.blob, {
            downloadName: nextReel.downloadName,
            mimeType: nextReel.mimeType,
          }).catch(() => {});
          setTodayReels((prev) =>
            prev.map((item) =>
              item.id === nextReel.id ? { ...item, creativeId: libraryCreative.id } : item
            )
          );
        }
        setGenerationMessage(
          `Generated manual reel for ${vehicle.name || vehicle.reg || "queued vehicle"}.${queueMessage}`
        );
        return nextReel;
      } catch (error) {
        setCreativeError(error.message || "Could not save manual reel to Creative Library.");
        setGenerationMessage(
          `Generated manual reel for ${vehicle.name || vehicle.reg || "queued vehicle"}.${queueMessage}`
        );
        if (options.throwOnError) throw error;
        return nextReel;
      }
    } catch (error) {
      setCreativeError(error.message || "Could not generate manual reel video.");
      setGenerationMessage("");
      if (options.throwOnError) throw error;
      return null;
    }
  }

  function handleViewCreatives() {
    setCurrentView("Creative Library");
  }

  function handleClearReelFactorySelection() {
    setReelFactoryVehicleId("");
    setReelFactorySelectionMode("");
    setGenerationMessage("");
  }

  function handleNavigate(view) {
    if (view === "Reel Factory") {
      handleClearReelFactorySelection();
    }
    const nextPath = VIEW_PATHS[view] || "/";
    if (typeof window !== "undefined" && window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setCurrentView(view);
  }

  function toggleSelectedVehicle(vehicleId) {
    setSelectedVehicleId(vehicleId);
    setSelectedVehicleIds((prev) =>
      prev.includes(vehicleId)
        ? prev.filter((id) => id !== vehicleId)
        : [...prev, vehicleId]
    );
  }

  function handleFocusVehicle(vehicleId) {
    setSelectedVehicleId(vehicleId);
    setSelectedVehicleIds((prev) => (prev.includes(vehicleId) ? prev : [...prev, vehicleId]));
  }

  async function handleGenerateCreatives() {
    setGenerationMessage("");
    setCreativeError("");

    const targetVehicles = vehicles.filter((vehicle) =>
      selectedVehicleIds.includes(vehicle.id)
    );

    if (!targetVehicles.length) {
      setGenerationMessage("Select at least one vehicle before generating creatives.");
      return;
    }

    const versionCount = Math.max(1, Math.min(12, Number(factoryForm.numberOfVersions) || 1));
    const nextCreatives = targetVehicles.flatMap((vehicle) =>
      Array.from({ length: versionCount }, (_, index) =>
        createCreativeRecord(
          vehicle,
          {
            templateType: factoryForm.templateType,
            hookStyle:
              index % 2 === 0 ? factoryForm.hookStyle : `${factoryForm.hookStyle} Variation`,
            cta: factoryForm.cta,
          },
          index
        )
      )
    );

    try {
      const savedCreatives = await saveMarketingCreatives(nextCreatives);
      const libraryCreatives = savedCreatives.length ? savedCreatives : nextCreatives;
      setCreatives((prev) => [...libraryCreatives, ...prev]);
      setRecentGeneratedIds(libraryCreatives.map((creative) => creative.id));
      setGenerationMessage(`${libraryCreatives.length} creative output(s) generated.`);
    } catch (error) {
      setCreativeError(error.message || "Could not save generated creatives.");
    }
  }

  async function handleDownloadCreative(creative) {
    try {
      await downloadCreativeReelVideo(creative);
    } catch (error) {
      setCreativeError(
        `${error.message || "This saved reel does not have downloadable video media."} Use Regenerate Premium MP4 to rebuild it from current stock.`
      );
    }
  }

  async function handleRegenerateCreativeFacebookMp4(creative) {
    if (regeneratingCreativeId) return;

    const vehicle = findCurrentStockVehicleForCreative(creative, vehicles);

    if (!vehicle) {
      setCreativeRegenerationStatuses((current) => ({
        ...current,
        [creative.id]: { state: "Failed", error: "Vehicle no longer in stock" },
      }));
      return;
    }

    setRegeneratingCreativeId(creative.id);
    setCreativeRegenerationStatuses((current) => ({
      ...current,
      [creative.id]: { state: "Preparing", error: "" },
    }));
    setCreativeError("");
    setGenerationMessage(`Regenerating Premium MP4 for ${vehicle.reg || vehicle.name || "vehicle"}...`);

    try {
      const pipeline = vehicle.pipeline || creative.vehicle?.pipeline || "vanFinance";
      const defaultContent =
        pipeline === "rent2buy" ? buildRentReelContent(vehicle) : buildFinanceReelContent(vehicle);
      const publicPipelineLabel = pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
      const reel = createReelRecord({
        vehicle,
        image: vehicle.image || vehicle.picture || creative.vehicle?.image || "",
        pipeline,
        hook: cleanPublicReelLabel(creative.hookStyle, pipeline) || publicPipelineLabel,
        templateName: cleanPublicReelLabel(creative.templateType, pipeline) || publicPipelineLabel,
        musicOn: true,
        sourceType: "stock",
        sourceLabel: publicPipelineLabel,
        subtext: cleanPublicReelLabel(creative.preview?.subline, pipeline) || defaultContent.subtext,
        priceLine: defaultContent.priceLine,
        ctaLine: creative.cta || defaultContent.ctaLine,
      });
      const premiumReel = {
        ...reel,
        uspLine: pipeline === "rent2buy" ? "NO CREDIT CHECKS" : "200 VANS IN STOCK",
        vehicleName: reel.title || vehicle.name || vehicle.reg || "Vehicle",
      };
      setCreativeRegenerationStatuses((current) => ({
        ...current,
        [creative.id]: { state: "Preparing", error: "" },
      }));
      const videoAsset = await generatePremiumReelVideoAsset(premiumReel);
      const regeneratedReel = {
        ...premiumReel,
        url: videoAsset.url,
        downloadName: videoAsset.downloadName,
        posterUrl: videoAsset.posterUrl,
        extension: videoAsset.extension,
        mimeType: videoAsset.mimeType,
        audioEmbedded: videoAsset.audioEmbedded,
        blob: videoAsset.blob,
        fileName: videoAsset.downloadName,
      };

      await saveReelVideoBlob(creative.id, videoAsset.blob, {
        downloadName: videoAsset.downloadName,
        mimeType: videoAsset.mimeType,
      }).catch(() => {});

      await downloadPremiumReelMp4(regeneratedReel, {
        onPreparing: () => {
          setCreativeRegenerationStatuses((current) => ({
            ...current,
            [creative.id]: { state: "Preparing", error: "" },
          }));
        },
        onUploading: () => {
          setCreativeRegenerationStatuses((current) => ({
            ...current,
            [creative.id]: { state: "Uploading reel", error: "" },
          }));
        },
        onConverting: () => {
          setCreativeRegenerationStatuses((current) => ({
            ...current,
            [creative.id]: { state: "Converting MP4", error: "" },
          }));
        },
        onDownloading: () => {
          setCreativeRegenerationStatuses((current) => ({
            ...current,
            [creative.id]: { state: "Downloading", error: "" },
          }));
        },
      });
      setCreativeRegenerationStatuses((current) => ({
        ...current,
        [creative.id]: { state: "Complete", error: "" },
      }));
      setGenerationMessage(`Premium MP4 regenerated for ${vehicle.reg || vehicle.name || "vehicle"}.`);
    } catch (error) {
      setCreativeRegenerationStatuses((current) => ({
        ...current,
        [creative.id]: {
          state: "Failed",
          error: error.message || "Could not regenerate Premium MP4.",
        },
      }));
      setGenerationMessage("");
    } finally {
      setRegeneratingCreativeId("");
    }
  }

  async function handleDeleteCreative(creativeId) {
    setCreatives((prev) => prev.filter((creative) => creative.id !== creativeId));
    setRecentGeneratedIds((prev) => prev.filter((id) => id !== creativeId));

    try {
      await deleteMarketingCreative(creativeId);
    } catch (error) {
      setCreativeError(error.message || "Could not delete saved creative.");
    }
  }

  function handleReelDownloadComplete(reel) {
    const keys = reelActionCooldownKeys(reel);
    if (!keys.length) return;

    setReelDownloadCooldowns((prev) => {
      const next = {
        ...pruneReelDownloadCooldowns(prev),
      };
      const cooldownRecord = {
        downloadedAt: Date.now(),
        reelId: reel.id || reel.creativeId || "",
        registration: normalizeRegistration(reel.registration),
      };

      keys.forEach((key) => {
        next[key] = cooldownRecord;
      });
      saveReelDownloadCooldowns(next);
      return next;
    });
  }

  function renderCurrentPage() {
    switch (currentView) {
      case "Stock":
        return (
          <StockPage
            vehicles={filteredStockVehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            filters={stockFilters}
            onFiltersChange={setStockFilters}
            onGenerateReel={handleGenerateFromStock}
            onViewCreatives={handleViewCreatives}
            selectedVehicleIds={manualStockSelectedIds}
            onToggleVehicle={handleToggleManualStockVehicle}
            onAddSelectedToQueue={handleAddSelectedToManualReelQueue}
            onAddSelectedToReelLabQueue={handleAddSelectedToReelLabQueue}
            onAddSelectedToYouTubeQueue={handleAddSelectedToYouTubeQueue}
            onOpenYouTubeGenerator={() => handleNavigate("YouTube Generator")}
            youtubeSelectionSummary={youtubeStockSelectionSummary}
            carsStockStatus={carsStockStatus}
            reelActionLocks={reelActionLocks}
            ignoreReelLock={ignoreReelLock}
            onIgnoreReelLockChange={(value) => handleReelFactoryChange("ignoreVehicleCooldown", value)}
            generationMessage={generationMessage}
            creativeError={creativeError}
          />
        );
      case "Customer Database":
        return <CustomerDatabasePage />;
      case "Marketing Totals":
        return <MarketingTotalsPage onNavigate={handleNavigate} />;
      case "Marketing Centre":
        return <MarketingCentrePage />;
      case "Vansco Stock Watch":
        return <VanscoStockWatchPage />;
      case "Reel Factory":
        return (
          <ReelFactoryPage
            vehicles={filteredFactoryVehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            filters={factoryFilters}
            onFiltersChange={handleReelFactoryFiltersChange}
            formValues={reelFactoryForm}
            onFormChange={handleReelFactoryChange}
            onGenerate={handleGenerateDailyReels}
            todayReels={todayReels}
            generationMessage={generationMessage}
            creativeError={creativeError}
            uploadedImages={uploadedReelImages}
            selectedVehicle={selectedReelFactoryVehicle}
            onClearSelectedVehicle={handleClearReelFactorySelection}
            onImagesSelected={handleUploadedReelImagesSelected}
            onDownloadReel={handleDownloadReel}
            onDownloadAll={handleDownloadAllReels}
            onDeleteReel={handleDeleteReel}
            onClearReels={handleClearTodayReels}
            manualReelQueues={manualReelQueues}
            manualReelQueueVehicles={manualReelQueueVehicles}
            manualReelQueueLocks={manualReelQueueLocks}
            manualReelQueueType={manualReelQueueType}
            onManualReelQueueTypeChange={setManualReelQueueType}
            onGenerateManualQueuedReel={handleGenerateManualQueuedReel}
            onNextManualQueuedVehicle={handleNextManualQueuedVehicle}
            onRemoveManualQueuedVehicle={handleRemoveManualQueuedVehicle}
            onClearManualReelQueue={handleClearManualReelQueue}
            onReelDownloadComplete={handleReelDownloadComplete}
          />
        );
      case "Premium Reel Studio":
        return (
          <PremiumReelStudioBetaPage
            vehicles={vehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            manualReelQueues={manualReelQueues}
            manualReelQueueVehicles={manualReelQueueVehicles}
            manualReelQueueLocks={manualReelQueueLocks}
            manualReelQueueType={manualReelQueueType}
            onManualReelQueueTypeChange={setManualReelQueueType}
            onNextManualQueuedVehicle={handleNextManualQueuedVehicle}
            onRemoveManualQueuedVehicle={handleRemoveManualQueuedVehicle}
            onClearManualReelQueue={handleClearManualReelQueue}
            onReelDownloadComplete={handleReelDownloadComplete}
            reelActionLocks={reelActionLocks}
            ignoreReelLock={ignoreReelLock}
          />
        );
      case "Reel Lab Beta":
        return (
          <ReelLabBetaPage
            vehicles={vehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            queueByProduct={reelLabQueueVehicles}
            onQueueChange={handleUpdateReelLabQueue}
          />
        );
      case "YouTube Generator":
        return (
          <YouTubeGeneratorPage
            vehicles={vehicles}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            queueByProduct={youtubeQueueVehicles}
            onQueueChange={handleUpdateYouTubeQueue}
            cmsUploadsByProduct={youtubeCmsUploads}
            onCmsUploadChange={handleUpdateYouTubeCmsUpload}
            carsStockStatus={carsStockStatus}
          />
        );
      case "Creative Library":
        return (
          <CreativeLibraryPage
            creatives={filteredLibraryCreatives}
            filters={libraryFilters}
            onFiltersChange={setLibraryFilters}
            creativeError={creativeError}
            onDownload={handleDownloadCreative}
            onRegenerateFacebookMp4={handleRegenerateCreativeFacebookMp4}
            regeneratingCreativeId={regeneratingCreativeId}
            regenerationStatuses={creativeRegenerationStatuses}
            onDelete={handleDeleteCreative}
          />
        );
      case "Van Finance Facebook":
        return (
          <PostingDeskPage
            title="Van Finance Facebook"
            destination="Van Finance Facebook"
            vehicles={vanFinanceFacebookQueue.map((vehicle, index) => ({
              ...vehicle,
              caption: buildPostingCaption(vehicle, { destination: "Van Finance Facebook", index }),
            }))}
            summary={{ ...postingDeskSummary.vanFinanceFacebook, accent: "finance" }}
            postedToday={postedToday}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            onPostVehicle={handlePostVehicle}
            onSkip={handleSkipVehicle}
            onRefreshStock={handleRefreshStock}
            onSyncStock={handleSyncStock}
            onShowHiddenAgain={handleShowHiddenAgain}
          />
        );
      case "Rent2Buy Facebook":
        return (
          <PostingDeskPage
            title="Rent2Buy Facebook"
            destination="Rent2Buy Facebook"
            vehicles={rent2BuyFacebookQueue.map((vehicle, index) => ({
              ...vehicle,
              caption: buildPostingCaption(vehicle, { destination: "Rent2Buy Facebook", index }),
            }))}
            summary={{ ...postingDeskSummary.rent2BuyFacebook, accent: "rent" }}
            postedToday={postedToday}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            onPostVehicle={handlePostVehicle}
            onSkip={handleSkipVehicle}
            onRefreshStock={handleRefreshStock}
            onSyncStock={handleSyncStock}
            onShowHiddenAgain={handleShowHiddenAgain}
          />
        );
      case "Facebook Marketplace":
        return (
          <PostingDeskPage
            title="Facebook Marketplace"
            destination="Facebook Marketplace"
            vehicles={marketplaceQueue.map((vehicle, index) => ({
              ...vehicle,
              caption: buildPostingCaption(vehicle, { destination: "Facebook Marketplace", index }),
            }))}
            summary={{ ...postingDeskSummary.marketplace, accent: "marketplace" }}
            postedToday={postedToday}
            vehiclesLoading={vehiclesLoading}
            vehiclesError={vehiclesError}
            onPostVehicle={handlePostVehicle}
            onSkip={handleSkipVehicle}
            onRefreshStock={handleRefreshStock}
            onSyncStock={handleSyncStock}
            onShowHiddenAgain={handleShowHiddenAgain}
          />
        );
      case "Dashboard":
      default:
        return (
          <DashboardPage
            onNavigate={handleNavigate}
            stats={dashboardStats}
            recentCreatives={recentCreatives}
            topReels={topReelsWithLabels}
          />
        );
    }
  }

  return (
    <div className="app-shell">
      <Sidebar currentView={currentView} onNavigate={handleNavigate} />

      <main className="app-main">
        <header className="topbar">
  <div>
    <div className="eyebrow">Standalone React App</div>
    <h2>{currentView}</h2>
  </div>

  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flexWrap: "wrap",
    }}
  >
    
    <div className="topbar__meta">
      <span>{vehicles.length} vehicles</span>
      <span>{creatives.length} creatives</span>
    </div>
  </div>
</header>
        <DailyTargetBanner currentView={currentView} onNavigate={handleNavigate} />
        {renderCurrentPage()}
      </main>
    </div>
  );
}

