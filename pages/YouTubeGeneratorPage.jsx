import { useEffect, useMemo, useRef, useState } from "react";
import defaultReelAudio from "../assets/default-reel-audio.mp3";
import {
  loadYouTubeCmsUploadsAsync,
  loadYouTubeCmsUploads,
  parseYoutubeCmsUploadText,
  resolveYouTubeImageOrder,
  saveYouTubeCmsUpload,
} from "../utils/youtubeImageResolution.js";

const SHORT_WIDTH = 1080;
const SHORT_HEIGHT = 1920;
const DEFAULT_SHORT_FPS = 24;
const CANVAS_FONT = "'Inter', 'Aptos', 'Segoe UI', Arial, sans-serif";
const IMAGE_COUNT_OPTIONS = [8, 10, 12, 15];
const DURATION_OPTIONS = [20, 25, 30, 35];
const FPS_OPTIONS = [24, 30];
const YOUTUBE_VIDEO_BITRATE = 2000000;
const YOUTUBE_AUDIO_BITRATE = 96000;
const MAX_IMAGES = 15;
const TEXT_DEFAULTS_STORAGE_KEY = "youtubeGeneratorTextDefaults";
const TEXT_MODE_STORAGE_KEY = "youtubeGeneratorTextMode";
const FRAME_TEXT_FIELDS = [
  ["eyebrow", "Eyebrow / Label"],
  ["headline", "Headline"],
  ["support", "Support Line"],
  ["cta", "CTA / Button Text"],
];

const PRODUCTS = {
  vanFinance: {
    label: "Van Finance",
    brand: "Van Finance Company",
    domain: "vanfinancecompany.co.uk",
    accent: "#ef233c",
    header: "VAN FINANCE COMPANY",
    topText: "VAN FINANCE COMPANY",
    hook: "FROM \u00a399 DEPOSIT",
    support: "FREE UK DELIVERY",
    cta: "APPLY ONLINE TODAY",
    messages: ["FREE UK DELIVERY", "FINANCE THE VAT", "APPROVED IN 60 MINUTES", "APPLY ONLINE TODAY", "200+ VANS AVAILABLE"],
  },
  rent2buy: {
    label: "Rent2Buy",
    brand: "Rent2Buy Vans",
    domain: "rent2buyvans.co.uk",
    accent: "#ef233c",
    header: "RENT2BUY VANS",
    topText: "NO CREDIT CHECK VANS",
    hook: "NO CREDIT CHECK VANS",
    support: "RENT IT - DRIVE IT - OWN IT",
    cta: "CHECK IF YOU QUALIFY",
    messages: ["NO CREDIT CHECK VANS", "RENT IT - DRIVE IT - OWN IT", "APPLY IN 60 SECONDS", "FINAL PAYMENT IT'S YOURS", "CHECK IF YOU QUALIFY"],
  },
};

const IMAGE_SOURCE_OPTIONS = [
  ["auto", "Auto: CMS > Stock image"],
  ["cms", "CMS/Wix CSV images"],
  ["stock", "Stock image fallback"],
];

const VISUAL_TEMPLATES = [
  ["blackPremium", "Black Premium Showcase"],
  ["tiktokPunch", "TikTok Punch Showcase"],
  ["luxuryDealer", "Luxury Dealer Showcase"],
];

const TEMPLATE_CONFIG = {
  blackPremium: {
    label: "Black Premium Showcase",
    imageArea: { x: 58, y: 292, width: 964, height: 960 },
    headerY: 74,
    textY: 1314,
    headline: 80,
    body: 42,
    transition: 0.38,
    zoom: 0.026,
    glow: 0.18,
  },
  tiktokPunch: {
    label: "TikTok Punch Showcase",
    imageArea: { x: 48, y: 280, width: 984, height: 982 },
    headerY: 66,
    textY: 1306,
    headline: 90,
    body: 46,
    transition: 0.28,
    zoom: 0.034,
    glow: 0.3,
  },
  luxuryDealer: {
    label: "Luxury Dealer Showcase",
    imageArea: { x: 78, y: 314, width: 924, height: 908 },
    headerY: 84,
    textY: 1306,
    headline: 70,
    body: 38,
    transition: 0.5,
    zoom: 0.018,
    glow: 0.11,
  },
};

function cleanText(value) {
  return String(value || "")
    .replace(/\u00c2\u00a3/g, "\u00a3")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFilePart(value) {
  return cleanText(value)
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "youtube-short";
}

function normalizeRegistration(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function vehicleRegistration(vehicle) {
  return normalizeRegistration(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name || "");
}

function displayRegistration(vehicle) {
  const normalized = vehicleRegistration(vehicle);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(normalized)) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
  }
  return normalized;
}

function vehicleTitle(vehicle) {
  return cleanText(vehicle?.vanDescription || vehicle?.description || vehicle?.name || vehicle?.title || vehicleRegistration(vehicle) || "Selected vehicle");
}

function vehicleImage(vehicle) {
  return cleanText(vehicle?.image || vehicle?.picture || vehicle?.mainImage || vehicle?.imageUrl || vehicle?.image_url || "");
}

function vehiclePriceLine(vehicle, productKey) {
  if (productKey === "rent2buy") {
    return cleanText(vehicle?.monthly || vehicle?.week || vehicle?.initialRental || "Flexible Rent2Buy options");
  }
  return cleanText(vehicle?.monthly || vehicle?.salePrice || vehicle?.price || "Finance options available");
}

function vehicleMonthlyPriceLine(vehicle) {
  return cleanText(vehicle?.monthly || vehicle?.financeMonthly || vehicle?.monthlyPayment || vehicle?.monthly_price || vehicle?.salePrice || "");
}

function headlinePriceText(value) {
  return cleanText(value).replace(/^from\s+/i, "").trim();
}

function vanFinanceMonthlyHeadline(vehicle) {
  const monthly = headlinePriceText(vehicleMonthlyPriceLine(vehicle));
  return monthly ? `BUY THIS VAN FROM ONLY ${monthly}` : "BUY THIS VAN WITH FLEXIBLE FINANCE";
}

function rent2buyPriceHeadline(vehicle) {
  const price = headlinePriceText(vehiclePriceLine(vehicle, "rent2buy"));
  return price && price !== "Flexible Rent2Buy options" ? `RENT THIS VEHICLE FROM ${price}` : "RENT THIS VEHICLE WITH FLEXIBLE OPTIONS";
}

function isLockedSystemFrame(frameIndex) {
  return frameIndex === 1 || frameIndex === 2;
}

function resolveFrameTemplateText(value, { productKey, vehicle }) {
  const text = cleanText(value);
  if (!text) return "";
  if (productKey === "rent2buy") {
    return text
      .replace(/\{price\}/gi, headlinePriceText(vehiclePriceLine(vehicle, "rent2buy")) || "")
      .replace(/\{monthly price\}/gi, headlinePriceText(vehiclePriceLine(vehicle, "rent2buy")) || "")
      .replace(/\{registration\}/gi, displayRegistration(vehicle) || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (productKey !== "vanFinance") return text;
  return text
    .replace(/\{monthly price\}/gi, headlinePriceText(vehicleMonthlyPriceLine(vehicle)) || "")
    .replace(/\{monthly\}/gi, headlinePriceText(vehicleMonthlyPriceLine(vehicle)) || "")
    .replace(/\{registration\}/gi, displayRegistration(vehicle) || "")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultFrameText(productKey, index) {
  if (productKey === "rent2buy") {
    const frames = [
      { eyebrow: "RENT2BUY VANS", headline: "NO CREDIT CHECK VANS", support: "RENT IT - DRIVE IT - OWN IT", cta: "CHECK IF YOU QUALIFY" },
      { eyebrow: "SELECTED VAN", headline: "YOUR NEXT VAN", support: "FLEXIBLE RENT2BUY OPTIONS", cta: "" },
      { eyebrow: "RENT2BUY PAYMENT", headline: "RENT THIS VEHICLE FROM {price}", support: "{registration}", cta: "" },
      { eyebrow: "FAST APPLICATION", headline: "APPLY IN 60 SECONDS", support: "SIMPLE ONLINE CHECK", cta: "" },
      { eyebrow: "OWNERSHIP ROUTE", headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR RENT2BUY PATH", cta: "" },
      { eyebrow: "HUGE CHOICE", headline: "VANS READY TO GO", support: "PICKUPS, LUTONS AND PANEL VANS", cta: "" },
      { eyebrow: "NO CREDIT CHECK", headline: "CHECK IF YOU QUALIFY", support: "FAST ONLINE APPLICATION", cta: "" },
      { eyebrow: "RENT2BUY VANS", headline: "APPLY TODAY", support: "DRIVE IT, THEN OWN IT", cta: "CHECK IF YOU QUALIFY" },
    ];
    return frames[index % frames.length];
  }

  const frames = [
    { eyebrow: "VAN FINANCE COMPANY", headline: "FROM \u00a399 DEPOSIT", support: "FREE UK DELIVERY", cta: "APPLY NOW" },
    { eyebrow: "SELECTED VAN", headline: "YOUR NEXT VAN", support: "LOW DEPOSIT OPTIONS", cta: "" },
    { eyebrow: "FINANCE PAYMENT", headline: "BUY THIS VAN FROM ONLY {monthly price}", support: "{registration}", cta: "" },
    { eyebrow: "FINANCE OPTIONS", headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING", cta: "" },
    { eyebrow: "FAST DECISIONS", headline: "APPROVED IN 60 MINUTES", support: "APPLY ONLINE TODAY", cta: "" },
    { eyebrow: "ALL WELCOME", headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED", cta: "" },
    { eyebrow: "LOW DEPOSIT", headline: "FROM \u00a399 DEPOSIT", support: "SUBJECT TO STATUS", cta: "" },
    { eyebrow: "READY TO GO", headline: "200+ VANS AVAILABLE", support: "NATIONWIDE DELIVERY", cta: "" },
    { eyebrow: "APPLY ONLINE", headline: "APPROVED IN 60 MINUTES", support: "SIMPLE FAST APPLICATION", cta: "" },
    { eyebrow: "START TODAY", headline: "APPLY ONLINE TODAY", support: "VAN FINANCE COMPANY", cta: "APPLY NOW" },
  ];
  return frames[index % frames.length];
}

function defaultFrameTexts(productKey, count = MAX_IMAGES) {
  return Array.from({ length: count }, (_, index) => ({ ...defaultFrameText(productKey, index) }));
}

function normalizeTextStateForProduct(value, productKey) {
  const product = PRODUCTS[productKey];
  const base = {
    header: product.header,
    topText: product.topText,
    hook: product.hook,
    support: product.support,
    cta: product.cta,
    frames: defaultFrameTexts(productKey, MAX_IMAGES),
  };
  const savedFrames = Array.isArray(value?.frames) ? value.frames : [];
  const frames = defaultFrameTexts(productKey, MAX_IMAGES).map((frame, index) => {
    const savedFrame = savedFrames[index];
    if (!savedFrame || typeof savedFrame !== "object") return frame;
    const merged = { ...frame, ...savedFrame };
    if (
      productKey === "vanFinance" &&
      index === 2 &&
      cleanText(savedFrame.eyebrow).toUpperCase() === "FREE UK DELIVERY" &&
      cleanText(savedFrame.headline).toUpperCase() === "DELIVERED TO YOUR DOOR" &&
      cleanText(savedFrame.support).toUpperCase() === "ANYWHERE IN THE UK"
    ) {
      return frame;
    }
    return merged;
  });
  return { ...base, ...(value || {}), frames };
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

function buildOrderedImageRecords(records, limit = MAX_IMAGES) {
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

  return { records: ordered.slice(0, Math.min(MAX_IMAGES, limit)), dedupeHappened };
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
  const registration = normalizeRegistration(explicitReg) || extractRegistrationFromText(rowText);
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
    imageRecords: buildOrderedImageRecords(imageValues.map((url, imageIndex) => ({ url, source: `CMS image ${imageIndex + 1}` }))).records,
  };
}

function parseCmsUploadText(text) {
  const value = String(text || "").trim();
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed?.rows) ? parsed.rows : [parsed];
    return rows.map(normalizeCmsRow).filter((row) => row.registration || row.title || row.imageRecords.length);
  } catch {}

  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => cleanText(header));
  return lines
    .slice(1)
    .map((line, index) => {
      const cells = splitCsvLine(line);
      const row = {};
      headers.forEach((header, headerIndex) => {
        row[header] = cells[headerIndex] || "";
      });
      return normalizeCmsRow(row, index);
    })
    .filter((row) => row.registration || row.title || row.imageRecords.length);
}

function titleLooksLikeMatch(rowTitle, vehicle) {
  const title = cleanText(rowTitle).toUpperCase();
  const vehicleText = vehicleTitle(vehicle).toUpperCase();
  if (!title || !vehicleText) return false;
  if (vehicleText.includes(title) || title.includes(vehicleText)) return true;
  const parts = title.split(/\s+/).filter((part) => part.length > 2);
  return parts.length >= 3 && parts.slice(0, 5).filter((part) => vehicleText.includes(part)).length >= 3;
}

function findCmsMatch(rows, vehicle) {
  const registration = vehicleRegistration(vehicle);
  return (rows || []).find((row) => row.registration && row.registration === registration)
    || (rows || []).find((row) => titleLooksLikeMatch(row.title, vehicle))
    || null;
}

function getVehicleStockImageRecords(vehicle) {
  if (!vehicle) return [];
  const imageValues = [];
  const addValue = (value) => extractImageUrlsFromValue(value).forEach((url) => imageValues.push(url));

  addValue(vehicle.image);
  addValue(vehicle.picture);
  addValue(vehicle.mainImage);
  addValue(vehicle.imageUrl);
  addValue(vehicle.image_url);
  addValue(vehicle.thumbnail);
  addValue(vehicle.mediaGallery);
  addValue(vehicle.mainImages);
  addValue(vehicle.gallery);
  addValue(vehicle.images);
  addValue(vehicle.imageUrls);
  addValue(vehicle.pictures);

  Object.entries(vehicle).forEach(([key, value]) => {
    const normalKey = normalizeCmsKey(key);
    if (/^image\d+$/.test(normalKey) || /^picture\d+$/.test(normalKey) || /^photo\d+$/.test(normalKey)) {
      addValue(value);
    }
  });

  return buildOrderedImageRecords(imageValues.map((url, index) => ({ url, source: `stock image ${index + 1}` }))).records;
}

function getProductVehicles(vehicles, productKey) {
  if (productKey === "rent2buy") {
    return (vehicles || [])
      .filter((vehicle) => vehicle?.rent2buyEligible || vehicle?.pipeline === "rent2buy")
      .map((vehicle) => {
        const rent = vehicle.rent2buyData || {};
        const image = vehicleImage(rent) || vehicleImage(vehicle);
        return { ...vehicle, ...rent, id: vehicle.id, image, picture: image, pipeline: "rent2buy" };
      });
  }

  return (vehicles || []).map((vehicle) => ({ ...vehicle, pipeline: "vanFinance" }));
}

function defaultTextState() {
  return {
    vanFinance: normalizeTextStateForProduct({
      header: PRODUCTS.vanFinance.header,
      topText: PRODUCTS.vanFinance.topText,
      hook: PRODUCTS.vanFinance.hook,
      support: PRODUCTS.vanFinance.support,
      cta: PRODUCTS.vanFinance.cta,
    }, "vanFinance"),
    rent2buy: normalizeTextStateForProduct({
      header: PRODUCTS.rent2buy.header,
      topText: PRODUCTS.rent2buy.topText,
      hook: PRODUCTS.rent2buy.hook,
      support: PRODUCTS.rent2buy.support,
      cta: PRODUCTS.rent2buy.cta,
    }, "rent2buy"),
  };
}

function loadSavedTextDefaults() {
  const defaults = defaultTextState();
  if (typeof window === "undefined") return defaults;
  try {
    const saved = JSON.parse(window.localStorage.getItem(TEXT_DEFAULTS_STORAGE_KEY) || "{}");
    return {
      vanFinance: normalizeTextStateForProduct({ ...defaults.vanFinance, ...(saved.vanFinance || {}) }, "vanFinance"),
      rent2buy: normalizeTextStateForProduct({ ...defaults.rent2buy, ...(saved.rent2buy || {}) }, "rent2buy"),
    };
  } catch {
    return defaults;
  }
}

function loadSavedTextModes() {
  if (typeof window === "undefined") return { vanFinance: "default", rent2buy: "default" };
  try {
    const saved = JSON.parse(window.localStorage.getItem(TEXT_MODE_STORAGE_KEY) || "{}");
    return {
      vanFinance: saved.vanFinance === "manual" ? "manual" : "default",
      rent2buy: saved.rent2buy === "manual" ? "manual" : "default",
    };
  } catch {
    return { vanFinance: "default", rent2buy: "default" };
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load YouTube Short image."));
    image.src = src;
  });
}

async function createAudioStream(durationMs) {
  if (typeof window === "undefined" || !window.AudioContext) {
    throw new Error("This browser cannot add music.");
  }

  const audioContext = new window.AudioContext();
  try {
    const response = await fetch(defaultReelAudio);
    if (!response.ok) throw new Error("Could not load music.");
    const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = audioBuffer;
    source.loop = audioBuffer.duration * 1000 < durationMs;
    gain.gain.value = 0.2;
    source.connect(gain);
    gain.connect(destination);
    if (audioContext.state === "suspended") await audioContext.resume();
    source.start(0);
    return {
      stream: destination.stream,
      cleanup: () => {
        try {
          source.stop();
        } catch {}
        audioContext.close().catch(() => {});
      },
    };
  } catch (error) {
    audioContext.close().catch(() => {});
    throw error;
  }
}

function emptyAudioStream() {
  return { stream: null, cleanup: () => {} };
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  drawRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawCoverImage(ctx, image, x, y, width, height, zoom = 1, panX = 0, panY = 0) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2 + panX, y + (height - drawHeight) / 2 + panY, drawWidth, drawHeight);
}

function drawContainImage(ctx, image, x, y, width, height, scaleAdjust = 0.98, panX = 0, panY = 0) {
  const baseScale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const scale = baseScale * scaleAdjust;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const maxPanX = Math.max(0, (width - drawWidth) / 2);
  const maxPanY = Math.max(0, (height - drawHeight) / 2);
  const safePanX = Math.max(-maxPanX, Math.min(maxPanX, panX));
  const safePanY = Math.max(-maxPanY, Math.min(maxPanY, panY));
  ctx.drawImage(image, x + (width - drawWidth) / 2 + safePanX, y + (height - drawHeight) / 2 + safePanY, drawWidth, drawHeight);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
}

function drawFitText(ctx, text, x, y, maxWidth, maxFontSize, minFontSize, weight = 900) {
  const clean = cleanText(text);
  let fontSize = maxFontSize;
  while (fontSize > minFontSize) {
    ctx.font = `${weight} ${fontSize}px ${CANVAS_FONT}`;
    if (ctx.measureText(clean).width <= maxWidth) break;
    fontSize -= 2;
  }
  ctx.fillText(clean, x, y);
}

function easeInOut(value) {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function frameMessage({ productKey, product, vehicle, frameIndex, frameCount, text }) {
  const title = vehicleTitle(vehicle);
  const price = vehiclePriceLine(vehicle, productKey);
  if (frameIndex === 1) {
    return { eyebrow: displayRegistration(vehicle) || "SELECTED VAN", headline: title, subline: price, cta: "" };
  }
  if (frameIndex === 2) {
    return {
      eyebrow: productKey === "rent2buy" ? "RENT2BUY PAYMENT" : "FINANCE PAYMENT",
      headline: productKey === "rent2buy" ? rent2buyPriceHeadline(vehicle) : vanFinanceMonthlyHeadline(vehicle),
      subline: displayRegistration(vehicle),
      cta: "",
    };
  }
  if (frameIndex === frameCount - 1) {
    return { eyebrow: "APPLY TODAY", headline: text.cta, subline: product.domain, cta: text.cta };
  }
  const frameText = Array.isArray(text?.frames) ? text.frames[frameIndex] : null;
  if (frameText) {
    const rawHeadline = cleanText(frameText.headline);
    const rawSupport = cleanText(frameText.support);
    const headline = resolveFrameTemplateText(rawHeadline, { productKey, vehicle });
    const support = resolveFrameTemplateText(rawSupport, { productKey, vehicle });
    return {
      eyebrow: cleanText(frameText.eyebrow),
      headline:
        frameIndex === 1 && rawHeadline.toUpperCase() === "YOUR NEXT VAN"
          ? title
          : productKey === "vanFinance" && frameIndex === 2 && rawHeadline.toUpperCase() === "BUY THIS VAN FROM ONLY {MONTHLY PRICE}"
            ? vanFinanceMonthlyHeadline(vehicle)
            : headline,
      subline:
        frameIndex === 1 && rawSupport.toUpperCase().includes("OPTION")
          ? price
          : productKey === "vanFinance" && frameIndex === 2 && rawSupport.toUpperCase() === "{REGISTRATION}"
            ? displayRegistration(vehicle)
            : support,
      cta: cleanText(frameText.cta),
    };
  }
  if (frameIndex === 0) {
    return { eyebrow: text.header, headline: text.hook, subline: text.support, cta: text.cta };
  }
  const message = product.messages[(frameIndex - 2) % product.messages.length];
  return { eyebrow: product.brand.toUpperCase(), headline: message, subline: frameIndex % 2 ? vehicleRegistration(vehicle) : text.support, cta: "" };
}

function buildYouTubeFrameSpecs({ productKey, product = PRODUCTS[productKey], vehicle, text, frameCount }) {
  const totalFrameCount = Math.max(1, Math.min(MAX_IMAGES, Number(frameCount) || 1));
  const finalFrameIndex = totalFrameCount - 1;

  return Array.from({ length: totalFrameCount }, (_, frameIndex) => {
    let type = "editable";
    let locked = false;

    if (frameIndex === finalFrameIndex) {
      type = "finalCta";
      locked = true;
    } else if (frameIndex === 1) {
      type = "vehicleDetails";
      locked = true;
    } else if (frameIndex === 2) {
      type = "payment";
      locked = true;
    }

    const display = type === "finalCta"
      ? {
          eyebrow: "APPLY TODAY",
          headline: cleanText(text?.cta || product?.cta || "APPLY NOW"),
          subline: `www.${product?.domain || ""}`,
          cta: cleanText(text?.cta || product?.cta || "APPLY NOW"),
        }
      : frameMessage({ productKey, product, vehicle, frameIndex, frameCount: totalFrameCount, text });

    return {
      type,
      locked,
      frameIndex,
      frameNumber: frameIndex + 1,
      isFinal: frameIndex === finalFrameIndex,
      text: Array.isArray(text?.frames) ? text.frames[frameIndex] : null,
      display,
    };
  });
}

function drawLightSweep(ctx, x, y, width, height, progress, alpha = 0.25) {
  const sweepX = x - width * 0.4 + progress * width * 1.8;
  const gradient = ctx.createLinearGradient(sweepX - 90, y, sweepX + 90, y + height);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function drawYouTubeFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, text, elapsedSeconds, durationSeconds, frameSpecs }) {
  const product = PRODUCTS[productKey];
  const config = TEMPLATE_CONFIG[visualTemplate] || TEMPLATE_CONFIG.blackPremium;
  const imageArea = config.imageArea;
  const specs = Array.isArray(frameSpecs) && frameSpecs.length
    ? frameSpecs
    : buildYouTubeFrameSpecs({ productKey, product, vehicle, text, frameCount: loadedImages.length || 1 });
  const totalFrameCount = Math.max(1, specs.length);
  const finalFrameIndex = totalFrameCount - 1;
  const segmentDuration = durationSeconds / totalFrameCount;
  const frameIndex = Math.min(finalFrameIndex, Math.floor(elapsedSeconds / segmentDuration));
  const frameSpec = specs[frameIndex] || specs[finalFrameIndex];
  const frameProgress = Math.min(1, (elapsedSeconds - frameIndex * segmentDuration) / segmentDuration);
  const isFinalCtaFrame = frameSpec?.type === "finalCta";
  const image = loadedImages[Math.min(frameIndex, loadedImages.length - 1)] || loadedImages[0];
  const transition = Math.min(1, frameProgress / config.transition);
  const fade = easeInOut(transition);
  const isLuxury = visualTemplate === "luxuryDealer";
  const isTikTok = visualTemplate === "tiktokPunch";
  const containScale = 0.972 + Math.sin(frameProgress * Math.PI) * Math.min(config.zoom, 0.012);
  const panX = Math.sin((frameIndex + frameProgress) * 1.4) * (isTikTok ? 8 : 5);
  const panY = Math.cos((frameIndex + frameProgress) * 1.1) * 4;

  ctx.clearRect(0, 0, SHORT_WIDTH, SHORT_HEIGHT);
  const bg = ctx.createLinearGradient(0, 0, 0, SHORT_HEIGHT);
  bg.addColorStop(0, isLuxury ? "#0d0d10" : "#050608");
  bg.addColorStop(0.5, "#000000");
  bg.addColorStop(1, isTikTok ? "#21060b" : "#100406");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHORT_WIDTH, SHORT_HEIGHT);

  if (image) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    drawCoverImage(ctx, image, 0, 0, SHORT_WIDTH, SHORT_HEIGHT, 1.08);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, SHORT_WIDTH, SHORT_HEIGHT);
    ctx.restore();
  }

  const headerGradient = ctx.createLinearGradient(imageArea.x, config.headerY, imageArea.x + imageArea.width, config.headerY + 150);
  headerGradient.addColorStop(0, "rgba(239,35,60,0.26)");
  headerGradient.addColorStop(0.42, "rgba(8,8,10,0.98)");
  headerGradient.addColorStop(1, "rgba(0,0,0,0.96)");
  fillRoundRect(ctx, imageArea.x, config.headerY, imageArea.width, 154, isLuxury ? 20 : 26, headerGradient);
  ctx.fillStyle = product.accent;
  ctx.fillRect(imageArea.x, config.headerY + 146, imageArea.width, 8);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  drawFitText(ctx, (text.header || product.header).toUpperCase(), SHORT_WIDTH / 2, config.headerY + 94, imageArea.width - 90, isTikTok ? 68 : 60, 38, 950);
  ctx.textAlign = "left";

  if (image) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.45, fade);
    ctx.shadowColor = `rgba(239,35,60,${config.glow})`;
    ctx.shadowBlur = isTikTok ? 56 : 34;
    ctx.shadowOffsetY = 16;
    drawRoundRect(ctx, imageArea.x, imageArea.y, imageArea.width, imageArea.height, 32);
    ctx.clip();
    ctx.fillStyle = "#050505";
    ctx.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
    drawContainImage(ctx, image, imageArea.x, imageArea.y, imageArea.width, imageArea.height, containScale, panX, panY);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  drawRoundRect(ctx, imageArea.x, imageArea.y, imageArea.width, imageArea.height, 32);
  ctx.stroke();
  ctx.restore();

  const lowerGlow = ctx.createRadialGradient(SHORT_WIDTH / 2, 1420, 60, SHORT_WIDTH / 2, 1420, 650);
  lowerGlow.addColorStop(0, `rgba(239,35,60,${config.glow})`);
  lowerGlow.addColorStop(1, "rgba(239,35,60,0)");
  ctx.fillStyle = lowerGlow;
  ctx.fillRect(0, 1120, SHORT_WIDTH, 700);

  const textX = 78;
  const textY = config.textY + (1 - fade) * 22;
  const textWidth = SHORT_WIDTH - 156;
  const textPanelY = config.textY - 56;
  const textPanelHeight = isFinalCtaFrame ? 520 : 388;
  const panelGradient = ctx.createLinearGradient(textX - 26, textPanelY, SHORT_WIDTH - 58, textPanelY + textPanelHeight);
  panelGradient.addColorStop(0, "rgba(239,35,60,0.16)");
  panelGradient.addColorStop(0.26, "rgba(28,8,11,0.88)");
  panelGradient.addColorStop(1, "rgba(0,0,0,0.76)");
  fillRoundRect(ctx, textX - 26, textPanelY, textWidth + 52, textPanelHeight, 28, panelGradient);
  ctx.fillStyle = "rgba(239,35,60,0.84)";
  ctx.fillRect(textX - 26, textPanelY, textWidth + 52, 7);

  ctx.save();
  ctx.globalAlpha = Math.max(0.2, fade);
  ctx.shadowColor = `rgba(239,35,60,${isTikTok ? 0.48 : 0.28})`;
  ctx.shadowBlur = isTikTok ? 48 : 30;
  if (isFinalCtaFrame) {
    const finalCta = cleanText(text.cta || product.cta || "APPLY NOW");
    ctx.textAlign = "center";
    ctx.fillStyle = product.accent;
    ctx.font = `950 32px ${CANVAS_FONT}`;
    drawFitText(ctx, "APPLY TODAY", SHORT_WIDTH / 2, textY + 22, textWidth, 34, 24, 950);
    ctx.shadowColor = "rgba(0,0,0,0.74)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    wrapText(ctx, finalCta.toUpperCase(), textX, textY + 118, textWidth, 86, 2);
    ctx.shadowBlur = 0;
    const buttonY = textPanelY + 278;
    fillRoundRect(ctx, 130, buttonY, SHORT_WIDTH - 260, 112, 34, product.accent);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    drawFitText(ctx, finalCta.toUpperCase(), SHORT_WIDTH / 2, buttonY + 72, SHORT_WIDTH - 330, 46, 30, 950);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    drawFitText(ctx, `www.${product.domain}`.toUpperCase(), SHORT_WIDTH / 2, buttonY + 186, textWidth, 38, 26, 900);
    ctx.textAlign = "left";
    drawLightSweep(ctx, textX - 20, textY + 64, textWidth + 40, 230, Math.min(1, frameProgress * 1.2), isTikTok ? 0.4 : 0.26);
  } else {
    const spec = frameSpec?.display || frameMessage({ productKey, product, vehicle, frameIndex, frameCount: totalFrameCount, text });
    ctx.fillStyle = product.accent;
    ctx.font = `900 28px ${CANVAS_FONT}`;
    if (spec.eyebrow) ctx.fillText(spec.eyebrow.toUpperCase(), textX, textY);
    ctx.shadowColor = "rgba(0,0,0,0.72)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ffffff";
    ctx.font = `950 ${config.headline}px ${CANVAS_FONT}`;
    if (spec.headline) wrapText(ctx, spec.headline.toUpperCase(), textX, textY + 92, textWidth, config.headline + 10, 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `850 ${config.body}px ${CANVAS_FONT}`;
    if (spec.subline) wrapText(ctx, spec.subline.toUpperCase(), textX, textY + 294, textWidth, config.body + 12, 2);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `900 34px ${CANVAS_FONT}`;
    drawFitText(ctx, `www.${product.domain}`.toUpperCase(), SHORT_WIDTH / 2, 1734, textWidth, 38, 26, 900);
    ctx.textAlign = "left";
    drawLightSweep(ctx, textX - 20, textY + 52, textWidth + 40, 180, Math.min(1, frameProgress * 1.2), isTikTok ? 0.36 : 0.22);
  }
  ctx.restore();

  if (frameProgress < 0.08 && frameIndex > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(1 - frameProgress / 0.08) * 0.08})`;
    ctx.fillRect(0, 0, SHORT_WIDTH, SHORT_HEIGHT);
  }
}

function createYouTubeMediaRecorder(stream, supportedMime) {
  const options = {
    mimeType: supportedMime,
    videoBitsPerSecond: YOUTUBE_VIDEO_BITRATE,
    audioBitsPerSecond: YOUTUBE_AUDIO_BITRATE,
  };

  try {
    return new MediaRecorder(stream, options);
  } catch {
    return new MediaRecorder(stream, { mimeType: supportedMime });
  }
}

async function generateYouTubeShortAsset({ productKey, vehicle, visualTemplate, text, imageUrls, frameCount, frameSpecs, durationSeconds, fps, musicOn, onProgress }) {
  if (typeof HTMLCanvasElement === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record YouTube Shorts.");
  }

  const supportedMime =
    ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  if (!supportedMime) throw new Error("This browser cannot record WebM video.");

  const selectedFrameCount = Math.max(1, Math.min(MAX_IMAGES, Number(frameCount) || imageUrls.filter(Boolean).length || 1));
  const renderFrameSpecs = Array.isArray(frameSpecs) && frameSpecs.length === selectedFrameCount
    ? frameSpecs
    : buildYouTubeFrameSpecs({ productKey, product: PRODUCTS[productKey], vehicle, text, frameCount: selectedFrameCount });
  onProgress?.("Loading images");
  const loadedImages = [];
  for (const url of imageUrls.filter(Boolean)) {
    try {
      loadedImages.push(await loadImage(url));
    } catch {
      // Optional image failures should not block the full short.
    }
  }
  if (!loadedImages.length) throw new Error("No usable image is available for this YouTube Short.");

  const canvas = document.createElement("canvas");
  canvas.width = SHORT_WIDTH;
  canvas.height = SHORT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create YouTube Short canvas.");

  let audioAsset = emptyAudioStream();
  let audioWarning = "";
  if (musicOn) {
    onProgress?.("Adding music");
    try {
      audioAsset = await withTimeout(
        createAudioStream(durationSeconds * 1000),
        7000,
        "Music setup timed out."
      );
    } catch (audioError) {
      audioWarning = "Music could not be added. Silent video fallback was used.";
      console.warn("YouTube Generator music disabled:", audioError);
    }
  }

  const recordingFps = FPS_OPTIONS.includes(Number(fps)) ? Number(fps) : DEFAULT_SHORT_FPS;
  const canvasStream = canvas.captureStream(recordingFps);
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(audioAsset.stream ? audioAsset.stream.getAudioTracks() : []),
  ]);
  const recorder = createYouTubeMediaRecorder(stream, supportedMime);
  const chunks = [];
  let timer = 0;

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onerror = (event) => reject(event?.error || new Error("YouTube Short recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: supportedMime }));
  });

  const totalFrames = durationSeconds * recordingFps;
  let frame = 0;
  const render = () => {
    const elapsedSeconds = Math.min(durationSeconds, frame / recordingFps);
    drawYouTubeFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, text, elapsedSeconds, durationSeconds, frameSpecs: renderFrameSpecs });
    if (frame % recordingFps === 0) onProgress?.(`Rendering ${Math.round((frame / totalFrames) * 100)}%`);
    frame += 1;
    if (frame <= totalFrames) {
      timer = window.setTimeout(render, 1000 / recordingFps);
    } else if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start();
  render();

  try {
    const blob = await finished;
    const url = URL.createObjectURL(blob);
    return { blob, url, extension: "webm", audioEmbedded: stream.getAudioTracks().length > 0, audioWarning };
  } finally {
    if (timer) window.clearTimeout(timer);
    audioAsset.cleanup();
  }
}

async function downloadYouTubeMp4FromWebm(blob, filename, durationSeconds, fps) {
  const response = await fetch("/api/convert-youtube-short-mp4", {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "video/webm",
      "X-Reel-Filename": filename,
      "X-YouTube-Duration": String(durationSeconds),
      "X-YouTube-FPS": String(fps || DEFAULT_SHORT_FPS),
    },
    body: blob,
  });

  if (!response.ok) {
    let message = response.status === 413
      ? "MP4 conversion failed because the video file is too large. Try 20 seconds, fewer images, or download the WebM fallback."
      : `MP4 conversion failed with HTTP ${response.status}.`;
    try {
      const payload = await response.json();
      if (response.status !== 413) {
        message = payload?.error ? `MP4 conversion failed: ${payload.error}` : message;
      }
    } catch {}
    throw new Error(message);
  }

  const contentType = response.headers.get("Content-Type") || "";
  const mp4Blob = await response.blob();
  if (!mp4Blob.size) throw new Error("MP4 conversion failed: conversion endpoint returned an empty file.");
  if (/text\/html/i.test(contentType)) throw new Error("MP4 conversion failed: conversion endpoint returned the app page instead of an MP4 file.");

  const url = URL.createObjectURL(mp4Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, size: mp4Blob.size };
}

function downloadWebmFallback(blob, filename) {
  if (!blob) throw new Error("No YouTube Short WebM fallback is available yet.");
  const fallbackName = safeFilePart(String(filename || "youtube-short").replace(/\.(mp4|webm)$/i, "")) || "youtube-short";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fallbackName}.webm`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function YouTubeGeneratorPage({
  vehicles = [],
  vehiclesLoading = false,
  vehiclesError = "",
  queueByProduct: externalQueueByProduct = null,
  onQueueChange = null,
  cmsUploadsByProduct: externalCmsUploadsByProduct = null,
  onCmsUploadChange = null,
}) {
  const [productKey, setProductKey] = useState("vanFinance");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [imageSource, setImageSource] = useState("auto");
  const [imageCount, setImageCount] = useState(10);
  const [durationSeconds, setDurationSeconds] = useState(20);
  const [recordingFps, setRecordingFps] = useState(DEFAULT_SHORT_FPS);
  const [visualTemplate, setVisualTemplate] = useState("blackPremium");
  const [musicOn, setMusicOn] = useState(true);
  const [textModeByProduct, setTextModeByProduct] = useState(loadSavedTextModes);
  const [textDefaultsByProduct, setTextDefaultsByProduct] = useState(loadSavedTextDefaults);
  const [manualTextByProduct, setManualTextByProduct] = useState(defaultTextState);
  const [localCmsUploadsByProduct, setLocalCmsUploadsByProduct] = useState(loadYouTubeCmsUploads);
  const [localQueueByProduct, setLocalQueueByProduct] = useState({ vanFinance: [], rent2buy: [] });
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueProgress, setQueueProgress] = useState({ index: 0, total: 0, completed: 0, failed: 0, message: "Ready" });
  const [queueFailures, setQueueFailures] = useState([]);
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const cmsInputRef = useRef(null);
  const generationKeyRef = useRef("");
  const queueCancelRef = useRef(false);

  const product = PRODUCTS[productKey];
  const productVehicles = useMemo(() => getProductVehicles(vehicles, productKey), [vehicles, productKey]);
  const selectedVehicle = useMemo(
    () => productVehicles.find((vehicle) => String(vehicle.id) === selectedVehicleId) || productVehicles[0] || null,
    [productVehicles, selectedVehicleId]
  );
  const cmsUploadsByProduct = externalCmsUploadsByProduct || localCmsUploadsByProduct;
  const cmsUpload = cmsUploadsByProduct[productKey] || null;
  const cmsMatch = selectedVehicle ? findCmsMatch(cmsUpload?.rows || [], selectedVehicle) : null;
  const textMode = textModeByProduct[productKey] === "manual" ? "manual" : "default";
  const defaultText = normalizeTextStateForProduct(textDefaultsByProduct[productKey] || defaultTextState()[productKey], productKey);
  const manualText = normalizeTextStateForProduct(manualTextByProduct[productKey] || defaultTextState()[productKey], productKey);
  const activeText = normalizeTextStateForProduct(textMode === "manual" ? manualText : defaultText, productKey);
  const selectedFrameSpecs = useMemo(
    () => buildYouTubeFrameSpecs({ productKey, product, vehicle: selectedVehicle, text: activeText, frameCount: imageCount }),
    [activeText, imageCount, product, productKey, selectedVehicle]
  );
  const stockRecords = useMemo(() => getVehicleStockImageRecords(selectedVehicle), [selectedVehicle]);
  const activeQueueByProduct = externalQueueByProduct || localQueueByProduct;
  const activeQueue = activeQueueByProduct[productKey] || [];
  function buildFrameSpecsForVehicle(vehicle) {
    return buildYouTubeFrameSpecs({ productKey, product, vehicle, text: activeText, frameCount: imageCount });
  }
  function resolveImageOrderForVehicle(vehicle) {
    return resolveYouTubeImageOrder({ vehicle, cmsUpload, imageSource, imageCount });
  }
  const resolvedImageOrder = useMemo(() => {
    return resolveYouTubeImageOrder({ vehicle: selectedVehicle, cmsUpload, imageSource, imageCount });
  }, [cmsUpload, imageSource, imageCount, selectedVehicle]);
  const resolvedImages = resolvedImageOrder.records.map((item) => item.url);
  const availableImageCount = resolvedImageOrder.records.length;
  const hasEnoughImages = availableImageCount >= imageCount;
  const imageAvailabilityText = hasEnoughImages
    ? `${availableImageCount} / ${imageCount} images available`
    : `${availableImageCount} / ${imageCount} images available - not enough images for selected YouTube Short setup`;
  const currentPreviewKey = selectedVehicle
    ? `${productKey}:${selectedVehicle.id}:${vehicleRegistration(selectedVehicle)}:${imageSource}:${imageCount}:${durationSeconds}:${recordingFps}:${visualTemplate}:${musicOn}:${textMode}:${JSON.stringify(activeText)}:${resolvedImages.join("|")}`
    : "";
  const currentAsset = asset?.queueAsset || asset?.previewKey === currentPreviewKey ? asset : null;

  useEffect(() => {
    setSelectedVehicleId("");
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setStatus("");
    setError("");
  }, [productKey]);

  useEffect(() => {
    if (externalCmsUploadsByProduct) return undefined;
    let cancelled = false;
    loadYouTubeCmsUploadsAsync().then((uploads) => {
      if (!cancelled) setLocalCmsUploadsByProduct(uploads);
    });
    return () => {
      cancelled = true;
    };
  }, [externalCmsUploadsByProduct]);

  useEffect(() => {
    generationKeyRef.current = currentPreviewKey;
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setStatus("");
    setError("");
  }, [currentPreviewKey]);

  useEffect(() => {
    return () => {
      if (asset?.url) URL.revokeObjectURL(asset.url);
    };
  }, []);

  async function handleCmsUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = parseYoutubeCmsUploadText(await file.text());
      const upload = { fileName: file.name, rows, loadedAt: new Date().toISOString() };
      if (onCmsUploadChange) {
        onCmsUploadChange(productKey, upload);
      } else {
        setLocalCmsUploadsByProduct((prev) => ({ ...prev, [productKey]: upload }));
      }
      saveYouTubeCmsUpload(productKey, upload);
      setImageSource("auto");
      setStatus(`${product.label} CMS upload loaded: ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
      setError("");
    } catch (uploadError) {
      setError(uploadError.message || `Could not read ${product.label} CMS upload.`);
    } finally {
      event.target.value = "";
    }
  }

  function clearCmsUpload() {
    if (onCmsUploadChange) {
      onCmsUploadChange(productKey, null);
    } else {
      setLocalCmsUploadsByProduct((prev) => ({ ...prev, [productKey]: null }));
    }
    saveYouTubeCmsUpload(productKey, null);
    setStatus(`${product.label} CMS upload cleared.`);
  }

  function handleTextModeChange(nextMode) {
    const next = { ...textModeByProduct, [productKey]: nextMode };
    setTextModeByProduct(next);
    if (typeof window !== "undefined") window.localStorage.setItem(TEXT_MODE_STORAGE_KEY, JSON.stringify(next));
  }

  function updateActiveText(field, value) {
    if (textMode === "manual") {
      setManualTextByProduct((prev) => ({
        ...prev,
        [productKey]: { ...normalizeTextStateForProduct(prev[productKey] || defaultTextState()[productKey], productKey), [field]: value },
      }));
      return;
    }

    setTextDefaultsByProduct((prev) => ({
      ...prev,
      [productKey]: { ...normalizeTextStateForProduct(prev[productKey] || defaultTextState()[productKey], productKey), [field]: value },
    }));
  }

  function updateActiveFrameText(frameIndex, field, value) {
    if (isLockedSystemFrame(frameIndex)) return;
    const updateProductText = (current) => {
      const base = normalizeTextStateForProduct(current || defaultTextState()[productKey], productKey);
      const frames = defaultFrameTexts(productKey, MAX_IMAGES).map((frame, index) => ({ ...frame, ...(base.frames[index] || {}) }));
      frames[frameIndex] = { ...(frames[frameIndex] || defaultFrameText(productKey, frameIndex)), [field]: value };
      return { ...base, frames };
    };

    if (textMode === "manual") {
      setManualTextByProduct((prev) => ({ ...prev, [productKey]: updateProductText(prev[productKey]) }));
      return;
    }

    setTextDefaultsByProduct((prev) => ({ ...prev, [productKey]: updateProductText(prev[productKey]) }));
  }

  function saveTextDefaults() {
    const nextDefaults = {
      ...textDefaultsByProduct,
      [productKey]: normalizeTextStateForProduct(activeText, productKey),
    };
    setTextDefaultsByProduct(nextDefaults);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TEXT_DEFAULTS_STORAGE_KEY, JSON.stringify(nextDefaults));
    }
    setStatus(`${product.label} YouTube text defaults saved.`);
    setError("");
  }

  async function handleGenerate() {
    setError("");
    setStatus("");
    if (!selectedVehicle) {
      setError("Select a vehicle before generating a YouTube Short.");
      return;
    }
    if (!resolvedImages.length) {
      setError("No usable image is available. Upload CMS rows or use stock image fallback.");
      return;
    }
    if (!hasEnoughImages) {
      setError(`Not enough images for this YouTube Short. ${imageAvailabilityText}.`);
      return;
    }
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);

    const renderKey = currentPreviewKey;
    generationKeyRef.current = renderKey;
    try {
      const nextAsset = await generateYouTubeShortAsset({
        productKey,
        vehicle: selectedVehicle,
        visualTemplate,
        text: activeText,
        imageUrls: resolvedImages,
        frameCount: imageCount,
        frameSpecs: selectedFrameSpecs,
        durationSeconds,
        fps: recordingFps,
        musicOn,
        onProgress: setStatus,
      });
      if (generationKeyRef.current !== renderKey) {
        URL.revokeObjectURL(nextAsset.url);
        return;
      }
      setAsset({ ...nextAsset, previewKey: renderKey });
      setStatus(nextAsset.audioWarning || `YouTube Short preview ready using ${resolvedImages.length} image${resolvedImages.length === 1 ? "" : "s"}.`);
    } catch (generationError) {
      setError(generationError.message || "Could not generate YouTube Short preview.");
      setStatus("");
    }
  }

  function mp4Filename() {
    const reg = vehicleRegistration(selectedVehicle);
    return `${safeFilePart(`${productKey === "rent2buy" ? "rent2buy" : "van-finance"}-${reg || vehicleTitle(selectedVehicle)}-youtube-short`)}.mp4`;
  }

  async function handleDownloadMp4() {
    setError("");
    if (!currentAsset?.blob) {
      setError("Generate a YouTube Short preview before downloading MP4.");
      return;
    }
    try {
      setStatus("Converting YouTube Short to MP4...");
      await downloadYouTubeMp4FromWebm(currentAsset.blob, mp4Filename(), durationSeconds, recordingFps);
      setStatus("MP4 downloaded.");
    } catch (downloadError) {
      setError(downloadError.message || "Could not convert YouTube Short to MP4.");
      setStatus("MP4 conversion failed. WebM fallback is available.");
    }
  }

  function handleDownloadWebm() {
    try {
      downloadWebmFallback(currentAsset?.blob, mp4Filename());
      setStatus("WebM fallback downloaded.");
      setError("");
    } catch (fallbackError) {
      setError(fallbackError.message || "Could not download WebM fallback.");
    }
  }

  function setQueueForProduct(nextVehicles) {
    if (onQueueChange) {
      onQueueChange(productKey, nextVehicles);
      return;
    }
    setLocalQueueByProduct((prev) => ({ ...prev, [productKey]: nextVehicles }));
  }

  function addSelectedToQueue() {
    if (!selectedVehicle) {
      setError("Select a vehicle before adding to the YouTube queue.");
      return;
    }
    if (!hasEnoughImages) {
      setError(`Cannot add to YouTube queue. ${imageAvailabilityText}.`);
      return;
    }
    const key = `${selectedVehicle.id || ""}:${vehicleRegistration(selectedVehicle) || vehicleTitle(selectedVehicle)}`;
    const exists = activeQueue.some((vehicle) => `${vehicle.id || ""}:${vehicleRegistration(vehicle) || vehicleTitle(vehicle)}` === key);
    const nextQueue = exists ? activeQueue : [...activeQueue, selectedVehicle];
    setQueueForProduct(nextQueue);
    setStatus(`${vehicleRegistration(selectedVehicle) || vehicleTitle(selectedVehicle)} added to ${product.label} YouTube queue.`);
    setError("");
  }

  function removeQueueItem(vehicle) {
    const key = `${vehicle.id || ""}:${vehicleRegistration(vehicle) || vehicleTitle(vehicle)}`;
    setQueueForProduct(activeQueue.filter((item) => `${item.id || ""}:${vehicleRegistration(item) || vehicleTitle(item)}` !== key));
  }

  function clearQueue() {
    setQueueForProduct([]);
    setQueueProgress({ index: 0, total: 0, completed: 0, failed: 0, message: "Queue cleared" });
    setQueueFailures([]);
    setStatus(`${product.label} YouTube queue cleared.`);
  }

  function youtubeFilenameForVehicle(vehicle, extension = "mp4") {
    const productSlug = productKey === "rent2buy" ? "rent2buy" : "van-finance";
    return `${safeFilePart(`${productSlug}-${vehicleRegistration(vehicle) || vehicleTitle(vehicle)}-youtube-short`)}.${extension}`;
  }

  async function generateQueuedVehicle(vehicle) {
    const imageOrder = resolveImageOrderForVehicle(vehicle);
    if (imageOrder.records.length < imageCount) {
      throw new Error(`${vehicleRegistration(vehicle) || vehicleTitle(vehicle)} has ${imageOrder.records.length} / ${imageCount} images available.`);
    }
    const nextAsset = await generateYouTubeShortAsset({
      productKey,
      vehicle,
      visualTemplate,
      text: activeText,
      imageUrls: imageOrder.records.map((item) => item.url),
      frameCount: imageCount,
      frameSpecs: buildFrameSpecsForVehicle(vehicle),
      durationSeconds,
      fps: recordingFps,
      musicOn,
      onProgress: setStatus,
    });
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset({ ...nextAsset, queueAsset: true, previewKey: `queue:${productKey}:${vehicle.id || vehicleRegistration(vehicle)}:${Date.now()}` });
    return nextAsset;
  }

  async function exportQueuedVehicle(vehicle, index, total, completed, failed) {
    const label = vehicleRegistration(vehicle) || vehicleTitle(vehicle);
    setQueueProgress({ index, total, completed, failed, message: `Generating ${label}` });
    const nextAsset = await generateQueuedVehicle(vehicle);
    const mp4Name = youtubeFilenameForVehicle(vehicle, "mp4");
    setQueueProgress({ index, total, completed, failed, message: `Converting MP4 for ${label}` });
    try {
      await downloadYouTubeMp4FromWebm(nextAsset.blob, mp4Name, durationSeconds, recordingFps);
      setQueueProgress({ index, total, completed, failed, message: `Downloaded MP4 for ${label}` });
      await wait(900);
      return { status: "complete", label };
    } catch (mp4Error) {
      setQueueProgress({ index, total, completed, failed, message: `MP4 failed, downloading WebM fallback for ${label}` });
      try {
        downloadWebmFallback(nextAsset.blob, mp4Name);
        await wait(900);
        return {
          status: "fallback",
          label,
          error: `${label}: MP4 failed, WebM fallback downloaded. ${mp4Error.message || ""}`.trim(),
        };
      } catch (fallbackError) {
        throw new Error(`${label}: ${mp4Error.message || "MP4 conversion failed"}; WebM fallback failed: ${fallbackError.message || "unknown error"}`);
      }
    }
  }

  async function generateCurrentQueuedShort() {
    setError("");
    const vehicle = activeQueue[0];
    if (!vehicle) {
      setError("No vehicles are queued for this product.");
      return;
    }
    try {
      setQueueProgress({ index: 1, total: activeQueue.length, completed: 0, failed: 0, message: "Generating current queued short" });
      await generateQueuedVehicle(vehicle);
      setQueueProgress({ index: 1, total: activeQueue.length, completed: 1, failed: 0, message: "Current queued short ready" });
      setStatus(`Queued YouTube Short ready for ${vehicleRegistration(vehicle) || vehicleTitle(vehicle)}.`);
    } catch (queueError) {
      setQueueProgress({ index: 1, total: activeQueue.length, completed: 0, failed: 1, message: queueError.message || "Queue item failed" });
      setError(queueError.message || "Could not generate queued YouTube Short.");
    }
  }

  async function runQueue() {
    if (!activeQueue.length) {
      setError("No vehicles are queued for this product.");
      return;
    }
    queueCancelRef.current = false;
    setQueueRunning(true);
    setError("");
    setQueueFailures([]);
    let completed = 0;
    let failed = 0;
    const failures = [];
    const queueSnapshot = [...activeQueue];
    let remaining = [...queueSnapshot];

    for (let index = 0; index < queueSnapshot.length; index += 1) {
      if (queueCancelRef.current) break;
      const vehicle = queueSnapshot[index];
      try {
        const result = await exportQueuedVehicle(vehicle, index + 1, queueSnapshot.length, completed, failed);
        if (result.status === "fallback") {
          failed += 1;
          failures.push(result.error);
        } else {
          completed += 1;
        }
      } catch (queueError) {
        failed += 1;
        failures.push(queueError.message || "A YouTube queue item failed.");
      } finally {
        remaining = remaining.filter((item) => item !== vehicle);
        setQueueForProduct(remaining);
        setQueueFailures([...failures]);
      }
    }

    setQueueRunning(false);
    setQueueProgress({
      index: Math.min(queueSnapshot.length, completed + failed),
      total: queueSnapshot.length,
      completed,
      failed,
      message: queueCancelRef.current ? "Queue cancelled" : "Queue complete",
    });
    setStatus(
      queueCancelRef.current
        ? `YouTube queue cancelled. ${completed} MP4 downloaded. ${failed} failed or fallback-downloaded.`
        : `YouTube queue complete. ${completed} MP4 downloaded. ${failed} failed or fallback-downloaded.`
    );
    setError(failures.length ? `Queue issues:\n${failures.slice(0, 8).join("\n")}${failures.length > 8 ? `\n...and ${failures.length - 8} more.` : ""}` : "");
    queueCancelRef.current = false;
  }

  function cancelQueue() {
    queueCancelRef.current = true;
    setStatus("Cancelling YouTube queue...");
  }

  return (
    <section className="youtube-generator">
      <div className="youtube-generator__header">
        <div>
          <span className="eyebrow">Standalone beta tool</span>
          <h2>YouTube Generator</h2>
        </div>
        <div className="youtube-generator__pill">YouTube Short 1080 x 1920</div>
      </div>

      <div className="youtube-generator__grid">
        <div className="youtube-generator__panel">
          <section className="youtube-generator__section">
            <div className="youtube-generator__section-header">
              <h3>Setup</h3>
              <span>{vehiclesLoading ? "Loading stock..." : `${productVehicles.length} vehicles`}</span>
            </div>
            <div className="youtube-generator__segment">
              {Object.entries(PRODUCTS).map(([key, item]) => (
                <button key={key} type="button" className={productKey === key ? "is-active" : ""} onClick={() => setProductKey(key)}>
                  {item.label}
                </button>
              ))}
            </div>

            <label className="youtube-generator__field">
              <span>Vehicle</span>
              <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
                {productVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicleRegistration(vehicle)} - {vehicleTitle(vehicle)}
                  </option>
                ))}
              </select>
            </label>

            <div className="youtube-generator__controls-grid">
              <label className="youtube-generator__field">
                <span>Image source</span>
                <select value={imageSource} onChange={(event) => setImageSource(event.target.value)}>
                  {IMAGE_SOURCE_OPTIONS.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="youtube-generator__field">
                <span>Images</span>
                <select value={imageCount} onChange={(event) => setImageCount(Number(event.target.value))}>
                  {IMAGE_COUNT_OPTIONS.map((count) => (
                    <option key={count} value={count}>{count} images</option>
                  ))}
                </select>
              </label>
              <label className="youtube-generator__field">
                <span>Duration</span>
                <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                  {DURATION_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>{seconds} seconds</option>
                  ))}
                </select>
              </label>
              <label className="youtube-generator__field">
                <span>FPS</span>
                <select value={recordingFps} onChange={(event) => setRecordingFps(Number(event.target.value))}>
                  {FPS_OPTIONS.map((fps) => (
                    <option key={fps} value={fps}>{fps}fps</option>
                  ))}
                </select>
              </label>
              <label className="youtube-generator__field">
                <span>Visual template</span>
                <select value={visualTemplate} onChange={(event) => setVisualTemplate(event.target.value)}>
                  {VISUAL_TEMPLATES.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="youtube-generator__toggle">
              <input type="checkbox" checked={musicOn} onChange={(event) => setMusicOn(event.target.checked)} />
              <span>Music on</span>
            </label>
          </section>

          <section className="youtube-generator__section">
            <div className="youtube-generator__section-header">
              <h3>CMS / Wix Images</h3>
              <span>{cmsMatch ? `${cmsMatch.imageRecords.length} matched images` : "Registration first, then title"}</span>
            </div>
            <div className="youtube-generator__upload-row">
              <button type="button" className="youtube-generator__button youtube-generator__button--secondary" onClick={() => cmsInputRef.current?.click()}>
                Upload CMS File
              </button>
              <button type="button" className="youtube-generator__button youtube-generator__button--ghost" onClick={clearCmsUpload}>
                Clear CMS
              </button>
              <span>{cmsUpload ? `${cmsUpload.fileName} - ${cmsUpload.rows.length} rows` : "No CMS file loaded"}</span>
              <input ref={cmsInputRef} type="file" accept=".csv,.json,.txt" hidden onChange={handleCmsUpload} />
            </div>
            <div className="youtube-generator__thumbs">
              {resolvedImageOrder.records.slice(0, imageCount).map((item, index) => (
                <div key={`${item.url}-${index}`} className="youtube-generator__thumb">
                  <img src={item.url} alt={`YouTube image ${index + 1}`} />
                  <span>{index + 1}</span>
                </div>
              ))}
            </div>
            <div className="youtube-generator__note">
              Final image order: {resolvedImageOrder.records.length} image{resolvedImageOrder.records.length === 1 ? "" : "s"}
              {resolvedImageOrder.dedupeHappened ? " after dedupe." : "."}
            </div>
            <div className={hasEnoughImages ? "youtube-generator__status" : "youtube-generator__error"}>
              {imageAvailabilityText}
            </div>
          </section>

          <section className="youtube-generator__section">
            <div className="youtube-generator__section-header">
              <h3>Text Controls</h3>
              <span>{textMode === "default" ? "Saved defaults" : "Manual current video"}</span>
            </div>
            <div className="youtube-generator__segment">
              {["default", "manual"].map((mode) => (
                <button key={mode} type="button" className={textMode === mode ? "is-active" : ""} onClick={() => handleTextModeChange(mode)}>
                  {mode === "default" ? "Default Mode" : "Manual Mode"}
                </button>
              ))}
            </div>
            <div className="youtube-generator__text-grid">
              <label className="youtube-generator__field">
                <span>Default Header</span>
                <input value={activeText.header} onChange={(event) => updateActiveText("header", event.target.value)} />
              </label>
              <label className="youtube-generator__field">
                <span>Top Display Text</span>
                <input value={activeText.topText || ""} onChange={(event) => updateActiveText("topText", event.target.value)} />
              </label>
              <label className="youtube-generator__field">
                <span>Default Hook</span>
                <input value={activeText.hook} onChange={(event) => updateActiveText("hook", event.target.value)} />
              </label>
              <label className="youtube-generator__field">
                <span>Default Support Line</span>
                <input value={activeText.support} onChange={(event) => updateActiveText("support", event.target.value)} />
              </label>
              <label className="youtube-generator__field">
                <span>Default CTA</span>
                <input value={activeText.cta} onChange={(event) => updateActiveText("cta", event.target.value)} />
              </label>
            </div>
            <div className="youtube-generator__frame-text">
              <div className="youtube-generator__section-header">
                <h4>Frame Text Controls</h4>
                <span>
                  {selectedFrameSpecs.length} frame{selectedFrameSpecs.length === 1 ? "" : "s"}
                </span>
              </div>
              {selectedFrameSpecs.map((frameSpec) => {
                const frameIndex = frameSpec.frameIndex;
                const locked = frameSpec.locked;
                const displaySpec = frameSpec.display;
                return (
                  <details key={`youtube-frame-text-${frameIndex}`} className={`youtube-generator__frame-card${locked ? " is-locked" : ""}`} open={frameIndex === 0}>
                    <summary className="youtube-generator__frame-card-title">
                      <strong>
                        Frame {frameSpec.frameNumber}
                        {locked ? " (Locked)" : ""}
                      </strong>
                      <span>
                        {frameSpec.type === "finalCta"
                          ? "Final CTA frame"
                          : locked
                            ? "System frame - auto-filled from vehicle data"
                            : "Editable text block"}
                      </span>
                    </summary>
                    {locked ? (
                      <div className="youtube-generator__locked-grid">
                        <span><b>Eyebrow / Label</b>{displaySpec.eyebrow || "Blank"}</span>
                        <span><b>Headline</b>{displaySpec.headline || "Blank"}</span>
                        <span><b>Support Line</b>{displaySpec.subline || "Blank"}</span>
                        <span><b>CTA / Button Text</b>{displaySpec.cta || "Blank"}</span>
                      </div>
                    ) : (
                      <div className="youtube-generator__frame-grid">
                        {FRAME_TEXT_FIELDS.map(([field, label]) => (
                          <label key={field} className="youtube-generator__field">
                            <span>{label}</span>
                            <input value={frameSpec.text?.[field] || ""} onChange={(event) => updateActiveFrameText(frameIndex, field, event.target.value)} />
                          </label>
                        ))}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
            <div className="youtube-generator__actions youtube-generator__actions--compact">
              <button type="button" className="youtube-generator__button youtube-generator__button--secondary" onClick={saveTextDefaults}>
                Save {product.label} Defaults
              </button>
            </div>
          </section>

          <section className="youtube-generator__section">
            <div className="youtube-generator__section-header">
              <h3>YouTube Queue</h3>
              <span>{activeQueue.length} queued for {product.label}</span>
            </div>
            <div className="youtube-generator__actions youtube-generator__actions--compact">
              <button type="button" className="youtube-generator__button youtube-generator__button--secondary" onClick={addSelectedToQueue} disabled={!hasEnoughImages}>
                Add Current Vehicle
              </button>
              <button type="button" className="youtube-generator__button youtube-generator__button--ghost" onClick={clearQueue} disabled={!activeQueue.length || queueRunning}>
                Clear Queue
              </button>
            </div>
            {activeQueue.length ? (
              <div className="youtube-generator__queue-list">
                {activeQueue.map((vehicle) => {
                  const queuedOrder = resolveImageOrderForVehicle(vehicle);
                  const queuedEnough = queuedOrder.records.length >= imageCount;
                  return (
                    <div key={`${vehicle.id || ""}-${vehicleRegistration(vehicle) || vehicleTitle(vehicle)}`} className="youtube-generator__queue-card">
                      <div>
                        <strong>{vehicleRegistration(vehicle) || "NO REG"}</strong>
                        <span>{vehicleTitle(vehicle)}</span>
                        <small className={queuedEnough ? "" : "is-warning"}>
                          {queuedOrder.records.length} / {imageCount} images available
                        </small>
                      </div>
                      <button type="button" className="youtube-generator__button youtube-generator__button--ghost" onClick={() => removeQueueItem(vehicle)} disabled={queueRunning}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="youtube-generator__note">No vehicles queued for {product.label}.</div>
            )}
            <div className="youtube-generator__status">
              {queueProgress.message} | {queueProgress.completed} complete | {queueProgress.failed} failed
            </div>
            {queueFailures.length ? (
              <div className="youtube-generator__error">
                <strong>Queue issues</strong>
                {queueFailures.slice(0, 8).map((item, index) => (
                  <div key={`${item}-${index}`}>{item}</div>
                ))}
                {queueFailures.length > 8 ? <div>...and {queueFailures.length - 8} more.</div> : null}
              </div>
            ) : null}
            <div className="youtube-generator__actions">
              <button type="button" className="youtube-generator__button youtube-generator__button--secondary" onClick={generateCurrentQueuedShort} disabled={!activeQueue.length || queueRunning}>
                Generate Current Queued Short
              </button>
              <button type="button" className="youtube-generator__button youtube-generator__button--primary" onClick={runQueue} disabled={!activeQueue.length || queueRunning}>
                Auto Generate + Download Queue
              </button>
              {queueRunning ? (
                <button type="button" className="youtube-generator__button youtube-generator__button--ghost" onClick={cancelQueue}>
                  Cancel Queue
                </button>
              ) : null}
            </div>
          </section>

          <section className="youtube-generator__section">
            <div className="youtube-generator__actions">
              <button type="button" className="youtube-generator__button youtube-generator__button--primary" onClick={handleGenerate} disabled={!hasEnoughImages}>
                Generate Preview
              </button>
              <button type="button" className="youtube-generator__button youtube-generator__button--secondary" onClick={handleDownloadMp4}>
                Download MP4
              </button>
              {currentAsset?.blob ? (
                <button type="button" className="youtube-generator__button youtube-generator__button--ghost" onClick={handleDownloadWebm}>
                  Download WebM fallback
                </button>
              ) : null}
            </div>
            {status ? <div className="youtube-generator__status">{status}</div> : null}
            {error || vehiclesError ? <div className="youtube-generator__error">{error || vehiclesError}</div> : null}
          </section>
        </div>

        <div className="youtube-generator__preview-panel">
          <div className="youtube-generator__phone">
            {currentAsset?.url ? (
              <video className="youtube-generator__video" src={currentAsset.url} controls playsInline />
            ) : (
              <div className={`youtube-generator__poster youtube-generator__poster--${productKey === "rent2buy" ? "rent" : "finance"}`}>
                {resolvedImages[0] ? <img src={resolvedImages[0]} alt="Selected vehicle preview" /> : null}
                <div className="youtube-generator__poster-copy">
                  <span>{activeText.header}</span>
                  <strong>{activeText.hook}</strong>
                  <small>{activeText.support}</small>
                </div>
              </div>
            )}
          </div>
          <div className="youtube-generator__safety">
            Preview/download only. No posting queue, Creative Library, Supabase tracking, stock records, or Reel Lab output is changed.
          </div>
          <div className="youtube-generator__copy">
            <strong>{product.label} wording preview</strong>
            <p>{activeText.header}</p>
            <p>{activeText.hook}</p>
            <p>{activeText.support}</p>
            <p>{activeText.cta}</p>
            <p>{product.domain}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
