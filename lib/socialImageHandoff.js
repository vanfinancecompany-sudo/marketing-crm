import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { put } from "@vercel/blob";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const CONTROLLED_PREFIX = "buffer-social-images";
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
]);

function clean(value, limit = 5000) {
  return String(value ?? "").trim().slice(0, limit);
}

function isPrivateIp(hostname) {
  const version = isIP(hostname);
  if (version === 4) {
    const parts = hostname.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  if (version === 6) {
    const value = hostname.toLowerCase();
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
  }
  return false;
}

export function assertPublicHttpsImageUrl(value, label = "Social image") {
  const raw = clean(value, 8000);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isPrivateIp(hostname)) {
    throw new Error(`${label} URL is not publicly routable.`);
  }
  if (parsed.username || parsed.password) throw new Error(`${label} URL must not contain credentials.`);
  return parsed.toString();
}

function normalizedContentType(value) {
  return clean(value, 200).toLowerCase().split(";")[0].trim();
}

function bytesMatchType(bytes, contentType) {
  const b = bytes;
  if (contentType === "image/jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === "image/png") return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  if (contentType === "image/gif") return b.length >= 6 && Buffer.from(b.subarray(0, 6)).toString("ascii").startsWith("GIF8");
  if (contentType === "image/webp") return b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WEBP";
  if (contentType === "image/avif") return b.length >= 12 && Buffer.from(b.subarray(4, 12)).toString("ascii").includes("ftypavif");
  return false;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "follow", cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadVerifiedImage({ sourceUrl, fetchImpl, maxBytes, timeoutMs }) {
  const requestedUrl = assertPublicHttpsImageUrl(sourceUrl);
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, requestedUrl, { method: "GET", headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }, timeoutMs);
  } catch (error) {
    throw new Error(`Social image preflight could not fetch the source: ${clean(error?.message || error, 400)}`);
  }
  if (!response?.ok) throw new Error(`Social image preflight returned HTTP ${response?.status || "unknown"}.`);
  assertPublicHttpsImageUrl(response.url || requestedUrl, "Resolved social image");
  const contentType = normalizedContentType(response.headers?.get?.("content-type"));
  if (!ALLOWED_TYPES.has(contentType)) throw new Error(`Social image preflight rejected content type ${contentType || "missing"}.`);
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Social image is too large (${declared} bytes; maximum ${maxBytes}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Social image preflight returned an empty file.");
  if (buffer.length > maxBytes) throw new Error(`Social image is too large (${buffer.length} bytes; maximum ${maxBytes}).`);
  if (!bytesMatchType(buffer, contentType)) throw new Error(`Social image bytes do not match ${contentType}.`);
  return { requestedUrl, resolvedUrl: response.url || requestedUrl, contentType, buffer };
}

async function preflightControlledUrl({ url, fetchImpl, contentType, timeoutMs }) {
  const controlledUrl = assertPublicHttpsImageUrl(url, "Controlled social image");
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, controlledUrl, { method: "GET", headers: { Range: "bytes=0-31", Accept: contentType } }, timeoutMs);
  } catch (error) {
    throw new Error(`Controlled social image preflight failed: ${clean(error?.message || error, 400)}`);
  }
  if (!response?.ok && response?.status !== 206) throw new Error(`Controlled social image preflight returned HTTP ${response?.status || "unknown"}.`);
  const returnedType = normalizedContentType(response.headers?.get?.("content-type"));
  if (returnedType && returnedType !== contentType) throw new Error(`Controlled social image changed content type from ${contentType} to ${returnedType}.`);
  return controlledUrl;
}

export async function prepareSocialImageForBuffer({
  sourceUrl,
  fetchImpl = fetch,
  putImpl = put,
  maxBytes = Number(process.env.BUFFER_SOCIAL_IMAGE_MAX_BYTES) || DEFAULT_MAX_BYTES,
  timeoutMs = Number(process.env.BUFFER_SOCIAL_IMAGE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Social image preflight fetch is unavailable.");
  if (typeof putImpl !== "function") throw new Error("Social image handoff storage is unavailable.");
  const source = await downloadVerifiedImage({ sourceUrl, fetchImpl, maxBytes, timeoutMs });
  const digest = createHash("sha256").update(source.buffer).digest("hex");
  const extension = ALLOWED_TYPES.get(source.contentType);
  const pathname = `${CONTROLLED_PREFIX}/${digest}.${extension}`;
  let uploaded;
  try {
    uploaded = await putImpl(pathname, source.buffer, {
      access: "public",
      contentType: source.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
  } catch (error) {
    throw new Error(`Social image handoff upload failed: ${clean(error?.message || error, 400)}`);
  }
  if (!uploaded?.url) throw new Error("Social image handoff did not return a public URL.");
  const url = await preflightControlledUrl({ url: uploaded.url, fetchImpl, contentType: source.contentType, timeoutMs });
  return {
    sourceUrl: source.requestedUrl,
    resolvedSourceUrl: source.resolvedUrl,
    url,
    pathname: clean(uploaded.pathname || pathname, 2000),
    contentType: source.contentType,
    sizeBytes: source.buffer.length,
    sha256: digest,
  };
}

export async function handoffBufferImageVariables(variables, options = {}) {
  const assets = variables?.input?.assets;
  if (!Array.isArray(assets) || !assets.some((asset) => asset?.image?.url)) return variables;
  const clonedAssets = [];
  for (const asset of assets) {
    if (!asset?.image?.url) {
      clonedAssets.push(asset);
      continue;
    }
    const handoff = await prepareSocialImageForBuffer({ sourceUrl: asset.image.url, ...options });
    clonedAssets.push({ ...asset, image: { ...asset.image, url: handoff.url } });
  }
  return {
    ...variables,
    input: {
      ...variables.input,
      assets: clonedAssets,
    },
  };
}
