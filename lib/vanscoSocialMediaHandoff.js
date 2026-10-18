import { createHash } from "node:crypto";
import { head, put, list } from "@vercel/blob";

// Keep Vansco campaign media separate from the existing VFC/Rent2Buy
// buffer-social-images namespace. Never load another brand's vehicle stock.
export const VANSCO_BLOB_PREFIX = "vansco-buffer-images/v1";
export const VANSCO_OWNED_BLOB_PREFIX = "vansco-buffer-images/v2";
export const VANSCO_LEASE_PREFIX = "vansco-buffer-leases/v1";
const MAX_IMAGE_BYTES = 8_000_000;
const MAX_IMAGES = 3;
// Hard cap on new Vansco images. No automatic deletion of referenced posts.
const MAX_STORED_BYTES = 2_000_000_000;
const MAX_STORED_FILES = 4_000;
const ALLOWED_MEDIA_HOSTS = new Set(["acdn.uk"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png"]);

export function vanscoVehicleMediaToken(vehicleId) {
  const id = String(vehicleId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,96}$/.test(id)) {
    throw new Error("Vansco DealerKit vehicle ID is required for owned media storage.");
  }
  return createHash("sha256").update(id).digest("hex");
}

function scheduledDay(dueAt) {
  const date = new Date(dueAt || "");
  if (!Number.isFinite(date.getTime())) throw new Error("Vansco image lease needs a valid Buffer schedule date.");
  // Never allow absurdly distant dates or unbounded retention markers.
  if (date.getTime() > Date.now() + 366 * 86400000) throw new Error("Vansco Buffer date exceeds safe image retention horizon.");
  return date.toISOString().slice(0,10).replaceAll("-", "");
}

async function recordImageLease({ vehicleToken, dueAt, leasePutImpl }) {
  const day = scheduledDay(dueAt);
  const pathname = VANSCO_LEASE_PREFIX + "/" + vehicleToken + "/" + day + ".json";
  // One monotonic calendar-day lease per vehicle. Concurrent posts scheduled
  // on the same date cannot shorten the protection.
  await leasePutImpl(pathname, JSON.stringify({ date:day }), {
    access: "public", contentType: "application/json",
    addRandomSuffix: false, allowOverwrite: true,
  });
  return pathname;
}


function checkedSourceUrl(value) {
  let u;
  try { u = new URL(String(value || "").trim()); }
  catch { throw new Error("Vansco image source URL is invalid."); }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !ALLOWED_MEDIA_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error("Vansco image URL must use an approved public image host.");
  }
  if (u.hostname.toLowerCase() === "acdn.uk" && !u.pathname.startsWith("/vansco/i/")) {
    throw new Error("Only the Vansco DealerKit image folder is permitted.");
  }
  // Do not ingest Van Finance Company or Rent2Buy's generic Wix images.
  // Vansco's current DealerKit Meta catalogue serves its own /vansco/i path.
  // Unknown future CDN sources must be reviewed rather than silently allowed.
  if (!/\.(?:jpe?g|png)$/i.test(u.pathname)) {
    throw new Error("Vansco Buffer image requires a JPEG or PNG URL.");
  }
  return u.href;
}

function imageMime(value) {
  return String(value || "").toLowerCase().split(";")[0].trim();
}

function completeImageBytes(bytes, mime) {
  if (mime === "image/jpeg") {
    return bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (mime === "image/png") {
    return bytes.length >= 20 && bytes[0] === 0x89 && bytes[1] === 0x50
      && bytes[2] === 0x4e && bytes[3] === 0x47
      && Buffer.from(bytes.subarray(bytes.length - 8, bytes.length - 4)).toString("ascii") === "IEND";
  }
  return false;
}

async function boundedImageBody(response, maxBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Vansco image exceeds 8 MB.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new Error("Vansco image exceeds 8 MB.");
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function readSource(url, { fetchImpl, maxBytes }) {
  const sourceUrl = checkedSourceUrl(url);
  let response;
  try {
    response = await fetchImpl(sourceUrl, {
      method: "GET", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "image/jpeg,image/png" },
    });
  } catch { throw new Error("Could not download Vansco source photograph completely."); }
  if (!response?.ok) throw new Error("Vansco photograph returned HTTP " + (response?.status || "unknown") + ".");
  if (response.url && response.url !== sourceUrl) {
    throw new Error("Vansco image unexpectedly redirected; no image was stored.");
  }
  const mime = imageMime(response.headers?.get?.("content-type"));
  if (!ALLOWED_MIME.has(mime)) throw new Error("Vansco photograph is not a JPEG or PNG.");
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Vansco image exceeds 8 MB.");
  let bytes;
  try { bytes = await boundedImageBody(response, maxBytes); }
  catch (error) { throw new Error("Vansco photograph download failed: " + error.message); }
  if (!completeImageBytes(bytes, mime)) throw new Error("Vansco photograph is incomplete or has invalid image bytes.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  return { sourceUrl, bytes, mime, sha256, ext };
}

async function existingBlob(pathname, mime, { headImpl }) {
  try {
    const found = await headImpl(pathname);
    if (!found?.url || found?.pathname !== pathname || imageMime(found.contentType) !== mime) {
      throw new Error("Existing Vansco image object has unexpected metadata.");
    }
    return found.url;
  } catch (error) {
    if (error?.name === "BlobNotFoundError" || error?.code === "blob_not_found") return "";
    throw error;
  }
}

// Scope every inventory call to Vansco only and fail closed if pagination
// cannot be verified. Previously uploaded images remain reusable at the cap.
export async function loadVanscoImageStorageUsage(listImpl = list) {
  let cursor;
  let count = 0, size = 0;
  for (;;) {
    const result = await listImpl({ prefix: "vansco-buffer-images/", limit: 1000, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.blobs) || typeof result?.hasMore !== "boolean") {
      throw new Error("Vansco Blob storage usage is unavailable; refusing new uploads.");
    }
    for (const blob of result.blobs) {
      if (!String(blob?.pathname || "").startsWith("vansco-buffer-images/")
        || !Number.isSafeInteger(blob?.size) || blob.size < 0) {
        throw new Error("Vansco Blob inventory is incomplete or contains an unrelated file.");
      }
      count += 1;
      size += blob.size;
    }
    if (count >= MAX_STORED_FILES && result.hasMore) throw new Error("Vansco image storage file limit reached.");
    if (!result.hasMore) break;
    if (!result.cursor || result.cursor === cursor) throw new Error("Vansco Blob inventory pagination is incomplete.");
    cursor = result.cursor;
  }
  return {count, bytes:size};
}

async function ensureHostedImage(image, { headImpl, putImpl, budget }) {
  let url = await existingBlob(image.pathname, image.mime, { headImpl });
  if (!url) {
    await budget(image.bytes.length);
    try {
      const stored = await putImpl(image.pathname, image.bytes, {
        access: "public", contentType: image.mime,
        addRandomSuffix: false, allowOverwrite: false,
        cacheControlMaxAge: 30 * 24 * 60 * 60,
      });
      url = stored?.url || "";
    } catch (error) {
      if (error?.name !== "BlobAlreadyExistsError") throw error;
      url = await existingBlob(image.pathname, image.mime, { headImpl });
    }
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".public.blob.vercel-storage.com")
    || parsed.pathname !== "/" + image.pathname) {
    throw new Error("Vansco hosted image URL did not match its dedicated public storage path.");
  }
  return url;
}

// Called only after the Vansco Meta catalogue selects an exact vehicle.
// Full source files are checked first; no Buffer call occurs if any image fails.
// Identical content maps to the same immutable path across Vansco channels.
export async function prepareVanscoBufferImages(imageUrls, {
  fetchImpl = fetch, headImpl = head, putImpl = put, listImpl = list,
  leasePutImpl = put, vehicleId, dueAt, maxBytes = MAX_IMAGE_BYTES,
} = {}) {
  if (!Array.isArray(imageUrls) || !imageUrls.length || imageUrls.length > MAX_IMAGES) {
    throw new Error("Vansco image handoff requires one to three photographs.");
  }
  const vehicleToken = vanscoVehicleMediaToken(vehicleId);
  scheduledDay(dueAt);
  const cleanUrls = [...new Set(imageUrls.map(checkedSourceUrl))];
  const checked = await Promise.all(cleanUrls.map(url => readSource(url, { fetchImpl, maxBytes })));
  const urls = [];
  const uniqueHashes = new Map();
  let usage;
  const budget = async bytes => {
    if (!usage) usage = await loadVanscoImageStorageUsage(listImpl);
    if (usage.count + 1 > MAX_STORED_FILES || usage.bytes + bytes > MAX_STORED_BYTES) {
      throw new Error("Vansco image storage cap reached. New images held for review without affecting other brands.");
    }
    usage.count += 1;
    usage.bytes += bytes;
  };
  for (const photo of checked) {
    photo.pathname = VANSCO_OWNED_BLOB_PREFIX + "/" + vehicleToken + "/" + photo.sha256 + "." + photo.ext;
    if (!uniqueHashes.has(photo.sha256)) {
      uniqueHashes.set(photo.sha256, await ensureHostedImage(photo, { headImpl, putImpl, budget }));
    }
    urls.push(uniqueHashes.get(photo.sha256));
  }
  // Must succeed before Buffer is contacted; a failed lease blocks posting.
  await recordImageLease({ vehicleToken, dueAt, leasePutImpl });
  return [...new Set(urls)];
}
