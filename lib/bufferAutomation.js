export const BUFFER_AUTOMATION_START_DATE = "2026-08-21";

export const DEFAULT_BUFFER_AUTOMATION_CONFIG = Object.freeze({
  enabled: true,
  startDate: BUFFER_AUTOMATION_START_DATE,
  vanFinancePostsPerDay: 10,
  rent2buyPostsPerDay: 10,
  vanFinanceReelsPerDay: 10,
  rent2buyReelsPerDay: 10,
  firstPostLocalMinutes: 8 * 60,
  slotGapMinutes: 38,
  rent2buyOffsetMinutes: 10,
  updatedAt: null,
});

const MAX_PER_KIND = 10;
const DAY_MINUTES = 24 * 60;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeBufferAutomationConfig(value = {}) {
  const defaults = DEFAULT_BUFFER_AUTOMATION_CONFIG;
  return {
    enabled: value?.enabled === undefined ? defaults.enabled : Boolean(value.enabled),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.startDate || ""))
      ? String(value.startDate)
      : defaults.startDate,
    vanFinancePostsPerDay: boundedInt(value?.vanFinancePostsPerDay, defaults.vanFinancePostsPerDay, 0, MAX_PER_KIND),
    rent2buyPostsPerDay: boundedInt(value?.rent2buyPostsPerDay, defaults.rent2buyPostsPerDay, 0, MAX_PER_KIND),
    vanFinanceReelsPerDay: boundedInt(value?.vanFinanceReelsPerDay, defaults.vanFinanceReelsPerDay, 0, MAX_PER_KIND),
    rent2buyReelsPerDay: boundedInt(value?.rent2buyReelsPerDay, defaults.rent2buyReelsPerDay, 0, MAX_PER_KIND),
    firstPostLocalMinutes: boundedInt(value?.firstPostLocalMinutes, defaults.firstPostLocalMinutes, 0, DAY_MINUTES - 1),
    slotGapMinutes: boundedInt(value?.slotGapMinutes, defaults.slotGapMinutes, 30, 240),
    rent2buyOffsetMinutes: boundedInt(value?.rent2buyOffsetMinutes, defaults.rent2buyOffsetMinutes, 0, 60),
    updatedAt: value?.updatedAt || null,
  };
}

export function londonDateKeyForValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function londonLocalMinutesToUtcIso(dateKey, localMinutes) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) throw new Error("Invalid London schedule date.");
  const minutes = boundedInt(localMinutes, 0, 0, DAY_MINUTES - 1);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(targetUtc);

  for (let index = 0; index < 4; index += 1) {
    const displayed = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    const displayedUtc = Date.UTC(
      Number(displayed.year),
      Number(displayed.month) - 1,
      Number(displayed.day),
      Number(displayed.hour),
      Number(displayed.minute),
      Number(displayed.second),
    );
    guess = new Date(guess.getTime() - (displayedUtc - targetUtc));
  }
  return guess.toISOString();
}

function countsForProduct(config, productKey) {
  const safe = normalizeBufferAutomationConfig(config);
  if (productKey === "rent2buy") {
    return { image: safe.rent2buyPostsPerDay, video: safe.rent2buyReelsPerDay };
  }
  return { image: safe.vanFinancePostsPerDay, video: safe.vanFinanceReelsPerDay };
}

export function bufferAutomationSlots(config, productKey, dateKey) {
  const safe = normalizeBufferAutomationConfig(config);
  const counts = countsForProduct(safe, productKey);
  const remaining = { ...counts };
  const slots = [];
  const offset = productKey === "rent2buy" ? safe.rent2buyOffsetMinutes : 0;
  let localMinutes = safe.firstPostLocalMinutes + offset;
  let nextKind = "image";

  while ((remaining.image > 0 || remaining.video > 0) && localMinutes < DAY_MINUTES) {
    let mediaKind = nextKind;
    if (remaining[mediaKind] <= 0) mediaKind = mediaKind === "image" ? "video" : "image";
    if (remaining[mediaKind] <= 0) break;

    const dueAt = londonLocalMinutesToUtcIso(dateKey, localMinutes);
    slots.push({
      index: slots.length,
      productKey,
      mediaKind,
      localMinutes,
      localTime: `${String(Math.floor(localMinutes / 60)).padStart(2, "0")}:${String(localMinutes % 60).padStart(2, "0")}`,
      dueAt,
      key: `${productKey}:${dateKey}:${slots.length}:${mediaKind}`,
    });
    remaining[mediaKind] -= 1;
    nextKind = mediaKind === "image" ? "video" : "image";
    localMinutes += safe.slotGapMinutes;
  }
  return slots;
}

export function bufferPostMediaKind(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  return assets.some((asset) => /^video\//i.test(String(asset?.mimeType || ""))) ? "video" : "image";
}

export function extractBufferRegistration(value) {
  const text = String(value || "").toUpperCase();
  const labelled = text.match(/REGISTRATION\s*:\s*([A-Z0-9 ]{5,10})/i)?.[1] || "";
  const candidate = labelled || text;
  const match = candidate.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return String(match?.[1] || "").replace(/[^A-Z0-9]/g, "");
}

export function bufferPostDateKey(post) {
  const value = post?.dueAt || post?.sentAt || post?.createdAt;
  return value ? londonDateKeyForValue(value) : "";
}

export function isBufferPostReserved(post) {
  return ["draft", "scheduled", "sending"].includes(String(post?.status || "").toLowerCase());
}

export function chooseOldestFacebookCandidate({ vehicles = [], historyRows = [], reservedRegistrations = [] } = {}) {
  const reserved = new Set((reservedRegistrations || [])
    .map((value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean));
  const latestByRegistration = new Map();

  for (const row of historyRows || []) {
    const registration = String(row?.metadata?.registration || row?.metadata?.reg || row?.registration || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!registration) continue;
    const timestamp = new Date(row?.occurred_at || row?.occurredAt || row?.sentAt || row?.activity_date || 0).getTime();
    if (!timestamp) continue;
    if (timestamp > (latestByRegistration.get(registration) || 0)) latestByRegistration.set(registration, timestamp);
  }

  return [...(vehicles || [])]
    .filter((vehicle) => {
      const registration = String(vehicle?.registration || vehicle?.reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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
