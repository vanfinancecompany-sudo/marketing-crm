export const YOUTUBE_MAX_IMAGES = 15;
export const YOUTUBE_DEFAULT_IMAGE_COUNT = 10;
export const YOUTUBE_CMS_UPLOAD_STORAGE_KEY = "youtubeGeneratorCmsUploads";
const YOUTUBE_CMS_DB_NAME = "youtubeGeneratorCmsUploadsDb";
const YOUTUBE_CMS_DB_VERSION = 1;
const YOUTUBE_CMS_STORE_NAME = "uploads";
const REEL_LAB_CMS_DB_NAME = "reelLabBetaCmsUploads";
const REEL_LAB_CMS_STORE_NAME = "cmsUploads";
const DEFAULT_UPLOADS = { vanFinance: null, rent2buy: null };

function cleanText(value) {
  return String(value || "")
    .replace(/\u00c2\u00a3/g, "\u00a3")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeYouTubeRegistration(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function vehicleRegistration(vehicle) {
  return normalizeYouTubeRegistration(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name || "");
}

function vehicleTitle(vehicle) {
  return cleanText(vehicle?.vanDescription || vehicle?.description || vehicle?.name || vehicle?.title || vehicleRegistration(vehicle) || "");
}

function vehicleImage(vehicle) {
  return cleanText(vehicle?.image || vehicle?.picture || vehicle?.mainImage || vehicle?.imageUrl || vehicle?.image_url || "");
}

function imageDedupeKey(value) {
  const text = String(value || "").trim();
  const staticMatch = text.match(/static\.wixstatic\.com\/media\/([^/?#]+)/i);
  if (staticMatch) return `wix:${staticMatch[1].toLowerCase()}`;
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

export function buildOrderedImageRecords(records, limit = YOUTUBE_MAX_IMAGES) {
  const ordered = [];
  const seen = new Set();
  let dedupeHappened = false;

  (records || []).forEach((record) => {
    const url = cleanText(record?.url || record);
    if (!url) return;
    const key = imageDedupeKey(url);
    if (seen.has(key)) {
      dedupeHappened = true;
      return;
    }
    seen.add(key);
    ordered.push({ url, source: cleanText(record?.source || "image") });
  });

  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : YOUTUBE_MAX_IMAGES;
  return {
    records: ordered.slice(0, Math.min(YOUTUBE_MAX_IMAGES, safeLimit)),
    totalAvailable: ordered.length,
    source: ordered[0]?.source || "none",
    dedupeHappened,
  };
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeCmsKey(key) {
  return cleanText(key).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeCmsImageUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  const wixMatch = text.match(/^(?:wix:)?image:\/\/v1\/([^/#?]+)/i);
  if (wixMatch) return `https://static.wixstatic.com/media/${wixMatch[1]}`;
  if (/^\/\/static\.wixstatic\.com\//i.test(text)) return `https:${text}`;
  return text;
}

function isLikelyImageUrl(value) {
  const text = cleanText(value);
  return /static\.wixstatic\.com\/media\//i.test(text)
    || /^wix:image:\/\//i.test(text)
    || /^image:\/\//i.test(text)
    || /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(text);
}

function extractImageUrlsFromValue(value) {
  const urls = [];
  const addUrl = (candidate) => {
    const text = normalizeCmsImageUrl(candidate);
    if (!text) return;
    const matches = text.match(/https?:\/\/[^\s"'<>|;,]+/gi);
    if (matches) {
      matches.map(normalizeCmsImageUrl).filter(isLikelyImageUrl).forEach((url) => urls.push(url));
      return;
    }
    if (/^wix:image:\/\//i.test(text) || /^image:\/\//i.test(text) || /static\.wixstatic\.com\/media\//i.test(text)) {
      urls.push(text);
    }
  };

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "object" && item) addUrl(item.url || item.src || item.fileUrl || item.image || item.uri);
      else addUrl(item);
    });
    return urls;
  }

  if (typeof value === "object" && value) {
    addUrl(value.url || value.src || value.fileUrl || value.image || value.uri);
    Object.values(value).forEach((nestedValue) => {
      if (typeof nestedValue === "string") addUrl(nestedValue);
    });
    return urls;
  }

  const stringValue = String(value || "").trim();
  if (!stringValue) return urls;

  try {
    const parsed = JSON.parse(stringValue);
    extractImageUrlsFromValue(parsed).forEach((url) => urls.push(url));
    return urls;
  } catch {}

  const wixMatches = stringValue.match(/(?:wix:)?image:\/\/v1\/[^"'<>|\s,]+/gi);
  if (wixMatches) {
    wixMatches.map(normalizeCmsImageUrl).forEach((url) => urls.push(url));
    return urls;
  }

  stringValue.split(/\s*[|;]\s*/).forEach((item) => addUrl(item));
  return urls;
}

function getCmsField(source, keyPatterns) {
  const entry = Object.entries(source || {}).find(([key]) => {
    const normalKey = normalizeCmsKey(key);
    return keyPatterns.some((pattern) => pattern.test(normalKey));
  });
  return entry ? entry[1] : "";
}

function extractRegistrationFromText(value) {
  const text = cleanText(value).toUpperCase();
  const explicitMatch = text.match(/(?:REG(?:ISTRATION)?|VRM|NUMBER\s*PLATE|PLATE)\s*[:#-]?\s*([A-Z]{2}\s?\d{2}\s?[A-Z]{3})/i);
  if (explicitMatch) return explicitMatch[1].replace(/\s+/g, "");
  const looseMatch = text.match(/\b[A-Z]{2}\s?\d{2}\s?[A-Z]{3}\b/);
  return looseMatch ? looseMatch[0].replace(/\s+/g, "") : "";
}

function normalizeCmsRow(row, index = 0) {
  const source = row || {};
  const explicitReg = getCmsField(source, [/^reg$/, /^registration/, /vrm/, /numberplate/, /licenceplate/, /licenseplate/]);
  const rowText = Object.values(source).map((value) => (typeof value === "string" ? value : JSON.stringify(value || ""))).join(" ");
  const registration = normalizeYouTubeRegistration(explicitReg) || extractRegistrationFromText(rowText);
  const title = cleanText(getCmsField(source, [/^title$/, /^name$/, /vehicletitle/, /^vehicle$/, /description/, /vandescription/, /makemodel/]));
  const imageValues = [];
  const imageKeys = Object.keys(source).filter((key) => {
    const normalKey = normalizeCmsKey(key);
    return /(image|images|picture|photo|gallery|mainimage|media|thumbnail|src|url)$/.test(normalKey)
      || /(image|picture|photo|gallery|media)/.test(normalKey);
  });

  imageKeys.forEach((key) => {
    extractImageUrlsFromValue(source[key]).forEach((url) => imageValues.push(url));
  });

  if (!imageValues.length) {
    Object.values(source).forEach((value) => {
      extractImageUrlsFromValue(value).forEach((url) => imageValues.push(url));
    });
  }

  return {
    id: `cms-${index}`,
    registration,
    title,
    imageRecords: buildOrderedImageRecords(imageValues.map((url, imageIndex) => ({ url, source: `CMS upload image ${imageIndex + 1}` }))).records,
  };
}

export function parseYoutubeCmsUploadText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.rows) ? parsed.rows : [];
    return rows.map(normalizeCmsRow).filter((row) => row.registration || row.title || row.imageRecords.length);
  } catch {}

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, "").trim());
  return lines.slice(1)
    .map((line) => {
      const values = splitCsvLine(line);
      return headers.reduce((row, header, index) => ({ ...row, [header || `column_${index}`]: values[index] || "" }), {});
    })
    .map(normalizeCmsRow)
    .filter((row) => row.registration || row.title || row.imageRecords.length);
}

export function findYoutubeCmsMatch(rows, vehicle) {
  const registration = vehicleRegistration(vehicle);
  if (registration) {
    const regMatch = (rows || []).find((row) => row.registration && row.registration === registration);
    if (regMatch) return regMatch;
  }

  const title = vehicleTitle(vehicle).toLowerCase();
  if (!title) return null;
  return (rows || []).find((row) => {
    const rowTitle = cleanText(row.title).toLowerCase();
    return rowTitle && (rowTitle.includes(title) || title.includes(rowTitle));
  }) || null;
}

export function getYoutubeVehicleStockImageRecords(vehicle) {
  const imageValues = [];
  const addValue = (value) => {
    extractImageUrlsFromValue(value).forEach((url) => imageValues.push(url));
  };

  [
    vehicle?.image,
    vehicle?.picture,
    vehicle?.mainImage,
    vehicle?.imageUrl,
    vehicle?.image_url,
    vehicle?.thumbnail,
    vehicle?.mediaGallery,
    vehicle?.mainImages,
    vehicle?.gallery,
    vehicle?.images,
    vehicle?.imageUrls,
    vehicle?.pictures,
  ].forEach(addValue);

  Object.entries(vehicle || {}).forEach(([key, value]) => {
    const normalKey = normalizeCmsKey(key);
    if (/^image\d+$/.test(normalKey) || /^picture\d+$/.test(normalKey) || /^photo\d+$/.test(normalKey)) {
      addValue(value);
    }
  });

  return buildOrderedImageRecords(imageValues.map((url, index) => ({ url, source: `stock image ${index + 1}` })), YOUTUBE_MAX_IMAGES).records;
}

export function resolveYouTubeImageOrder({ vehicle, cmsUpload, imageSource = "auto", imageCount = YOUTUBE_DEFAULT_IMAGE_COUNT }) {
  const cmsMatch = vehicle ? findYoutubeCmsMatch(cmsUpload?.rows || [], vehicle) : null;
  const cmsRecords = Array.isArray(cmsMatch?.imageRecords) ? cmsMatch.imageRecords : [];
  const stockRecords = getYoutubeVehicleStockImageRecords(vehicle);
  const stockRecord = vehicleImage(vehicle) ? [{ url: vehicleImage(vehicle), source: "stock image only" }] : [];

  if (imageSource === "cms") {
    const sourceRecords = cmsRecords.length ? cmsRecords : stockRecords;
    return { ...buildOrderedImageRecords(sourceRecords, imageCount), cmsMatch, sourceLabel: cmsRecords.length ? "CMS upload" : stockRecords.length ? "stock CMS fields" : "no images found" };
  }
  if (imageSource === "stock") {
    const sourceRecords = stockRecords.length ? stockRecords : stockRecord;
    return { ...buildOrderedImageRecords(sourceRecords, imageCount), cmsMatch, sourceLabel: stockRecords.length ? "stock CMS fields" : stockRecord.length ? "stock image only" : "no images found" };
  }

  if (cmsRecords.length) return { ...buildOrderedImageRecords(cmsRecords, imageCount), cmsMatch, sourceLabel: "CMS upload" };
  if (stockRecords.length) return { ...buildOrderedImageRecords(stockRecords, imageCount), cmsMatch, sourceLabel: "stock CMS fields" };
  return { ...buildOrderedImageRecords(stockRecord, imageCount), cmsMatch, sourceLabel: stockRecord.length ? "stock image only" : "no images found" };
}

export function loadYouTubeCmsUploads() {
  if (typeof window === "undefined") return { ...DEFAULT_UPLOADS };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(YOUTUBE_CMS_UPLOAD_STORAGE_KEY) || "{}");
    return {
      vanFinance: parsed.vanFinance || null,
      rent2buy: parsed.rent2buy || null,
    };
  } catch {
    return { ...DEFAULT_UPLOADS };
  }
}

function openYoutubeCmsDb() {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(YOUTUBE_CMS_DB_NAME, YOUTUBE_CMS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(YOUTUBE_CMS_STORE_NAME)) {
        db.createObjectStore(YOUTUBE_CMS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function openExistingIndexedDb(dbName) {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readYoutubeCmsDbUploads() {
  const db = await openYoutubeCmsDb();
  if (!db) return { ...DEFAULT_UPLOADS };
  return new Promise((resolve) => {
    const transaction = db.transaction(YOUTUBE_CMS_STORE_NAME, "readonly");
    const store = transaction.objectStore(YOUTUBE_CMS_STORE_NAME);
    const request = store.get("uploads");
    request.onsuccess = () => {
      const value = request.result || {};
      resolve({ vanFinance: value.vanFinance || null, rent2buy: value.rent2buy || null });
    };
    request.onerror = () => resolve({ ...DEFAULT_UPLOADS });
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
    transaction.onabort = () => db.close();
  });
}

async function readReelLabCmsUpload(productKey) {
  const db = await openExistingIndexedDb(REEL_LAB_CMS_DB_NAME);
  if (!db || !db.objectStoreNames.contains(REEL_LAB_CMS_STORE_NAME)) {
    if (db) db.close();
    return null;
  }
  return new Promise((resolve) => {
    const transaction = db.transaction(REEL_LAB_CMS_STORE_NAME, "readonly");
    const store = transaction.objectStore(REEL_LAB_CMS_STORE_NAME);
    const request = store.get(productKey);
    request.onsuccess = () => resolve(request.result?.upload || null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
    transaction.onabort = () => db.close();
  });
}

async function readReelLabCmsUploads() {
  const [vanFinance, rent2buy] = await Promise.all([
    readReelLabCmsUpload("vanFinance"),
    readReelLabCmsUpload("rent2buy"),
  ]);
  return { vanFinance, rent2buy };
}

async function writeYoutubeCmsDbUploads(uploads) {
  const db = await openYoutubeCmsDb();
  if (!db) return;
  await new Promise((resolve) => {
    const transaction = db.transaction(YOUTUBE_CMS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(YOUTUBE_CMS_STORE_NAME);
    store.put(uploads || { ...DEFAULT_UPLOADS }, "uploads");
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      resolve();
    };
  });
}

export async function loadYouTubeCmsUploadsAsync() {
  const localUploads = loadYouTubeCmsUploads();
  const dbUploads = await readYoutubeCmsDbUploads();
  const reelLabUploads = await readReelLabCmsUploads();
  return {
    vanFinance: dbUploads.vanFinance || localUploads.vanFinance || reelLabUploads.vanFinance || null,
    rent2buy: dbUploads.rent2buy || localUploads.rent2buy || reelLabUploads.rent2buy || null,
  };
}

export async function saveYouTubeCmsUpload(productKey, upload) {
  if (typeof window === "undefined") return;
  const queueKey = productKey === "rent2buy" ? "rent2buy" : "vanFinance";
  const dbCurrent = await readYoutubeCmsDbUploads();
  const dbNext = { ...dbCurrent, [queueKey]: upload || null };
  await writeYoutubeCmsDbUploads(dbNext);
  try {
    window.localStorage.setItem(YOUTUBE_CMS_UPLOAD_STORAGE_KEY, JSON.stringify(dbNext));
  } catch {
    // Large Wix exports can exceed localStorage; IndexedDB and App state keep this upload available.
  }
}
