export const BUFFER_AUTOMATION_MODES = Object.freeze(["off", "draft", "queue"]);

export const DEFAULT_BUFFER_AUTOMATION_CONFIG = Object.freeze({
  mode: "off",
  vanFinancePostsPerDay: 0,
  rent2buyPostsPerDay: 0,
  vanFinanceReelsPerDay: 0,
  rent2buyReelsPerDay: 0,
  updatedAt: null,
});

const MAX_DAILY_ITEMS_PER_PRODUCT = 10;

function boundedDailyCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(MAX_DAILY_ITEMS_PER_PRODUCT, parsed));
}

export function normalizeBufferAutomationConfig(value = {}) {
  const mode = BUFFER_AUTOMATION_MODES.includes(value?.mode) ? value.mode : "off";
  return {
    mode,
    vanFinancePostsPerDay: boundedDailyCount(value?.vanFinancePostsPerDay),
    rent2buyPostsPerDay: boundedDailyCount(value?.rent2buyPostsPerDay),
    vanFinanceReelsPerDay: boundedDailyCount(value?.vanFinanceReelsPerDay),
    rent2buyReelsPerDay: boundedDailyCount(value?.rent2buyReelsPerDay),
    updatedAt: value?.updatedAt || null,
  };
}

export function bufferAutomationTarget(config, productKey, mediaKind) {
  const safe = normalizeBufferAutomationConfig(config);
  if (mediaKind === "video") {
    return productKey === "rent2buy" ? safe.rent2buyReelsPerDay : safe.vanFinanceReelsPerDay;
  }
  return productKey === "rent2buy" ? safe.rent2buyPostsPerDay : safe.vanFinancePostsPerDay;
}

export function extractBufferRegistration(value) {
  const text = String(value || "").toUpperCase();
  const labelled = text.match(/REGISTRATION\s*:\s*([A-Z0-9 ]{5,10})/i)?.[1] || "";
  const candidate = labelled || text;
  const match = candidate.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/,
  );
  return String(match?.[1] || "").replace(/[^A-Z0-9]/g, "");
}

export function bufferPostMediaKind(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  return assets.some((asset) => /^video\//i.test(String(asset?.mimeType || "")))
    ? "video"
    : "image";
}

export function isBufferPostReserved(post) {
  return ["draft", "scheduled", "sending"].includes(String(post?.status || "").toLowerCase());
}

export function bufferPostsForChannelAndKind(posts, channelId, mediaKind) {
  return (posts || []).filter(
    (post) => post?.channelId === channelId && bufferPostMediaKind(post) === mediaKind,
  );
}

export function chooseOldestFacebookCandidate({ vehicles = [], historyRows = [], reservedRegistrations = [] } = {}) {
  const reserved = new Set(
    (reservedRegistrations || []).map((value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean),
  );
  const latestByRegistration = new Map();
  for (const row of historyRows || []) {
    const registration = String(
      row?.metadata?.registration || row?.metadata?.reg || "",
    ).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!registration) continue;
    const timestamp = new Date(row?.occurred_at || row?.activity_date || 0).getTime();
    if (!timestamp) continue;
    const previous = latestByRegistration.get(registration) || 0;
    if (timestamp > previous) latestByRegistration.set(registration, timestamp);
  }

  return [...(vehicles || [])]
    .filter((vehicle) => {
      const registration = String(vehicle?.registration || vehicle?.reg || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const image = String(vehicle?.image || vehicle?.picture || "").trim();
      return registration && image && !reserved.has(registration);
    })
    .sort((first, second) => {
      const firstReg = String(first.registration || first.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const secondReg = String(second.registration || second.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const firstLast = latestByRegistration.get(firstReg) || 0;
      const secondLast = latestByRegistration.get(secondReg) || 0;
      if (!firstLast && secondLast) return -1;
      if (firstLast && !secondLast) return 1;
      if (firstLast !== secondLast) return firstLast - secondLast;
      return firstReg.localeCompare(secondReg);
    })[0] || null;
}

export function londonDateKeyForValue(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function postCountsTowardLondonDate(post, dateKey) {
  const timestamp = post?.dueAt || post?.createdAt;
  if (!timestamp) return false;
  return londonDateKeyForValue(timestamp) === dateKey;
}
