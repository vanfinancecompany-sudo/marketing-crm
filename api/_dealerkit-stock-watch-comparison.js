import { fetchCmsItems } from "./dealerkit-image-readiness.js";
import { loadLiveWixListingPresence } from "./stock-watch-wix-listing-presence.js";

export const STOCK_WATCH_PIPELINES = Object.freeze(["finance", "rent2buy", "cars"]);

export async function loadStockWatchComparisonInputs(pipeline, {
  loadPresence = loadLiveWixListingPresence,
  loadCms = fetchCmsItems,
} = {}) {
  if (!STOCK_WATCH_PIPELINES.includes(pipeline)) throw new Error("Unknown Stock Watch pipeline.");
  const startedAt = Date.now();
  const timings = { wixListingPresenceMs: 0, wixCmsImageMs: 0 };
  const timed = async (key, work) => {
    const began = Date.now();
    try { return await work(); }
    finally { timings[key] = Date.now() - began; }
  };
  const [presenceResult, cmsResult] = await Promise.allSettled([
    timed("wixListingPresenceMs", () => loadPresence(pipeline)),
    timed("wixCmsImageMs", () => loadCms(pipeline)),
  ]);
  const presence = presenceResult.status === "fulfilled" && presenceResult.value?.complete === true
    ? presenceResult.value
    : {
      complete: false,
      registrations: [],
      vehicles: [],
      errors: presenceResult.status === "rejected"
        ? [{ error: String(presenceResult.reason?.message || presenceResult.reason || "Wix listing read failed.") }]
        : presenceResult.value?.errors || [{ error: "Wix listing read was incomplete." }],
    };
  const cmsError = cmsResult.status === "rejected"
    ? String(cmsResult.reason?.message || cmsResult.reason || "Wix image read failed.")
    : "";
  return {
    pipeline,
    presence,
    cmsItems: cmsError ? [] : (cmsResult.value?.items || []).map((item) => ({
      registration: item.registration,
      imageCount: item.imageCount,
    })),
    cmsRefreshedAt: cmsError ? "" : cmsResult.value?.refreshedAt || "",
    cmsError,
    timing: { ...timings, totalMs: Date.now() - startedAt },
  };
}
