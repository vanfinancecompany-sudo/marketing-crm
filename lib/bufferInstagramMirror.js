import {
  bufferPostMediaKind,
  extractBufferRegistration,
  isBufferPostReserved,
} from "./bufferAutomation.js";

const INSTAGRAM_MIN_LEAD_MS = 2 * 60 * 1000;
const INSTAGRAM_RECOVERY_LEAD_MS = 5 * 60 * 1000;
const INSTAGRAM_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value ?? "").trim();
}

function postDueAt(post) {
  const value = clean(post?.dueAt);
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : "";
}

function postTimeMs(post) {
  const value = post?.sentAt || post?.dueAt || post?.createdAt;
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildInstagramMirrorCaption(facebookText) {
  const original = clean(facebookText);
  const withoutTrailingUrl = original.replace(/\n\s*https?:\/\/\S+\s*$/i, "").trim();
  if (!withoutTrailingUrl) return "VIEW THIS VAN & APPLY: VANFINANCECOMPANY.CO.UK";
  return `${withoutTrailingUrl}\n\nVIEW THIS VAN & APPLY: VANFINANCECOMPANY.CO.UK`;
}

export function shiftBufferDueAt(value, minutes = 10) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const delay = Math.max(0, Math.min(60, Number.parseInt(minutes, 10) || 0));
  return new Date(timestamp + delay * 60 * 1000).toISOString();
}

function mirrorKey(post, dueAtOverride = "") {
  const registration = extractBufferRegistration(post?.text);
  const mediaKind = bufferPostMediaKind(post);
  const dueAt = dueAtOverride || postDueAt(post);
  if (!registration || !dueAt) return "";
  return `${registration}|${mediaKind}|${dueAt}`;
}

function mediaIdentity(post) {
  const registration = extractBufferRegistration(post?.text);
  const mediaKind = bufferPostMediaKind(post);
  return registration ? `${registration}|${mediaKind}` : "";
}

function mediaUrl(post) {
  const assets = Array.isArray(post?.assets) ? post.assets : [];
  return clean(assets.find((asset) => clean(asset?.source))?.source);
}

export function selectVanFinanceInstagramMirrors({
  facebookPosts = [],
  instagramPosts = [],
  facebookChannelId,
  delayMinutes = 10,
  now = Date.now(),
  queueLimit = 10,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const resolvedNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const queued = (instagramPosts || []).filter(isBufferPostReserved).length;
  const remaining = Math.max(0, Math.max(0, Number.parseInt(queueLimit, 10) || 0) - queued);
  if (!remaining) return [];

  const nonErrorInstagram = (instagramPosts || []).filter(
    (post) => String(post?.status || "").toLowerCase() !== "error",
  );
  const existingKeys = new Set(nonErrorInstagram.map((post) => mirrorKey(post)).filter(Boolean));
  const activeMedia = new Set(nonErrorInstagram
    .filter((post) => {
      const timestamp = postTimeMs(post);
      return timestamp && resolvedNow - timestamp < INSTAGRAM_RECOVERY_WINDOW_MS;
    })
    .map(mediaIdentity)
    .filter(Boolean));
  const failedKeys = new Set((instagramPosts || [])
    .filter((post) => String(post?.status || "").toLowerCase() === "error")
    .map((post) => mirrorKey(post))
    .filter(Boolean));

  return (facebookPosts || [])
    .filter((post) => post?.channelId === facebookChannelId)
    .filter((post) => ["scheduled", "sent"].includes(String(post?.status || "").toLowerCase()))
    .map((post) => {
      const expectedDueAt = shiftBufferDueAt(post?.dueAt, delayMinutes);
      const expectedKey = mirrorKey(post, expectedDueAt);
      const expectedTime = new Date(expectedDueAt || 0).getTime();
      const facebookStatus = String(post?.status || "").toLowerCase();
      const recovery = facebookStatus === "sent"
        && failedKeys.has(expectedKey)
        && Number.isFinite(expectedTime)
        && resolvedNow - expectedTime >= 0
        && resolvedNow - expectedTime < INSTAGRAM_RECOVERY_WINDOW_MS;
      const dueAt = recovery
        ? new Date(resolvedNow + INSTAGRAM_RECOVERY_LEAD_MS).toISOString()
        : expectedDueAt;
      return {
        post,
        key: recovery ? mirrorKey(post, dueAt) : expectedKey,
        expectedKey,
        dueAt,
        mediaUrl: mediaUrl(post),
        mediaKind: bufferPostMediaKind(post),
        registration: extractBufferRegistration(post?.text),
        text: buildInstagramMirrorCaption(post?.text),
        recovery,
        mediaIdentity: mediaIdentity(post),
      };
    })
    .filter((item) => item.key && item.mediaUrl && item.dueAt)
    .filter((item) => item.recovery
      ? !activeMedia.has(item.mediaIdentity)
      : new Date(item.dueAt).getTime() > resolvedNow + INSTAGRAM_MIN_LEAD_MS)
    .filter((item) => item.recovery || !existingKeys.has(item.key))
    .sort((first, second) => new Date(first.dueAt) - new Date(second.dueAt))
    .slice(0, remaining);
}
