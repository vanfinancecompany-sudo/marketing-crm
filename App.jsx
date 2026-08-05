// 🚀 INSTANT TRACK + REDIRECT (runs before React loads)
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

    // 🔥 send tracking without blocking redirect
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
import CustomerDatabasePage from "./pages/CustomerDatabasePage.jsx";
import MarketingCentrePage from "./pages/MarketingCentrePage.jsx";
import KnowledgeHubPage from "./pages/KnowledgeHubPage.jsx";
import ContentFactoryPage from "./pages/ContentFactoryPage.jsx";
import AIVisibilityPage from "./pages/AIVisibilityPage.jsx";
import AIAssistantCompetencePage from "./pages/AIAssistantCompetencePage.jsx";
import AIKnowledgeOpportunitiesPage from "./pages/AIKnowledgeOpportunitiesPage.jsx";
import StockPage from "./pages/StockPage.jsx";
import VanscoStockWatchPage from "./pages/VanscoStockWatchPage.jsx";
import ReelFactoryPage from "./pages/ReelFactoryPage.jsx";
import PremiumReelStudioBetaPage from "./pages/PremiumReelStudioBetaPage.jsx";
import ReelLabBetaPage from "./pages/ReelLabBetaPage.jsx";
import YouTubeGeneratorPage from "./pages/YouTubeGeneratorPage.jsx";
import CreativeLibraryPage from "./pages/CreativeLibraryPage.jsx";
import PostingDeskPage from "./pages/PostingDeskPage.jsx";
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
  "Content Operations": "/",
  Stock: "/stock",
  "Customer Database": "/customer-database",
  "Marketing Centre": "/marketing-centre",
  "Knowledge Hub": "/knowledge-hub",
  "Content Factory": "/content-factory",
  "AI Visibility": "/ai-visibility",
  "AI Assistant Competence Test": "/ai-assistant-competence",
  "AI Knowledge Opportunities": "/ai-knowledge-opportunities",
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
  if (typeof window === "undefined") return "Content Operations";

  const path = window.location.pathname;

  if (path === "/stock") return "Stock";
  if (path === "/customer-database") return "Customer Database";
  if (path === "/marketing-centre") return "Marketing Centre";
  if (path === "/knowledge-hub") return "Knowledge Hub";
  if (path === "/content-factory") return "Content Factory";
  if (path === "/ai-visibility") return "AI Visibility";
  if (path === "/ai-assistant-competence") return "AI Assistant Competence Test";
  if (path === "/ai-knowledge-opportunities") return "AI Knowledge Opportunities";
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

  return "Content Operations";
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
    reg: getManualQueueRegistration(reelVehicle),
    targetPipeline,
    source: queueKey,
    reelType: queueKey,
    name: reelVehicle?.name || vehicle?.name || "",
    title: reelVehicle?.title || vehicle?.title || "",
    image: reelVehicle?.image || "",
    picture: reelVehicle?.picture || "",
    rent2buyData: reelVehicle?.rent2buyData || null,
  };
}

function normalizeManualQueueItem(item, queueKey) {
  if (!item || typeof item !== "object") return null;

  const normalized = {
    id: String(item.id || "").trim(),
    reg: getManualQueueRegistration(item),
    targetPipeline: item.targetPipeline || getManualQueueTargetPipeline(queueKey),
    source: item.source || queueKey,
    reelType: item.reelType || queueKey,
    name: item.name || "",
    title: item.title || "",
    image: item.image || "",
    picture: item.picture || "",
    rent2buyData: item.rent2buyData || null,
  };

  return normalized.id || normalized.reg ? normalized : null;
}

function loadManualReelQueue(queueKey) {
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(MANUAL_REEL_QUEUE_STORAGE_KEYS[queueKey]);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map((item) => normalizeManualQueueItem(item, queueKey)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveManualReelQueue(queueKey, queue) {
  const storageKey = MANUAL_REEL_QUEUE_STORAGE_KEYS[queueKey];
  if (!storageKey || typeof window === "undefined") return;
  const normalizedQueue = queue.map((item) => normalizeManualQueueItem(item, queueKey)).filter(Boolean);

  if (normalizedQueue.length) {
    localStorage.setItem(storageKey, JSON.stringify(normalizedQueue));
  } else {
    localStorage.removeItem(storageKey);
  }
}

function getReelLabQueueKey(productKey) {
  return productKey === "rent2buy" ? "rent2buy" : "vanFinance";
}

function getReelLabManualQueueKey(productKey) {
  return productKey === "rent2buy" ? "rent2buy" : "finance";
}

function getYouTubeQueueKey(productKey) {
  if (productKey === "rent2buy") return "rent2buy";
  if (productKey === "cars") return "cars";
  return "vanFinance";
}

function createReelLabQueueItem(vehicle, productKey) {
  return {
    ...createManualQueueItem(vehicle, getReelLabManualQueueKey(productKey)),
    productKey: getReelLabQueueKey(productKey),
    source: "stockReelLab",
  };
}

function normalizeReelLabQueueItem(item, productKey) {
  const queueKey = getReelLabManualQueueKey(productKey);
  const normalized = normalizeManualQueueItem(item, queueKey);
  return normalized ? { ...normalized, productKey: getReelLabQueueKey(productKey) } : null;
}

function loadReelLabQueue(productKey) {
  const queueKey = getReelLabQueueKey(productKey);
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(REEL_LAB_QUEUE_STORAGE_KEYS[queueKey]);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map((item) => normalizeReelLabQueueItem(item, queueKey)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveReelLabQueue(productKey, queue) {
  const queueKey = getReelLabQueueKey(productKey);
  const storageKey = REEL_LAB_QUEUE_STORAGE_KEYS[queueKey];
  if (!storageKey || typeof window === "undefined") return;
  const normalizedQueue = queue.map((item) => normalizeReelLabQueueItem(item, queueKey)).filter(Boolean);

  if (normalizedQueue.length) {
    localStorage.setItem(storageKey, JSON.stringify(normalizedQueue));
  } else {
    localStorage.removeItem(storageKey);
  }
}

function createYouTubeQueueItem(vehicle, productKey) {
  const queueKey = getYouTubeQueueKey(productKey);
  return {
    ...createManualQueueItem(vehicle, queueKey === "rent2buy" ? "rent2buy" : "finance"),
    productKey: queueKey,
    source: "stockYouTubeGenerator",
  };
}

function normalizeYouTubeQueueItem(item, productKey) {
  const queueKey = getYouTubeQueueKey(productKey);
  const normalized = normalizeManualQueueItem(item, queueKey === "rent2buy" ? "rent2buy" : "finance");
  return normalized ? { ...normalized, productKey: queueKey } : null;
}

function loadYouTubeQueue(productKey) {
  const queueKey = getYouTubeQueueKey(productKey);
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(YOUTUBE_QUEUE_STORAGE_KEYS[queueKey]);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.map((item) => normalizeYouTubeQueueItem(item, queueKey)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveYouTubeQueue(productKey, queue) {
  const queueKey = getYouTubeQueueKey(productKey);
  const storageKey = YOUTUBE_QUEUE_STORAGE_KEYS[queueKey];
  if (!storageKey || typeof window === "undefined") return;
  const normalizedQueue = queue.map((item) => normalizeYouTubeQueueItem(item, queueKey)).filter(Boolean);

  if (normalizedQueue.length) {
    localStorage.setItem(storageKey, JSON.stringify(normalizedQueue));
  } else {
    localStorage.removeItem(storageKey);
  }
}

function vehicleQueueLabel(vehicle) {
  const reg = String(vehicle?.reg || vehicle?.registration || "").trim();
  const title = String(vehicle?.vanDescription || vehicle?.description || vehicle?.name || vehicle?.title || "").trim();
  return [reg, title].filter(Boolean).join(" - ") || "Selected vehicle";
}

function isRent2BuyEligible(vehicle) {
  return Boolean(vehicle?.rent2buyEligible || vehicle?.pipeline === "rent2buy");
}

function asPipelineVehicle(vehicle, pipeline) {
  if (!pipeline) return vehicle;
  if (!vehicle || vehicle.pipeline === pipeline) return vehicle;
  if (pipeline === "rent2buy") {
    const rentData = vehicle.rent2buyData || {};
    return {
      ...vehicle,
      ...rentData,
      id: vehicle.id,
      financeId: vehicle.id,
      financeData: vehicle,
      originalPipeline: vehicle.originalPipeline || vehicle.pipeline,
      pipeline,
      source: "rent2buy",
      reelType: "rent2buy",
      rent2buyEligible: true,
      rent2buyData: vehicle.rent2buyData || rentData,
    };
  }

  return {
    ...vehicle,
    pipeline,
    source: "finance",
    reelType: "finance",
    originalPipeline: "vanFinance",
  };
}

function getManualVehicleImage(vehicle) {
  if (!vehicle) return "";
  if (vehicle.image) return vehicle.image;
  if (vehicle.picture) return vehicle.picture;
  if (vehicle.mainImage) return vehicle.mainImage;
  if (Array.isArray(vehicle.mediaGallery)) {
    const galleryItem = vehicle.mediaGallery.find(Boolean);
    if (typeof galleryItem === "string") return galleryItem;
    return galleryItem?.url || galleryItem?.src || galleryItem?.image || "";
  }
  return "";
}

function resolveManualQueuedVehicle(queueItem, vehicles) {
  const normalizedItem = normalizeManualQueueItem(queueItem, queueItem?.targetPipeline === "rent2buy" ? "rent2buy" : "finance");
  if (!normalizedItem) return null;

  const id = normalizedItem.id;
  const reg = normalizedItem.reg;
  const idMatch = id ? vehicles.find((vehicle) => String(vehicle.id || "").trim() === id) : null;
  const regMatch = !idMatch && reg
    ? vehicles.find((vehicle) => getManualQueueRegistration(vehicle) === reg)
    : null;
  const matchedVehicle = idMatch || regMatch;

  if (!matchedVehicle) return null;

  return asPipelineVehicle({
    ...matchedVehicle,
    image: getManualVehicleImage(matchedVehicle) || normalizedItem.image || normalizedItem.picture,
    picture: matchedVehicle.picture || normalizedItem.picture || normalizedItem.image,
    rent2buyData: matchedVehicle.rent2buyData || normalizedItem.rent2buyData,
  }, normalizedItem.targetPipeline || matchedVehicle.pipeline);
}

export default function App() {
  const [currentView, setCurrentView] = useState(viewFromPath);
  const [vehicles, setVehicles] = useState([]);
  const [carsStockStatus, setCarsStockStatus] = useState(getCarsStockLoadState);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [recentGeneratedIds, setRecentGeneratedIds] = useState([]);
  const [creativeError, setCreativeError] = useState("");
  const [regeneratingCreativeId, setRegeneratingCreativeId] = useState("");
  const [creativeRegenerationStatuses, setCreativeRegenerationStatuses] = useState({});
  const [generationMessage, setGenerationMessage] = useState("");
  const [stockFilters, setStockFilters] = useState(DEFAULT_STOCK_FILTERS);
  const [manualStockSelectedIds, setManualStockSelectedIds] = useState([]);
  const [manualReelQueueType, setManualReelQueueType] = useState("finance");
  const [manualReelQueues, setManualReelQueues] = useState(() => ({
    finance: loadManualReelQueue("finance"),
    rent2buy: loadManualReelQueue("rent2buy"),
  }));
  const [reelLabQueues, setReelLabQueues] = useState(() => ({
    vanFinance: loadReelLabQueue("vanFinance"),
    rent2buy: loadReelLabQueue("rent2buy"),
  }));
  const [youtubeQueues, setYoutubeQueues] = useState(() => ({
    vanFinance: loadYouTubeQueue("vanFinance"),
    rent2buy: loadYouTubeQueue("rent2buy"),
    cars: loadYouTubeQueue("cars"),
  }));
  const [youtubeCmsUploads, setYoutubeCmsUploads] = useState(loadYouTubeCmsUploads);
  const [reelDownloadCooldowns, setReelDownloadCooldowns] = useState(loadReelDownloadCooldowns);
  const [factoryFilters, setFactoryFilters] = useState(DEFAULT_STOCK_FILTERS);
  const [libraryFilters, setLibraryFilters] = useState(DEFAULT_LIBRARY_FILTERS);
  const [reelFactoryForm, setReelFactoryForm] = useState(DEFAULT_REEL_FACTORY_FORM);
  const [reelFactoryVehicleId, setReelFactoryVehicleId] = useState("");
  const [reelFactorySelectionMode, setReelFactorySelectionMode] = useState("");
  const [recentRandomReelVehicleIds, setRecentRandomReelVehicleIds] = useState(loadRecentRandomReelVehicleIds);
  const [uploadedReelImages, setUploadedReelImages] = useState([]);
  const [todayReels, setTodayReels] = useState([]);
const [hiddenTodayReelIds, setHiddenTodayReelIds] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem("hiddenTodayReelIds") || "[]");
  } catch {
    return [];
  }
});
  const [reelClickStats, setReelClickStats] = useState({
    financeClicksToday: 0,
    rent2BuyClicksToday: 0,
    topReels: [],
  });
  const [rollingTopReels, setRollingTopReels] = useState([]);
  const [postedToday, setPostedToday] = useState([]);
  const [hiddenPostingVehicleIds, setHiddenPostingVehicleIds] = useState(() => ({
    vanFinanceFacebook: loadHiddenPostingIds("vanFinanceFacebook"),
    rent2BuyFacebook: loadHiddenPostingIds("rent2BuyFacebook"),
    marketplace: loadHiddenPostingIds("marketplace"),
  }));
  const [factoryForm, setFactoryForm] = useState({
    templateType: templateOptions[0],
    hookStyle: hookOptions[0],
    cta: ctaOptions[0],
    numberOfVersions: 3,
    templateOptions,
    hookOptions,
    ctaOptions,
  });

  async function loadVehicles() {
    setVehiclesLoading(true);
    setVehiclesError("");

    try {
      const data = await fetchMarketingVehicles();
      setVehicles(data);
      setCarsStockStatus(getCarsStockLoadState());
      setSelectedVehicleId((prev) => prev || data[0]?.id || "");
      setSelectedVehicleIds((prev) => (prev.length ? prev : data[0]?.id ? [data[0].id] : []));
    } catch (error) {
      setVehicles([]);
      setCarsStockStatus(getCarsStockLoadState());
      setVehiclesError(error.message || "Failed to load vehicles.");
    } finally {
      setVehiclesLoading(false);
    }
  }

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeCmsUploadsAsync().then((uploads) => {
      if (!cancelled) setYoutubeCmsUploads(uploads);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentView !== "Stock") return undefined;
    let cancelled = false;
    loadYouTubeCmsUploadsAsync().then((uploads) => {
      if (!cancelled) setYoutubeCmsUploads(uploads);
    });
    return () => {
      cancelled = true;
    };
  }, [currentView, manualStockSelectedIds.length]);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/track")) return;

    const params = new URLSearchParams(window.location.search);
    const type = params.get("type") === "rent2buy" ? "rent2buy" : "finance";
    const reelId = params.get("reel") || "unknown";
    const source = params.get("src") || "reel";

    logReelClick({ source, type, reelId })
      .catch(() => {})
      .finally(() => {
        window.location.replace(TRACK_REDIRECTS[type]);
      });
  }, []);

useEffect(() => {
  localStorage.setItem("hiddenTodayReelIds", JSON.stringify(hiddenTodayReelIds));
}, [hiddenTodayReelIds]);

  useEffect(() => {
    function handlePopState() {
      setCurrentView(viewFromPath());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCreatives() {
      setCreativeError("");

      try {
        const data = await fetchMarketingCreatives();
        if (active) {
          setCreatives(data);
        }
      } catch (error) {
        if (active) {
          setCreativeError(error.message || "Failed to load saved creatives.");
        }
      }
    }

    loadCreatives();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetchReelClickDashboard()
      .then((stats) => {
        if (!active) return;

        setReelClickStats(stats);
        setRollingTopReels(Array.isArray(stats?.topReels) ? stats.topReels : []);
      })
      .catch(() => {
        if (active) {
          setRollingTopReels([]);
        }
      });

    return () => {
      active = false;
    };
  }, []);


useEffect(() => {
  let active = true;

  async function rebuildTodayReels() {
    try {
      const todayCreativeReels = await fetchTodayReelCreatives(20);

      const rebuilt = await Promise.all(
        todayCreativeReels.map(async (creative) => {
          const blobData = await loadReelVideoBlob?.(creative.id).catch(() => null);

          if (!blobData?.blob) return null;

          return {
            id: creative.id,
            creativeId: creative.id,
            createdAt: creative.createdAt,
            url: URL.createObjectURL(blobData.blob),
            downloadName: blobData.downloadName,
            mimeType: blobData.mimeType,
          };
        })
      );

      if (!active) return;

      setTodayReels((prev) => {
        prev.forEach((reel) => {
          if (reel?.url?.startsWith?.("blob:")) {
            try {
              URL.revokeObjectURL(reel.url);
            } catch {}
          }
        });

        return rebuilt
  .filter(Boolean)
  .filter((reel) => !hiddenTodayReelIds.includes(reel.id));
      });
    } catch {
      if (!active) return;
      setTodayReels([]);
    }
  }

    rebuildTodayReels();

  return () => {
    active = false;
  };
}, [hiddenTodayReelIds]);
      
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || vehicles[0] || null;
  const selectedReelFactorySourceVehicle =
    reelFactorySelectionMode === "stock"
      ? vehicles.find((vehicle) => vehicle.id === reelFactoryVehicleId) || null
      : null;
  const selectedReelFactoryDisplayPipeline =
    factoryFilters.pipeline === "vanFinance" || reelFactoryForm.reelType === "Finance"
      ? "vanFinance"
      : factoryFilters.pipeline === "rent2buy" || reelFactoryForm.reelType === "Rent2Buy"
        ? "rent2buy"
        : selectedReelFactorySourceVehicle?.pipeline;
  const selectedReelFactoryVehicle = selectedReelFactorySourceVehicle
    ? asPipelineVehicle(selectedReelFactorySourceVehicle, selectedReelFactoryDisplayPipeline)
    : null;

  const filteredStockVehicles = useMemo(() => {
    return sortVehiclesNewestAddedFirst(filterVehicles(vehicles, stockFilters), stockFilters.pipeline);
  }, [vehicles, stockFilters]);

  const filteredFactoryVehicles = useMemo(() => {
    return filterVehicles(vehicles, factoryFilters);
  }, [vehicles, factoryFilters]);

  const filteredLibraryCreatives = useMemo(() => {
    return filterCreatives(creatives, libraryFilters)
      .map((creative) => ({
        ...creative,
        currentStockVehicle: findCurrentStockVehicleForCreative(creative, vehicles),
      }))
      .filter((creative) => Boolean(creative.currentStockVehicle));
  }, [creatives, libraryFilters, vehicles]);

  const generatedCreatives = useMemo(() => {
    return creatives.filter((creative) => recentGeneratedIds.includes(creative.id));
  }, [creatives, recentGeneratedIds]);

  const ignoreReelLock = Boolean(reelFactoryForm.ignoreVehicleCooldown);

  const recentCreatives = useMemo(() => {
    return [...creatives]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
  }, [creatives]);

  const financeVehicles = useMemo(() => {
    return vehicles;
  }, [vehicles]);

  const rentVehicles = useMemo(() => {
    return vehicles.filter(isRent2BuyEligible);
  }, [vehicles]);

  const postedPostingKeys = useMemo(() => {
    return new Set(
      postedToday.map((item) =>
        getPostingActionKey(item.vehicle, item.destination || getDefaultPostingDestination(item.vehicle))
      )
    );
  }, [postedToday]);

  const vanFinanceFacebookQueue = useMemo(() => {
    const hiddenIds = new Set(hiddenPostingVehicleIds.vanFinanceFacebook);
    return financeVehicles
      .map((vehicle) => asPipelineVehicle(vehicle, "vanFinance"))
      .filter((vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Van Finance Facebook")))
      .filter((vehicle) => !hiddenIds.has(normalizePostingVehicleId(vehicle)));
  }, [financeVehicles, postedPostingKeys, hiddenPostingVehicleIds.vanFinanceFacebook]);

  const rent2BuyFacebookQueue = useMemo(() => {
    const hiddenIds = new Set(hiddenPostingVehicleIds.rent2BuyFacebook);
    return rentVehicles
      .map((vehicle) => asPipelineVehicle(vehicle, "rent2buy"))
      .filter((vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Rent2Buy Facebook")))
      .filter((vehicle) => !hiddenIds.has(normalizePostingVehicleId(vehicle)));
  }, [rentVehicles, postedPostingKeys, hiddenPostingVehicleIds.rent2BuyFacebook]);

  const marketplaceQueue = useMemo(() => {
    const hiddenIds = new Set(hiddenPostingVehicleIds.marketplace);
    return rentVehicles
      .map((vehicle) => asPipelineVehicle(vehicle, "rent2buy"))
      .filter((vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Facebook Marketplace")))
      .filter((vehicle) => !hiddenIds.has(normalizePostingVehicleId(vehicle)));
  }, [rentVehicles, postedPostingKeys, hiddenPostingVehicleIds.marketplace]);

  const postingDeskSummary = useMemo(() => {
    function buildDestinationSummary(destination, eligibleVehicles, pageKey) {
      const dailyAdvertised = postedToday.filter(
        (item) => item.destination === destination && isToday(item.postedAt)
      ).length;
      const hiddenIds = new Set(hiddenPostingVehicleIds[pageKey] || []);

      return {
        dailyAdvertised,
        weeklyAdvertised: dailyAdvertised,
        totalVisible: eligibleVehicles.length,
        totalHidden: eligibleVehicles.filter((vehicle) => hiddenIds.has(normalizePostingVehicleId(vehicle))).length,
      };
    }

    return {
      vanFinanceFacebook: buildDestinationSummary("Van Finance Facebook", financeVehicles, "vanFinanceFacebook"),
      rent2BuyFacebook: buildDestinationSummary("Rent2Buy Facebook", rentVehicles, "rent2BuyFacebook"),
      marketplace: buildDestinationSummary("Facebook Marketplace", rentVehicles, "marketplace"),
    };
  }, [financeVehicles, rentVehicles, postedToday, hiddenPostingVehicleIds]);

  const dashboardStats = useMemo(() => {
    const createdToday = creatives.filter((creative) => isToday(creative.createdAt)).length;
    const readyToPost =
      vanFinanceFacebookQueue.length + rent2BuyFacebookQueue.length + marketplaceQueue.length;
    const postedVehicleCount = postedToday.filter((item) => isToday(item.postedAt)).length;

    return {
      createdToday,
      readyToPost,
      postedToday: postedVehicleCount,
      financeClicksToday: reelClickStats.financeClicksToday,
      rent2BuyClicksToday: reelClickStats.rent2BuyClicksToday,
    };
  }, [
    creatives,
    vanFinanceFacebookQueue.length,
    rent2BuyFacebookQueue.length,
    marketplaceQueue.length,
    postedToday,
    reelClickStats.financeClicksToday,
    reelClickStats.rent2BuyClicksToday,
  ]);

  const controlCentreStats = useMemo(() => {
    const postedVehicleCount = postedToday.filter((item) => isToday(item.postedAt)).length;
    const reelsCreatedToday = todayReels.filter((reel) => isToday(reel.createdAt)).length;
    const totalVisibleVans =
      vanFinanceFacebookQueue.length + rent2BuyFacebookQueue.length + marketplaceQueue.length;

    return {
      totalStock: vehicles.length,
      postedToday: postedVehicleCount,
      reelsCreatedToday,
      totalVisibleVans,
      financeVans: financeVehicles.length,
      rentVans: rentVehicles.length,
    };
  }, [
    vehicles.length,
    postedToday,
    todayReels,
    vanFinanceFacebookQueue.length,
    rent2BuyFacebookQueue.length,
    marketplaceQueue.length,
    financeVehicles.length,
    rentVehicles.length,
  ]);

  const topReelsWithLabels = useMemo(() => {
    const reelLookup = new Map();

    for (const reel of todayReels) {
      if (reel.id) reelLookup.set(reel.id, reel);
      if (reel.creativeId) reelLookup.set(reel.creativeId, reel);
    }

    for (const creative of creatives) {
      if (creative.id && !reelLookup.has(creative.id)) {
        reelLookup.set(creative.id, creative);
      }
    }

    return rollingTopReels.map((trackedReel) => {
      const reelId = trackedReel.reelId;
      const matchedReel = reelId && reelId !== "unknown" ? reelLookup.get(reelId) : null;
      const label =
        matchedReel?.hook ||
        matchedReel?.title ||
        matchedReel?.headline ||
        matchedReel?.subtext ||
        (reelId && reelId !== "unknown" ? reelId : "Unknown reel");

      return {
        ...trackedReel,
        label,
        isUnknown: !reelId || reelId === "unknown",
      };
    });
  }, [creatives, rollingTopReels, todayReels]);

  const manualReelQueueVehicles = useMemo(() => ({
    finance: resolveManualQueuedVehicle((manualReelQueues.finance || [])[0], vehicles),
    rent2buy: resolveManualQueuedVehicle((manualReelQueues.rent2buy || [])[0], vehicles),
  }), [manualReelQueues, vehicles]);

  const reelLabQueueVehicles = useMemo(() => ({
    vanFinance: (reelLabQueues.vanFinance || [])
      .map((item) => resolveManualQueuedVehicle(item, vehicles))
      .filter(Boolean),
    rent2buy: (reelLabQueues.rent2buy || [])
      .map((item) => resolveManualQueuedVehicle(item, vehicles))
      .filter(Boolean),
  }), [reelLabQueues, vehicles]);

  const youtubeQueueVehicles = useMemo(() => ({
    vanFinance: (youtubeQueues.vanFinance || [])
      .map((item) => resolveManualQueuedVehicle(item, vehicles))
      .filter(Boolean),
    rent2buy: (youtubeQueues.rent2buy || [])
      .map((item) => resolveManualQueuedVehicle(item, vehicles))
      .filter(Boolean),
    cars: (youtubeQueues.cars || [])
      .map((item) => resolveManualQueuedVehicle(item, vehicles))
      .filter(Boolean),
  }), [youtubeQueues, vehicles]);

  const youtubeStockSelectionSummary = useMemo(() => {
    const selectedIds = new Set(manualStockSelectedIds);
    if (!selectedIds.size) return null;
    const productQueueKey = getYouTubeQueueKey(stockFilters.pipeline);
    const selectedVehicles = filteredStockVehicles
      .filter((vehicle) => selectedIds.has(getManualQueueVehicleId(vehicle)))
      .filter((vehicle) => productQueueKey !== "rent2buy" || isRent2BuyEligible(vehicle))
      .filter((vehicle) => productQueueKey !== "cars" || vehicle.pipeline === "cars");
    const requiredImageCount = YOUTUBE_DEFAULT_IMAGE_COUNT;
    const ready = selectedVehicles.filter((vehicle) => {
      const imageOrder = resolveYouTubeImageOrder({
        vehicle,
        cmsUpload: youtubeCmsUploads[productQueueKey],
        imageSource: "auto",
        imageCount: requiredImageCount,
      });
      return imageOrder.totalAvailable >= requiredImageCount;
    }).length;
    const skipped = selectedVehicles.length - ready;
    return { ready, skipped, requiredImageCount };
  }, [filteredStockVehicles, manualStockSelectedIds, stockFilters.pipeline, youtubeCmsUploads]);

  const manualReelQueueLocks = useMemo(() => ({
    finance: manualReelQueueVehicles.finance
      ? getReelActionLock(manualReelQueueVehicles.finance, reelDownloadCooldowns)
      : { locked: false, until: 0 },
    rent2buy: manualReelQueueVehicles.rent2buy
      ? getReelActionLock(manualReelQueueVehicles.rent2buy, reelDownloadCooldowns)
      : { locked: false, until: 0 },
  }), [manualReelQueueVehicles, reelDownloadCooldowns]);

  const reelActionLocks = useMemo(() => {
    const now = Date.now();
    return vehicles.reduce((locks, vehicle) => {
      const lock = getReelActionLock(vehicle, reelDownloadCooldowns, now);

      if (lock.locked) {
        locks[getManualQueueVehicleId(vehicle)] = lock;
      }

      return locks;
    }, {});
  }, [reelDownloadCooldowns, vehicles]);

  function handleFormChange(field, value) {
    setFactoryForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleReelFactoryChange(field, value) {
    setReelFactoryForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleReelFactoryFiltersChange(nextFilters) {
    setFactoryFilters(nextFilters);

    if (nextFilters.pipeline === "vanFinance") {
      setReelFactoryForm((prev) => ({ ...prev, reelType: "Finance" }));
    } else if (nextFilters.pipeline === "rent2buy") {
      setReelFactoryForm((prev) => ({ ...prev, reelType: "Rent2Buy" }));
    } else {
      setReelFactoryForm((prev) => ({ ...prev, reelType: "Mixed" }));
    }
  }

  function pickHookForPipeline(pipeline, index = 0) {
    const isRent = pipeline === "rent2buy";
    const pipelineHooks = isRent ? rentReelHooks : financeReelHooks;

    if (reelFactoryForm.hookMode === "Custom hook" && reelFactoryForm.customHook.trim()) {
      return reelFactoryForm.customHook.trim().toUpperCase();
    }

    if (reelFactoryForm.hookMode === "Single selected hook") {
      const selectedHook = isRent ? reelFactoryForm.rentHook : reelFactoryForm.financeHook;
      return pipelineHooks.includes(selectedHook) ? selectedHook : pipelineHooks[0];
    }

    return pipelineHooks[index % pipelineHooks.length];
  }

  function getAllowedReelPipelines() {
    const requested = new Set(["vanFinance", "rent2buy"]);

    if (factoryFilters.pipeline === "vanFinance") {
      requested.delete("rent2buy");
    }

    if (factoryFilters.pipeline === "rent2buy") {
      requested.delete("vanFinance");
    }

    if (reelFactoryForm.reelType === "Finance") {
      requested.delete("rent2buy");
    }

    if (reelFactoryForm.reelType === "Rent2Buy") {
      requested.delete("vanFinance");
    }

    if (reelFactoryForm.reelSource === "Finance stock") {
      requested.delete("rent2buy");
    }

    if (reelFactoryForm.reelSource === "Rent2Buy stock") {
      requested.delete("vanFinance");
    }

    return requested;
  }

  function buildPipelineReelContent(vehicle) {
    return vehicle.pipeline === "rent2buy"
      ? buildRentReelContent(vehicle)
      : buildFinanceReelContent(vehicle);
  }

  function createReelFromVehicle(vehicle, options = {}) {
    const hook = options.hook || pickHookForPipeline(vehicle.pipeline, todayReels.length);
    const content = buildPipelineReelContent(vehicle);
    const imageUrl = vehicle?.image || vehicle?.picture || "";

    console.log("Creating reel from vehicle", {
      registration: vehicle?.reg || vehicle?.registration || vehicle?.name || "",
      reelType: vehicle?.reelType || vehicle?.pipeline,
      source: vehicle?.source || vehicle?.pipeline,
      imageFields: {
        image: vehicle?.image || "",
        picture: vehicle?.picture || "",
        rent2buyDataPicture: vehicle?.rent2buyData?.picture || "",
        financePicture: vehicle?.financePicture || "",
      },
      finalImageUrl: imageUrl,
      lockBypassed: ignoreReelLock,
    });

    return createReelRecord({
      vehicle,
      image: imageUrl,
      pipeline: vehicle.pipeline,
      hook,
      templateName: content.templateName,
      musicOn: reelFactoryForm.musicOn,
      sourceType: options.sourceType || "stock",
      sourceLabel: options.sourceLabel || content.sourceLabel,
      subtext: content.subtext,
      priceLine: content.priceLine,
      ctaLine: content.ctaLine,
    });
  }

  function handleUploadedReelImagesSelected(event) {
    const files = Array.from(event.target.files || []);
    const nextImages = files.map((file) => ({
      id: `upload-${Date.now()}-${file.name}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));

    setUploadedReelImages((prev) => [...prev, ...nextImages]);
  }

  function buildDailyReelPool() {
    const source = reelFactoryForm.reelSource;
    const allowedPipelines = getAllowedReelPipelines();
    const selectedReelVehicle = vehicles.find((vehicle) => vehicle.id === reelFactoryVehicleId);
    const selectedPipeline = allowedPipelines.has("rent2buy") && isRent2BuyEligible(selectedReelVehicle)
      ? "rent2buy"
      : allowedPipelines.has("vanFinance")
        ? "vanFinance"
        : "";

    if (
      reelFactorySelectionMode === "stock" &&
      selectedReelVehicle &&
      source !== "Uploaded images" &&
      selectedPipeline
    ) {
      return [{ kind: "vehicle", vehicle: asPipelineVehicle(selectedReelVehicle, selectedPipeline) }];
    }

    const vehiclePool = source === "Uploaded images"
      ? []
      : [
          ...(allowedPipelines.has("vanFinance")
            ? filteredFactoryVehicles.map((vehicle) => asPipelineVehicle(vehicle, "vanFinance"))
            : []),
          ...(allowedPipelines.has("rent2buy")
            ? filteredFactoryVehicles.filter(isRent2BuyEligible).map((vehicle) => asPipelineVehicle(vehicle, "rent2buy"))
            : []),
        ];

    const uploadPool = source === "Uploaded images" || source === "Mixed" ? uploadedReelImages : [];
    const uploadPipelines = [...allowedPipelines];

    if (!uploadPipelines.length) {
      return [];
    }

    return [
      ...vehiclePool.map((vehicle) => ({ kind: "vehicle", vehicle })),
      ...uploadPool.map((image, index) => ({
        kind: "upload",
        image,
        pipeline: uploadPipelines[index % uploadPipelines.length],
      })),
    ];
  }

  function pickRandomReelPoolItems(pool, quantity, recentVehicleIds = recentRandomReelVehicleIds) {
    const selectedMode = reelFactorySelectionMode === "stock";
    if (selectedMode || pool.length <= 1) {
      return Array.from({ length: quantity }, (_, index) => pool[index % pool.length]);
    }

    const uniquePool = [];
    const seenKeys = new Set();

    rankRandomPool(pool, recentVehicleIds).forEach((item) => {
      const key = getRandomPoolItemKey(item);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      uniquePool.push(item);
    });

    if (!uniquePool.length) {
      return Array.from({ length: quantity }, (_, index) => pool[index % pool.length]);
    }

    const selected = [];
    let batchRecentIds = [...recentVehicleIds];

    while (selected.length < quantity) {
      const round = rankRandomPool(uniquePool, batchRecentIds);
      const remaining = quantity - selected.length;
      const nextItems = round.slice(0, remaining);
      selected.push(...nextItems);

      const roundVehicleIds = nextItems
        .filter((item) => item.kind === "vehicle")
        .flatMap((item) => getVehicleCooldownKeys(item.vehicle).keys);

      batchRecentIds = [...roundVehicleIds.reverse(), ...batchRecentIds].slice(0, MAX_RANDOM_REEL_HISTORY);
    }

    return selected;
  }

  async function addReelsToCreativeLibrary(reels) {
    const nextCreatives = reels.map(createCreativeFromReel);
    const savedCreatives = await saveMarketingCreatives(nextCreatives);
    const libraryCreatives = savedCreatives.length ? savedCreatives : nextCreatives;

    setCreatives((prev) => [...libraryCreatives, ...prev]);
    setRecentGeneratedIds(libraryCreatives.map((creative) => creative.id));

    return libraryCreatives;
  }

  async function handleGenerateDailyReels() {
    setGenerationMessage("");
    setCreativeError("");

    const basePool = buildDailyReelPool();
    const quantity = Math.max(1, Math.min(50, Number(reelFactoryForm.quantity) || 10));

    if (!basePool.length) {
      setGenerationMessage("No stock or uploaded images are available for those reel settings.");
      return;
    }

    let pool = basePool;
    let cooldownWarning = "";
    let cooldownRecentVehicleIds = [...recentRandomReelVehicleIds];

    if (!reelFactoryForm.ignoreVehicleCooldown) {
      const reelTypes = [
        ...new Set(
          basePool
            .filter((item) => item.kind === "vehicle")
            .map((item) => reelTypeForPipeline(item.vehicle.pipeline)),
        ),
      ];

      if (reelTypes.length) {
        try {
          const { rows, setupMissing } = await fetchRecentReelVehicleUsage(reelTypes);
          if (setupMissing) {
            cooldownWarning = appendCooldownWarning(
              cooldownWarning,
              `Vehicle cooldown tracking table is not set up yet. Local browser history is active, but the full ${REEL_VEHICLE_COOLDOWN_DAYS}-day cooldown is not fully active until reel_vehicle_usage is set up.`,
            );
          } else {
            const recentUsageLookup = buildRecentUsageLookup(rows);
            const supabaseRecentKeys = recentUsageKeysFromRows(rows);
            cooldownRecentVehicleIds = [
              ...new Set([...cooldownRecentVehicleIds, ...supabaseRecentKeys]),
            ];

            if (basePool.some((item) => isRecentlyUsedReelVehicle(item, recentUsageLookup))) {
              pool = rankRandomPool(basePool, cooldownRecentVehicleIds);
            }
          }
        } catch (error) {
          cooldownWarning = appendCooldownWarning(
            cooldownWarning,
            `Vehicle cooldown check skipped: ${error.message || "could not load recent usage"}. Local browser history will still be used.`,
          );
        }
      }
    }

    const hookCounters = {
      vanFinance: 0,
      rent2buy: 0,
    };

    const selectedPoolItems = pickRandomReelPoolItems(pool, quantity, cooldownRecentVehicleIds);
    if (!reelFactoryForm.ignoreVehicleCooldown) {
      const recentIds = new Set(cooldownRecentVehicleIds);
      const freshVehicleCount = basePool.filter((item) => item.kind === "vehicle" && !isRecentRandomPoolVehicle(item, recentIds)).length;
      const repeatVehicleCount = selectedPoolItems.filter((item) => isRecentRandomPoolVehicle(item, recentIds)).length;

      if (repeatVehicleCount > 0) {
        cooldownWarning = appendCooldownWarning(
          cooldownWarning,
          `Only ${freshVehicleCount} fresh van${freshVehicleCount === 1 ? "" : "s"} available. Added ${repeatVehicleCount} cooldown repeat${repeatVehicleCount === 1 ? "" : "s"} to reach requested quantity.`,
        );
      }
    }
    const reelDrafts = selectedPoolItems.map((item) => {
      if (item.kind === "vehicle") {
        const pipelineIndex = hookCounters[item.vehicle.pipeline]++;
        return createReelFromVehicle(item.vehicle, {
          hook: pickHookForPipeline(item.vehicle.pipeline, pipelineIndex),
          sourceType: "stock",
        });
      }

      const pipelineIndex = hookCounters[item.pipeline]++;
      const hook = pickHookForPipeline(item.pipeline, pipelineIndex);
      const content = item.pipeline === "rent2buy"
        ? buildRentReelContent({ price: "", monthly: "" })
        : buildFinanceReelContent({ price: "", monthly: "" });

      return createReelRecord({
        image: item.image.url,
        sourceLabel: item.image.name,
        pipeline: item.pipeline,
        hook,
        templateName: content.templateName,
        musicOn: reelFactoryForm.musicOn,
        sourceType: "uploaded",
        subtext: content.subtext,
        priceLine: content.priceLine,
        ctaLine: content.ctaLine,
      });
    });

    if (reelFactorySelectionMode !== "stock") {
      const generatedVehicleIds = selectedPoolItems
        .filter((item) => item.kind === "vehicle")
        .flatMap((item) => getVehicleCooldownKeys(item.vehicle).keys)
        .filter(Boolean);

      if (generatedVehicleIds.length) {
        setRecentRandomReelVehicleIds((prev) => {
          const next = [...generatedVehicleIds.reverse(), ...prev].slice(0, MAX_RANDOM_REEL_HISTORY);
          saveRecentRandomReelVehicleIds(next);
          return next;
        });
      }
    }

    setGenerationMessage(`Generating ${reelDrafts.length} video reel(s)...`);
    const nextReels = [];

    try {
      for (let index = 0; index < reelDrafts.length; index += 1) {
        const reel = reelDrafts[index];
        setGenerationMessage(`Generating video reel ${index + 1} of ${reelDrafts.length}...`);
        const videoAsset = await generateReelVideoAsset(reel);
        nextReels.push({
          ...reel,
          url: videoAsset.url,
          downloadName: videoAsset.downloadName,
          posterUrl: videoAsset.posterUrl,
          extension: videoAsset.extension,
          mimeType: videoAsset.mimeType,
          audioEmbedded: videoAsset.audioEmbedded,
          blob: videoAsset.blob,
          fileName: videoAsset.downloadName,
        });
      }
    } catch (error) {
      nextReels.forEach((reel) => {
        if (reel.url) window.URL.revokeObjectURL(reel.url);
      });
      setCreativeError(error.message || "Could not generate reel video.");
      setGenerationMessage("");
      return;
    }

    const generatedUsage = nextReels
      .map(reelVehicleUsagePayloadFromReel)
      .filter(Boolean);

    if (generatedUsage.length) {
      try {
        const { setupMissing } = await logReelVehicleUsage(generatedUsage);
        if (setupMissing && !cooldownWarning) {
          cooldownWarning = appendCooldownWarning(
            cooldownWarning,
            "Vehicle usage was not logged because reel_vehicle_usage is not set up yet, so the full 5-day cooldown is not fully active.",
          );
        }
      } catch (error) {
        cooldownWarning = appendCooldownWarning(
          cooldownWarning,
          `Vehicle usage could not be logged: ${error.message || "unknown error"}.`,
        );
      }
    }

    setTodayReels((prev) => [...nextReels, ...prev].slice(0, 20));
    try {
      const libraryCreatives = await addReelsToCreativeLibrary(nextReels);
      await Promise.all(
        libraryCreatives.map((creative, index) =>
          saveReelVideoBlob(creative.id, nextReels[index]?.blob, {
            downloadName: nextReels[index]?.downloadName,
            mimeType: nextReels[index]?.mimeType,
          }).catch(() => {})
        )
      );
      setTodayReels((prev) =>
        prev.map((reel) => {
          const reelIndex = nextReels.findIndex((nextReel) => nextReel.id === reel.id);
          return reelIndex >= 0
            ? {
                ...reel,
                creativeId: libraryCreatives[reelIndex]?.id || reel.creativeId,
              }
            : reel;
        })
      );
      setGenerationMessage(
        `Generated ${nextReels.length} reel(s) and saved them to Creative Library.${cooldownWarning ? ` ${cooldownWarning}` : ""}`,
      );
    } catch (error) {
      setCreativeError(error.message || "Could not save generated reels to Creative Library.");
      setGenerationMessage(
        `Generated ${nextReels.length} reel(s) for Today's Reels.${cooldownWarning ? ` ${cooldownWarning}` : ""}`,
      );
    }
  }

  function handleDownloadReel(reel) {
    downloadReelVideo(reel);
  }

  async function handleDownloadAllReels() {
    for (const reel of todayReels) {
      await handleDownloadReel(reel);
    }
  }

function handleDeleteReel(reelId) {
  setHiddenTodayReelIds((prev) => [...prev, reelId]);

  setTodayReels((prev) => {
    const reel = prev.find((item) => item.id === reelId);

    if (reel?.url?.startsWith?.("blob:")) {
      try {
        window.URL.revokeObjectURL(reel.url);
      } catch {}
    }

    return prev.filter((reel) => reel.id !== reelId);
  });
}

   
async function handleClearTodayReels() {
  const reelsToDelete = [...todayReels];

  setTodayReels((prev) => {
    prev.forEach((reel) => {
      if (reel?.url?.startsWith?.("blob:")) {
        try {
          URL.revokeObjectURL(reel.url);
        } catch {}
      }
    });

    return [];
  });

  const reelIds = reelsToDelete.map((reel) => reel.id).filter(Boolean);

  setCreatives((prev) => prev.filter((creative) => !reelIds.includes(creative.id)));
  setRecentGeneratedIds((prev) => prev.filter((id) => !reelIds.includes(id)));

  try {
    await Promise.all(reelIds.map((id) => deleteMarketingCreative(id)));
  } catch (error) {
    setCreativeError(error.message || "Could not clear today's reels.");
  }
}

  function escapeSvgText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function downloadFinanceAdvertImage(vehicle) {
    const title = escapeSvgText(vehicle.name || vehicle.vanDescription || vehicle.reg || "Finance van");
    const reg = escapeSvgText(vehicle.reg || "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#bg)"/>
  <rect x="70" y="70" width="1060" height="610" rx="38" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.26)" stroke-width="3"/>
  <text x="600" y="170" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="900" fill="#ffffff" letter-spacing="5">VAN FINANCE COMPANY</text>
  <text x="600" y="310" text-anchor="middle" font-family="Arial, sans-serif" font-size="78" font-weight="900" fill="#ffffff">FROM £99 DEPOSIT</text>
  <text x="600" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="800" fill="#dbeafe">${title}</text>
  <text x="600" y="500" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="#bfdbfe">${reg}</text>
  <text x="600" y="600" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#ffffff">BAD CREDIT CONSIDERED | SELF-EMPLOYED WELCOME</text>
</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${String(vehicle.description || vehicle.name || vehicle.reg || "finance-van")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()}-finance.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  }

  async function downloadAdvertImage(vehicle, destination) {
    const imageUrl = vehicle.image || vehicle.picture;
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${String(vehicle.description || vehicle.name || vehicle.reg || "van")
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function prepareVehicleAdvert(vehicle, destination, preparedCaption = "") {
    const caption = sanitizePostingCaption(preparedCaption || buildPostingCaption(vehicle, { destination }));
    if (!navigator.clipboard?.writeText) {
      window.prompt("Copy caption", caption);
    } else {
      await navigator.clipboard.writeText(caption).catch(() => {
        window.prompt("Copy caption", caption);
      });
    }

    await downloadAdvertImage(vehicle, destination);
  }

  async function handlePostVehicle(vehicle, destination, preparedCaption = "") {
    try {
      await prepareVehicleAdvert(vehicle, destination, preparedCaption);
      handleMarkVehiclePosted(vehicle, destination);
      handleSkipVehicle(vehicle, destination);
      handleOpenFacebookPage(destination);
    } catch {
      handleOpenFacebookPage(destination);
    }
  }

  function getDefaultPostingDestination(vehicle) {
    return vehicle.pipeline === "rent2buy" ? "Rent2Buy Facebook" : "Van Finance Facebook";
  }

  function getPostingActionKey(vehicle, destination) {
    return `${normalizePostingVehicleId(vehicle)}::${destination}`;
  }

  function getPostingPageKey(destination) {
    if (destination === "Van Finance Facebook") return "vanFinanceFacebook";
    if (destination === "Rent2Buy Facebook") return "rent2BuyFacebook";
    return "marketplace";
  }

  function handleOpenFacebookPage(destination) {
    const destinationUrls = {
      "Van Finance Facebook": FINANCE_FACEBOOK_URL,
      "Rent2Buy Facebook": RENT_FACEBOOK_URL,
      "Facebook Marketplace": MARKETPLACE_URL,
    };
    const url = destinationUrls[destination] || FINANCE_FACEBOOK_URL;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleRefreshStock() {
    loadVehicles();
  }

  function handleSyncStock(destination) {
    const syncUrl = destination === "Van Finance Facebook" ? FINANCE_SYNC_URL : RENT_SYNC_URL;
    window.open(syncUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => {
      loadVehicles();
    }, 3000);
  }

  function handleMarkVehiclePosted(vehicle, destination = getDefaultPostingDestination(vehicle)) {
    const activityType = destination === "Van Finance Facebook"
      ? "van_finance_facebook_post"
      : destination === "Rent2Buy Facebook" ? "rent2buy_facebook_post" : "";
    if (activityType) {
      const sourceId = `${londonDateKey()}::${getPostingActionKey(vehicle, destination)}`;
      recordDailyMarketingActivity(activityType, {
        activityDate: londonDateKey(),
        source: "posting_desk",
        sourceId,
        metadata: { vehicle_id: vehicle.id || null, registration: vehicle.registration || vehicle.reg || "", destination },
      }).catch((error) => setCreativeError(error.message || "The post was marked locally, but the daily total could not be updated."));
    }
    setPostedToday((prev) => {
      const postingKey = getPostingActionKey(vehicle, destination);
      if (
        prev.some(
          (item) =>
            getPostingActionKey(
              item.vehicle,
              item.destination || getDefaultPostingDestination(item.vehicle)
            ) === postingKey
        )
      ) {
        return prev;
      }

      return [
        {
          id: `posted-${Date.now()}-${vehicle.id}-${destination}`,
          vehicle,
          postedAt: new Date().toISOString(),
          destination,
        },
        ...prev,
      ];
    });
  }

  function handleSkipVehicle(vehicle, destination = getDefaultPostingDestination(vehicle)) {
    const pageKey = getPostingPageKey(destination);
    setHiddenPostingVehicleIds((prev) => {
      const currentIds = prev[pageKey] || [];
      const vehicleId = normalizePostingVehicleId(vehicle);
      const updatedIds = currentIds.includes(vehicleId) ? currentIds : [...currentIds, vehicleId];
      saveHiddenPostingIds(pageKey, updatedIds);

      return {
        ...prev,
        [pageKey]: updatedIds,
      };
    });
  }

  function handleShowHiddenAgain(destination) {
    const pageKey = getPostingPageKey(destination);
    saveHiddenPostingIds(pageKey, []);
    setHiddenPostingVehicleIds((prev) => ({
      ...prev,
      [pageKey]: [],
    }));
  }

  function handleGenerateFromStock(vehicle) {
    const lock = reelActionLocks[getManualQueueVehicleId(vehicle)];
    console.log("Stock reel lock check", {
      registration: vehicle?.reg || vehicle?.registration || vehicle?.name || "",
      pipeline: stockFilters.pipeline === "rent2buy" ? "rent2buy" : "vanFinance",
      locked: Boolean(lock?.locked),
      bypassed: ignoreReelLock,
    });

    if (lock?.locked && !ignoreReelLock) {
      setGenerationMessage("This vehicle is locked for reels for 72 hours after download.");
      setCreativeError("");
      return;
    }

    const targetPipeline = stockFilters.pipeline === "rent2buy" ? "rent2buy" : "vanFinance";
    const reelVehicle = asPipelineVehicle(vehicle, targetPipeline);
    const isRent = reelVehicle.pipeline === "rent2buy";
    setSelectedVehicleId(vehicle.id);
    setSelectedVehicleIds([vehicle.id]);
    setReelFactoryVehicleId(vehicle.id);
    setReelFactorySelectionMode("stock");
    setFactoryFilters((prev) => ({ ...prev, pipeline: reelVehicle.pipeline }));
    setReelFactoryForm((prev) => ({
      ...prev,
      reelSource: isRent ? "Rent2Buy stock" : "Finance stock",
      reelType: isRent ? "Rent2Buy" : "Finance",
      quantity: 1,
      hookMode: "Single selected hook",
    }));
    setGenerationMessage(`${vehicle.name || vehicle.reg || "Selected vehicle"} is ready in Premium Reel Studio.`);
    setCreativeError("");
    if (typeof window !== "undefined" && window.location.pathname !== VIEW_PATHS["Premium Reel Studio"]) {
      window.history.pushState({}, "", VIEW_PATHS["Premium Reel Studio"]);
    }
    setCurrentView("Premium Reel Studio");
  }

  function handleToggleManualStockVehicle(vehicle) {
    const vehicleId = getManualQueueVehicleId(vehicle);
    if (!vehicleId) return;
    const lock = reelActionLocks[vehicleId];
    console.log("Stock manual queue lock check", {
      registration: vehicle?.reg || vehicle?.registration || vehicle?.name || "",
      locked: Boolean(lock?.locked),
      bypassed: ignoreReelLock,
    });

    if (lock?.locked && !ignoreReelLock) {
      setGenerationMessage("This vehicle is locked for reels for 72 hours after download.");
      setCreativeError("");
      return;
    }

    setManualStockSelectedIds((prev) =>
      prev.includes(vehicleId)
        ? prev.filter((id) => id !== vehicleId)
        : [...prev, vehicleId]
    );
  }

  function handleAddSelectedToManualReelQueue(queueKey) {
    const targetPipeline = getManualQueueTargetPipeline(queueKey);
    const selectedIds = new Set(manualStockSelectedIds);
    const selectedVehicles = vehicles
      .filter((vehicle) => selectedIds.has(getManualQueueVehicleId(vehicle)))
      .filter((vehicle) => queueKey !== "rent2buy" || isRent2BuyEligible(vehicle))
      .filter((vehicle) => ignoreReelLock || !reelActionLocks[getManualQueueVehicleId(vehicle)]?.locked);
    const selectedItems = selectedVehicles.map((vehicle) => createManualQueueItem(vehicle, queueKey));

    if (!selectedItems.length) {
      setGenerationMessage("Select at least one stock vehicle for the manual reel queue.");
      return;
    }

    setManualReelQueues((prev) => {
      const existing = (prev[queueKey] || []).map((item) => normalizeManualQueueItem(item, queueKey)).filter(Boolean);
      const existingIds = new Set(existing.map((item) => item.id || item.reg));
      const additions = selectedItems.filter(
        (item) => !existingIds.has(item.id || item.reg)
      );
      const nextQueue = [...existing, ...additions];
      const nextQueues = { ...prev, [queueKey]: nextQueue };
      saveManualReelQueue(queueKey, nextQueue);
      return nextQueues;
    });

    setManualReelQueueType(queueKey);
    setManualStockSelectedIds([]);
    setFactoryFilters((prev) => ({ ...prev, pipeline: targetPipeline }));
    setReelFactoryForm((prev) => ({
      ...prev,
      reelSource: queueKey === "rent2buy" ? "Rent2Buy stock" : "Finance stock",
      reelType: queueKey === "rent2buy" ? "Rent2Buy" : "Finance",
      quantity: 1,
      hookMode: "Single selected hook",
    }));
    setGenerationMessage(
      `${selectedItems.length} vehicle${selectedItems.length === 1 ? "" : "s"} added to the ${
        queueKey === "rent2buy" ? "Rent2Buy" : "Finance"
      } premium reel queue.`
    );
    setCreativeError("");
    if (typeof window !== "undefined" && window.location.pathname !== VIEW_PATHS["Premium Reel Studio"]) {
      window.history.pushState({}, "", VIEW_PATHS["Premium Reel Studio"]);
    }
    setCurrentView("Premium Reel Studio");
  }

  function updateReelLabQueue(productKey, updater) {
    const queueKey = getReelLabQueueKey(productKey);
    setReelLabQueues((prev) => {
      const currentQueue = (prev[queueKey] || [])
        .map((item) => normalizeReelLabQueueItem(item, queueKey))
        .filter(Boolean);
      const nextQueue = updater(currentQueue);
      const normalizedQueue = nextQueue.map((item) => normalizeReelLabQueueItem(item, queueKey)).filter(Boolean);
      const nextQueues = { ...prev, [queueKey]: normalizedQueue };
      saveReelLabQueue(queueKey, normalizedQueue);
      return nextQueues;
    });
  }

  function handleAddSelectedToReelLabQueue(queueKey) {
    const productQueueKey = getReelLabQueueKey(queueKey === "rent2buy" ? "rent2buy" : "vanFinance");
    const selectedIds = new Set(manualStockSelectedIds);
    const selectedVehicles = vehicles
      .filter((vehicle) => selectedIds.has(getManualQueueVehicleId(vehicle)))
      .filter((vehicle) => productQueueKey !== "rent2buy" || isRent2BuyEligible(vehicle))
      .filter((vehicle) => ignoreReelLock || !reelActionLocks[getManualQueueVehicleId(vehicle)]?.locked);
    const selectedItems = selectedVehicles.map((vehicle) => createReelLabQueueItem(vehicle, productQueueKey));

    if (!selectedItems.length) {
      setGenerationMessage("Select at least one stock vehicle for the Reel Lab queue.");
      setCreativeError("");
      return;
    }

    updateReelLabQueue(productQueueKey, (existing) => {
      const existingIds = new Set(existing.map((item) => item.id || item.reg || item.title || item.name));
      const additions = selectedItems.filter((item) => {
        const key = item.id || item.reg || item.title || item.name;
        return key && !existingIds.has(key);
      });
      return [...existing, ...additions];
    });

    setManualStockSelectedIds([]);
    setGenerationMessage(
      `${selectedItems.length} selected vehicle${selectedItems.length === 1 ? "" : "s"} added to ${
        productQueueKey === "rent2buy" ? "Rent2Buy" : "Finance"
      } Reel Lab Queue. Open Reel Lab Beta to download.`
    );
    setCreativeError("");
  }

  function handleUpdateReelLabQueue(productKey, nextVehicles) {
    const queueKey = getReelLabQueueKey(productKey);
    const nextItems = (nextVehicles || []).map((vehicle) => createReelLabQueueItem(vehicle, queueKey));
    updateReelLabQueue(queueKey, () => nextItems);
  }

  function updateYouTubeQueue(productKey, updater) {
    const queueKey = getYouTubeQueueKey(productKey);
    setYoutubeQueues((prev) => {
      const currentQueue = (prev[queueKey] || [])
        .map((item) => normalizeYouTubeQueueItem(item, queueKey))
        .filter(Boolean);
      const nextQueue = updater(currentQueue);
      const normalizedQueue = nextQueue.map((item) => normalizeYouTubeQueueItem(item, queueKey)).filter(Boolean);
      const nextQueues = { ...prev, [queueKey]: normalizedQueue };
      saveYouTubeQueue(queueKey, normalizedQueue);
      return nextQueues;
    });
  }

  async function handleAddSelectedToYouTubeQueue(queueKey) {
    const productQueueKey = getYouTubeQueueKey(queueKey);
    const requiredImageCount = YOUTUBE_DEFAULT_IMAGE_COUNT;
    const cmsUploads = await loadYouTubeCmsUploadsAsync();
    setYoutubeCmsUploads(cmsUploads);
    const selectedIds = new Set(manualStockSelectedIds);
    const eligibleVehicles = vehicles
      .filter((vehicle) => selectedIds.has(getManualQueueVehicleId(vehicle)))
      .filter((vehicle) => productQueueKey !== "rent2buy" || isRent2BuyEligible(vehicle))
      .filter((vehicle) => productQueueKey !== "cars" || vehicle.pipeline === "cars");
    const checkedVehicles = eligibleVehicles.map((vehicle) => {
      const imageOrder = resolveYouTubeImageOrder({
        vehicle,
        cmsUpload: cmsUploads[productQueueKey],
        imageSource: "auto",
        imageCount: requiredImageCount,
      });
      return {
        vehicle,
        imageCount: imageOrder.totalAvailable,
        sourceLabel: imageOrder.sourceLabel || imageOrder.source || "no images found",
      };
    });
    const warningVehicles = checkedVehicles.filter(({ imageCount }) => imageCount < requiredImageCount);
    const selectedItems = checkedVehicles.map(({ vehicle }) => createYouTubeQueueItem(vehicle, productQueueKey));

    if (!eligibleVehicles.length) {
      setGenerationMessage("Select at least one stock vehicle for the YouTube queue.");
      setCreativeError("");
      return;
    }

    let addedCount = 0;
    if (selectedItems.length) {
      updateYouTubeQueue(productQueueKey, (existing) => {
        const existingIds = new Set(existing.map((item) => item.id || item.reg || item.title || item.name));
        const additions = selectedItems.filter((item) => {
          const key = item.id || item.reg || item.title || item.name;
          return key && !existingIds.has(key);
        });
        addedCount = additions.length;
        return [...existing, ...additions];
      });
    }

    setManualStockSelectedIds([]);
    const warningDetails = warningVehicles
      .slice(0, 8)
      .map(({ vehicle, imageCount, sourceLabel }) => `${vehicleQueueLabel(vehicle)} - ${imageCount} / ${requiredImageCount} images - ${sourceLabel}`)
      .join("\n");
    const duplicateCount = selectedItems.length - addedCount;
    const summaryLines = [
      `${addedCount} vehicle${addedCount === 1 ? "" : "s"} added to YouTube Queue.`,
      duplicateCount > 0 ? `${duplicateCount} selected vehicle${duplicateCount === 1 ? " was" : "s were"} already in the YouTube Queue.` : "",
      warningDetails ? `Image warnings only - YouTube Generator will validate during generation:\n${warningDetails}` : "",
      warningVehicles.length > 8 ? `...and ${warningVehicles.length - 8} more image warning${warningVehicles.length - 8 === 1 ? "" : "s"}.` : "",
      "Open YouTube Generator to download.",
    ].filter(Boolean);
    setGenerationMessage(summaryLines.join("\n"));
    setCreativeError("");
  }

  function handleUpdateYouTubeQueue(productKey, nextVehicles) {
    const queueKey = getYouTubeQueueKey(productKey);
    const nextItems = (nextVehicles || []).map((vehicle) => createYouTubeQueueItem(vehicle, queueKey));
    updateYouTubeQueue(queueKey, () => nextItems);
  }

  function handleUpdateYouTubeCmsUpload(productKey, upload) {
    const queueKey = getYouTubeQueueKey(productKey);
    setYoutubeCmsUploads((prev) => ({ ...prev, [queueKey]: upload || null }));
  }

  function updateManualReelQueue(queueKey, updater) {
    setManualReelQueues((prev) => {
      const currentQueue = (prev[queueKey] || [])
        .map((item) => normalizeManualQueueItem(item, queueKey))
        .filter(Boolean);
      const nextQueue = updater(currentQueue);
      const nextQueues = { ...prev, [queueKey]: nextQueue };
      saveManualReelQueue(queueKey, nextQueue);
      return nextQueues;
    });
  }

  function handleNextManualQueuedVehicle(queueKey) {
    updateManualReelQueue(queueKey, (queue) =>
      queue.length > 1 ? [...queue.slice(1), queue[0]] : queue
    );
  }

  function handleRemoveManualQueuedVehicle(queueKey) {
    updateManualReelQueue(queueKey, (queue) => queue.slice(1));
  }

  function handleClearManualReelQueue(queueKey) {
    updateManualReelQueue(queueKey, () => []);
  }

  async function handleGenerateManualQueuedReel(queueKey, options = {}) {
    const queue = manualReelQueues[queueKey] || [];
    const queueItem = normalizeManualQueueItem(options.queueItem || queue[0], queueKey);
    const failManualQueueGeneration = (message) => {
      if (options.throwOnError) {
        throw new Error(message);
      }
      return null;
    };

    if (!queueItem) {
      setGenerationMessage("No vehicles are queued for that manual reel queue.");
      return failManualQueueGeneration("No vehicles are queued for that manual reel queue.");
    }

    const vehicle = resolveManualQueuedVehicle(queueItem, vehicles);
    if (!vehicle) {
      console.warn("Queued vehicle no longer found in current stock.", {
        id: queueItem.id,
        reg: queueItem.reg,
        targetPipeline: queueItem.targetPipeline,
      });
      setGenerationMessage("Queued vehicle no longer found in current stock. Remove it or refresh stock.");
      setCreativeError("");
      return failManualQueueGeneration("Queued vehicle no longer found in current stock. Remove it or refresh stock.");
    }

    if (!vehicle.image) {
      console.warn("Queued vehicle has no usable image in current stock.", {
        id: queueItem.id,
        reg: queueItem.reg,
        targetPipeline: queueItem.targetPipeline,
      });
      setGenerationMessage("Queued vehicle has no usable image in current stock. Refresh stock or remove it.");
      setCreativeError("");
      return failManualQueueGeneration("Queued vehicle has no usable image in current stock. Refresh stock or remove it.");
    }

    const lock = getReelActionLock(vehicle, reelDownloadCooldowns);
    console.log("Manual queued reel lock check", {
      registration: vehicle?.reg || vehicle?.registration || vehicle?.name || "",
      queueKey,
      reelType: vehicle?.pipeline,
      locked: Boolean(lock?.locked),
      bypassed: ignoreReelLock,
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
    if (typeof window !== "undefined") {
      const navigationEvent = new CustomEvent("marketing-before-navigate", {
        cancelable: true,
        detail: { view },
      });
      if (!window.dispatchEvent(navigationEvent)) return;
    }
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
      case "Marketing Centre":
        return <MarketingCentrePage />;
      case "Knowledge Hub":
        return <KnowledgeHubPage />;
      case "Content Factory":
        return <ContentFactoryPage />;
      case "AI Visibility":
        return <AIVisibilityPage />;
      case "AI Assistant Competence Test":
        return <AIAssistantCompetencePage />;
      case "AI Knowledge Opportunities":
        return <AIKnowledgeOpportunitiesPage />;
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
      case "Content Operations":
      default:
        return (
          <DashboardPage onNavigate={handleNavigate} />
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
        {renderCurrentPage()}
      </main>
    </div>
  );
}
