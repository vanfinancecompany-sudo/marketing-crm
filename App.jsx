// 🚀 INSTANT TRACK + REDIRECT (runs before React loads)
if (typeof window !== "undefined" && window.location.pathname.startsWith("/track")) {
  try {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type") === "rent2buy" ? "rent2buy" : "finance";
    const reelId = params.get("reel") || "unknown";
    const source = params.get("src") || "reel";

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

    const redirects = {
      finance: "https://www.vanfinancecompany.co.uk/",
      rent2buy: "https://www.rent2buyvans.co.uk/",
    };

    window.location.replace(redirects[type] || "https://marketing-crm-six.vercel.app/");
  } catch (e) {
    // fallback redirect
    window.location.replace("https://www.vanfinancecompany.co.uk/");
  }
}

import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ControlCentrePage from "./pages/ControlCentrePage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import StockPage from "./pages/StockPage.jsx";
import ReelFactoryPage from "./pages/ReelFactoryPage.jsx";
import CreativeLibraryPage from "./pages/CreativeLibraryPage.jsx";
import PostingDeskPage from "./pages/PostingDeskPage.jsx";
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
} from "./utils/creativeUtils.js";
import { fetchMarketingVehicles } from "./services/marketingVehicles.js";
import {
  deleteMarketingCreative,
  fetchMarketingCreatives,
  fetchTodayReelCreatives,
  saveMarketingCreatives,
} from "./services/marketingCreatives.js";
import { fetchReelClickDashboard, logReelClick } from "./services/reelClickTracking.js";

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

const REEL_CLICK_HISTORY_STORAGE_KEY = "marketingReelClickHistory";
const RANDOM_REEL_HISTORY_STORAGE_KEY = "marketingRecentRandomReelVehicleIds";
const ROLLING_REEL_WINDOW_DAYS = 7;
const MAX_RANDOM_REEL_HISTORY = 24;

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
    return Array.isArray(saved) ? saved.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRecentRandomReelVehicleIds(ids) {
  if (typeof window === "undefined") return;

  const normalized = ids.map((id) => String(id || "")).filter(Boolean).slice(0, MAX_RANDOM_REEL_HISTORY);
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
  if (item.kind === "vehicle") return `vehicle:${item.vehicle.id}`;
  if (item.kind === "upload") return `upload:${item.image.id}`;
  return JSON.stringify(item);
}

function rankRandomPool(pool, recentVehicleIds = []) {
  const recentIds = new Set(recentVehicleIds);

  // 🔥 HARD EXCLUDE recent vehicles
  const fresh = pool.filter(
    (item) =>
      item.kind !== "vehicle" || !recentIds.has(item.vehicle.id)
  );

  // if enough fresh items → ONLY use them
  if (fresh.length >= 5) {
    return shuffleItems(fresh);
  }

  // fallback: allow all (prevents empty pool issue)
  return shuffleItems(pool);
}

const VIEW_PATHS = {
  Dashboard: "/",
  Stock: "/stock",
  "Reel Factory": "/reel-factory",
  "Creative Library": "/creative-library",
  "Van Finance Facebook": "/van-finance-facebook",
  "Rent2Buy Facebook": "/rent2buy-facebook",
  "Facebook Marketplace": "/facebook-marketplace",
};

function viewFromPath() {
  if (typeof window === "undefined") return "Dashboard";

  const path = window.location.pathname;

  if (path === "/stock") return "Stock";
  if (path === "/reel-factory") return "Reel Factory";
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

export default function App() {
  const [currentView, setCurrentView] = useState(viewFromPath);
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [recentGeneratedIds, setRecentGeneratedIds] = useState([]);
  const [creativeError, setCreativeError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [stockFilters, setStockFilters] = useState(DEFAULT_STOCK_FILTERS);
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
      setSelectedVehicleId((prev) => prev || data[0]?.id || "");
      setSelectedVehicleIds((prev) => (prev.length ? prev : data[0]?.id ? [data[0].id] : []));
    } catch (error) {
      setVehicles([]);
      setVehiclesError(error.message || "Failed to load vehicles.");
    } finally {
      setVehiclesLoading(false);
    }
  }

  useEffect(() => {
    loadVehicles();
  }, []);

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
  const selectedReelFactoryVehicle =
    reelFactorySelectionMode === "stock"
      ? vehicles.find((vehicle) => vehicle.id === reelFactoryVehicleId) || null
      : null;

  const filteredStockVehicles = useMemo(() => {
    return filterVehicles(vehicles, stockFilters);
  }, [vehicles, stockFilters]);

  const filteredFactoryVehicles = useMemo(() => {
    return filterVehicles(vehicles, factoryFilters);
  }, [vehicles, factoryFilters]);

  const filteredLibraryCreatives = useMemo(() => {
    return filterCreatives(creatives, libraryFilters);
  }, [creatives, libraryFilters]);

  const generatedCreatives = useMemo(() => {
    return creatives.filter((creative) => recentGeneratedIds.includes(creative.id));
  }, [creatives, recentGeneratedIds]);

  const recentCreatives = useMemo(() => {
    return [...creatives]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
  }, [creatives]);

  const financeVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => vehicle.pipeline === "vanFinance");
  }, [vehicles]);

  const rentVehicles = useMemo(() => {
    return vehicles.filter((vehicle) => vehicle.pipeline === "rent2buy");
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
      .filter((vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Van Finance Facebook")))
      .filter((vehicle) => !hiddenIds.has(normalizePostingVehicleId(vehicle)));
  }, [financeVehicles, postedPostingKeys, hiddenPostingVehicleIds.vanFinanceFacebook]);

  const rent2BuyFacebookQueue = useMemo(() => {
    const hiddenIds = new Set(hiddenPostingVehicleIds.rent2BuyFacebook);
    return rentVehicles
      .filter((vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Rent2Buy Facebook")))
      .filter((vehicle) => !hiddenIds.has(normalizePostingVehicleId(vehicle)));
  }, [rentVehicles, postedPostingKeys, hiddenPostingVehicleIds.rent2BuyFacebook]);

  const marketplaceQueue = useMemo(() => {
    const hiddenIds = new Set(hiddenPostingVehicleIds.marketplace);
    return rentVehicles
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

    return createReelRecord({
      vehicle,
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

    if (
      reelFactorySelectionMode === "stock" &&
      selectedReelVehicle &&
      source !== "Uploaded images" &&
      allowedPipelines.has(selectedReelVehicle.pipeline)
    ) {
      return [{ kind: "vehicle", vehicle: selectedReelVehicle }];
    }

    const vehiclePool = [
      ...financeVehicles.filter((vehicle) => allowedPipelines.has(vehicle.pipeline)),
      ...rentVehicles.filter((vehicle) => allowedPipelines.has(vehicle.pipeline)),
    ].filter((vehicle) => {
      if (source === "Uploaded images") return false;
      return true;
    });

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

  function pickRandomReelPoolItems(pool, quantity) {
    const selectedMode = reelFactorySelectionMode === "stock";
    if (selectedMode || pool.length <= 1) {
      return Array.from({ length: quantity }, (_, index) => pool[index % pool.length]);
    }

    const uniquePool = [];
    const seenKeys = new Set();

    rankRandomPool(pool, recentRandomReelVehicleIds).forEach((item) => {
      const key = getRandomPoolItemKey(item);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      uniquePool.push(item);
    });

    if (!uniquePool.length) {
      return Array.from({ length: quantity }, (_, index) => pool[index % pool.length]);
    }

    const selected = [];
    let batchRecentIds = [...recentRandomReelVehicleIds];

    while (selected.length < quantity) {
      const round = rankRandomPool(uniquePool, batchRecentIds);
      const remaining = quantity - selected.length;
      const nextItems = round.slice(0, remaining);
      selected.push(...nextItems);

      const roundVehicleIds = nextItems
        .filter((item) => item.kind === "vehicle")
        .map((item) => item.vehicle.id);

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

    const pool = buildDailyReelPool();
    const quantity = Math.max(1, Math.min(50, Number(reelFactoryForm.quantity) || 10));

    if (!pool.length) {
      setGenerationMessage("No stock or uploaded images are available for those reel settings.");
      return;
    }

    const hookCounters = {
      vanFinance: 0,
      rent2buy: 0,
    };

    const selectedPoolItems = pickRandomReelPoolItems(pool, quantity);
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
        .map((item) => item.vehicle.id)
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
      setGenerationMessage(`Generated ${nextReels.length} reel(s) and saved them to Creative Library.`);
    } catch (error) {
      setCreativeError(error.message || "Could not save generated reels to Creative Library.");
      setGenerationMessage(`Generated ${nextReels.length} reel(s) for Today's Reels.`);
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

  async function downloadAdvertImage(vehicle) {
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

    await downloadAdvertImage(vehicle);
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
    const isRent = vehicle.pipeline === "rent2buy";
    setSelectedVehicleId(vehicle.id);
    setSelectedVehicleIds([vehicle.id]);
    setReelFactoryVehicleId(vehicle.id);
    setReelFactorySelectionMode("stock");
    setFactoryFilters((prev) => ({ ...prev, pipeline: vehicle.pipeline }));
    setReelFactoryForm((prev) => ({
      ...prev,
      reelSource: isRent ? "Rent2Buy stock" : "Finance stock",
      reelType: isRent ? "Rent2Buy" : "Finance",
      quantity: 1,
      hookMode: "Single selected hook",
    }));
    setGenerationMessage(`${vehicle.name || vehicle.reg || "Selected vehicle"} is ready in Reel Factory.`);
    setCreativeError("");
    setCurrentView("Reel Factory");
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
      setCreativeError(error.message || "This saved reel does not have downloadable video media.");
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
          />
        );
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

        {renderCurrentPage()}
      </main>
    </div>
  );
}
