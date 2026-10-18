import { extractVanscoVehicleUrl } from "./vanscoFacebookAutomation.js";

// A failed published image must not be scheduled again and again. A quarantine
// expires so vehicles can be reconsidered after the upstream CDN is repaired.
export const VANSCO_BUFFER_MEDIA_FAILURE_MS = 7 * 24 * 60 * 60 * 1000;
export const VANSCO_MEDIA_PREFLIGHT_FAILURE_MS = 24 * 60 * 60 * 1000;
export const VANSCO_MEDIA_PREFLIGHT_MAX_BYTES = 8_000_000;

export function isVanscoMediaUrlFailure(message) {
  return /(?:media|image|photo).{0,65}(?:url|publicly accessible|not accessible|forbidden|expired|unavailable|403|404|not found)|(?:media|image) url.{0,65}publicly accessible/i
    .test(String(message || "").toLowerCase());
}

export function activeVanscoMediaQuarantine(previous, now = Date.now()) {
  const entries = previous && typeof previous === "object" ? previous : {};
  return Object.fromEntries(Object.entries(entries)
    .filter(([url, value]) => /^https:\/\/(?:www\.)?vansco\.co\.uk\//i.test(url)
      && Number.isFinite(new Date(value?.expiresAt || 0).getTime())
      && new Date(value.expiresAt).getTime() > now)
    .slice(0, 500));
}

export function quarantineVanscoVehicle(entries, vehicleUrl, {
  now = Date.now(),
  periodMs = VANSCO_BUFFER_MEDIA_FAILURE_MS,
  reason = "media_url_unavailable",
  postId = "",
} = {}) {
  if (!/^https:\/\/(?:www\.)?vansco\.co\.uk\//i.test(String(vehicleUrl || ""))) return entries;
  return {
    ...entries,
    [vehicleUrl]: {
      expiresAt: new Date(now + periodMs).toISOString(),
      reason,
      postId: String(postId || "").slice(0, 100),
    },
  };
}

export function quarantineFromFailedVanscoFacebookPosts(previous, failedPosts, vehicles, now = Date.now()) {
  const byUrl = new Set((vehicles || []).map((v) => v?.vehicleUrl).filter(Boolean));
  let quarantine = activeVanscoMediaQuarantine(previous, now);
  let detected = 0;
  for (const post of failedPosts || []) {
    if (String(post?.status || "").toLowerCase() !== "error") continue;
    if (!isVanscoMediaUrlFailure(post?.error?.message)) continue;
    // Never quarantine an unrelated manual post merely because it contains a Vansco URL.
    if (!/NOW AVAILABLE AT VANSCO/i.test(String(post?.text || ""))) continue;
    const url = extractVanscoVehicleUrl(post?.text);
    const due = new Date(post?.dueAt || post?.createdAt || 0).getTime();
    if (!byUrl.has(url) || !Number.isFinite(due) || now - due > VANSCO_BUFFER_MEDIA_FAILURE_MS
      || due > now + 24 * 60 * 60 * 1000) continue;
    const earlier = quarantine[url];
    if (earlier?.postId === String(post.id || "")) continue;
    quarantine = quarantineVanscoVehicle(quarantine, url, {
      now,
      postId: post.id,
      reason: "buffer_media_url_unavailable",
    });
    detected++;
  }
  return { quarantine, detected };
}

// Reuse today's existing Buffer status snapshot. Quarantine only an exact,
// eligible registration at the same Vansco branch, on Buffer's specific image
// accessibility error. Never blacklist a vehicle for a general GBP API fault.
export function quarantineFromFailedVanscoGoogleBusinessPosts(previous, failedByBranch, vehicles, now = Date.now()) {
  const byBranchAndRegistration = new Map(
    (vehicles || [])
      .filter((vehicle) => vehicle?.vehicleUrl && vehicle?.branchKey && vehicle?.registration)
      .map((vehicle) => [
        vehicle.branchKey + ":" + String(vehicle.registration).toUpperCase().replace(/[^A-Z0-9]/g, ""),
        vehicle.vehicleUrl,
      ]),
  );
  let quarantine = activeVanscoMediaQuarantine(previous, now);
  let detected = 0;
  for (const branch of ["vansco333", "southamptonAirport", "newForest"]) {
    for (const post of failedByBranch?.[branch] || []) {
      if (!isVanscoMediaUrlFailure(post?.message)) continue;
      const registration = String(post?.stockRegistration || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const url = byBranchAndRegistration.get(branch + ":" + registration);
      const dueAt = new Date(post?.dueAt || 0).getTime();
      if (!registration || !url || !Number.isFinite(dueAt) || now - dueAt > VANSCO_BUFFER_MEDIA_FAILURE_MS
        || dueAt > now + 24 * 60 * 60 * 1000) continue;
      if (quarantine[url]?.postId === String(post.postId || "")) continue;
      quarantine = quarantineVanscoVehicle(quarantine, url, {
        now, postId: post.postId, reason: "buffer_gbp_media_url_unavailable",
      });
      detected += 1;
    }
  }
  return { quarantine, detected };
}

// Probe only the exact vehicle images selected for publication. A one-byte
// Range GET must succeed: some image CDNs accept HEAD but reject GET, which
// Buffer actually needs at publication time.
// Never download the full gallery, follow a cross-host redirect or call Buffer here.
export async function preflightVanscoFacebookImage(url, request = fetch) {
  let parsed;
  try { parsed = new URL(String(url || "").trim()); }
  catch { return { ok: false, reason: "invalid_url" }; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
    || !["acdn.uk", "img.cdn.dragon2000.net", "static.wixstatic.com"].includes(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: "untrusted_image_host" };
  }
  let response;
  try {
    response = await request(parsed.href, {
      method: "GET",
      redirect: "manual",
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(4500),
    });
    // A few hosts ignore Range and return the entire file. Stop the stream
    // without downloading its body once the HTTP response is validated.
    if (response?.body?.cancel) await response.body.cancel().catch(() => {});
  } catch {
    return { ok: false, reason: "image_get_unavailable" };
  }
  if (!response.ok) return { ok: false, reason: "image_http_" + response.status };
  const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (type && !type.startsWith("image/")) return { ok: false, reason: "not_an_image" };
  const range = String(response.headers?.get?.("content-range") || "");
  const rangeSize = range.match(/\/(\d+)\s*$/)?.[1];
  const sizeText = rangeSize || (response.status === 206 ? "" : String(response.headers?.get?.("content-length") || ""));
  const size = Number(sizeText);
  if (sizeText && Number.isFinite(size) && size > VANSCO_MEDIA_PREFLIGHT_MAX_BYTES) {
    return { ok: false, reason: "image_over_8mb" };
  }
  return { ok: true, reason: "public_image" };
}

export async function preflightVanscoFacebookImages(urls, request = fetch) {
  if (!Array.isArray(urls) || !urls.length || urls.length > 3) {
    return { ok: false, reason: "missing_images" };
  }
  const results = await Promise.all(urls.map((url) => preflightVanscoFacebookImage(url, request)));
  const failure = results.find((item) => !item.ok);
  return failure || { ok: true, reason: "all_images_accessible" };
}
