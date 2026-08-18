export const DAILY_YOUTUBE_TARGET_PER_PRODUCT = 10;
export const DAILY_YOUTUBE_MIN_IMAGES = 10;
export const DAILY_YOUTUBE_COOLDOWN_HOURS = 48;
export const DAILY_YOUTUBE_TEMPLATE_KEY = "tiktokPunch";
export const DAILY_YOUTUBE_SOURCE = "youtube_daily_batch";

const COOLDOWN_MS = DAILY_YOUTUBE_COOLDOWN_HOURS * 60 * 60 * 1000;

export function normalizeDailyYouTubeRegistration(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function dailyYouTubeProductKey(value) {
  return value === "rent2buy" ? "rent2buy" : "vanFinance";
}

function eventRegistration(row) {
  return normalizeDailyYouTubeRegistration(
    row?.metadata?.registration ||
      row?.metadata?.reg ||
      row?.registration ||
      "",
  );
}

function eventTime(row) {
  const parsed = new Date(row?.occurred_at || row?.occurredAt || row?.generated_at || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildDailyYouTubeHistory(historyRows = []) {
  const latestByRegistration = new Map();

  for (const row of historyRows || []) {
    const registration = eventRegistration(row);
    if (!registration) continue;
    const occurredAt = eventTime(row);
    const previous = latestByRegistration.get(registration) || 0;
    if (occurredAt > previous) latestByRegistration.set(registration, occurredAt);
  }

  return latestByRegistration;
}

export function dailyYouTubeGeneratedTodayCount(historyRows = [], productKey) {
  const product = dailyYouTubeProductKey(productKey);
  return (historyRows || []).filter((row) => {
    const rowProduct = dailyYouTubeProductKey(row?.metadata?.product_key || row?.product_key);
    return rowProduct === product;
  }).length;
}

export function selectDailyYouTubeCandidates({
  candidates = [],
  historyRows = [],
  generatedToday = 0,
  reservedRegistrations = [],
  now = Date.now(),
  target = DAILY_YOUTUBE_TARGET_PER_PRODUCT,
  minImages = DAILY_YOUTUBE_MIN_IMAGES,
} = {}) {
  const history = buildDailyYouTubeHistory(historyRows);
  const reserved = new Set(
    (reservedRegistrations || [])
      .map(normalizeDailyYouTubeRegistration)
      .filter(Boolean),
  );
  const remaining = Math.max(0, Number(target || 0) - Number(generatedToday || 0));
  if (!remaining) return [];

  const eligible = [];
  const seen = new Set();

  for (const candidate of candidates || []) {
    const registration = normalizeDailyYouTubeRegistration(
      candidate?.registration || candidate?.reg || candidate?.title || "",
    );
    if (!registration || seen.has(registration) || reserved.has(registration)) continue;

    const imageCount = Array.isArray(candidate?.images)
      ? candidate.images.length
      : Number(candidate?.imageCount || 0);
    if (imageCount < minImages) continue;

    const lastUsedAt = history.get(registration) || 0;
    if (lastUsedAt && Number(now) - lastUsedAt < COOLDOWN_MS) continue;

    seen.add(registration);
    eligible.push({
      ...candidate,
      registration,
      lastUsedAt,
    });
  }

  eligible.sort((a, b) => {
    if (!a.lastUsedAt && b.lastUsedAt) return -1;
    if (a.lastUsedAt && !b.lastUsedAt) return 1;
    if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt - b.lastUsedAt;
    return a.registration.localeCompare(b.registration);
  });

  return eligible.slice(0, remaining);
}
