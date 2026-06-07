import { useEffect, useMemo, useRef, useState } from "react";

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;
const REEL_FPS = 30;
const REEL_DURATION_SECONDS = 10;
const MAX_UPLOADS = 10;
const CANVAS_FONT = "'Inter', 'Aptos', 'Segoe UI', Arial, sans-serif";

const PRODUCTS = {
  vanFinance: {
    label: "Van Finance",
    brand: "Van Finance Company",
    accent: "#ef233c",
    deep: "#090b10",
    hook: "FROM \u00a399 DEPOSIT",
    finalCta: "APPLY NOW",
    destinationUrl: "https://www.vanfinancecompany.co.uk/",
    templateStyles: ["Premium Stock Card", "Finance Offer", "Vehicle Spotlight"],
    ctas: ["View This Van", "Check Monthly Payments", "Apply For Finance"],
    usps: ["From £99 Deposit", "All Credit Profiles Considered", "Low Deposit Options", "Free UK Delivery", "200+ Vans In Stock"],
  },
  rent2buy: {
    label: "Rent2Buy",
    brand: "Rent2Buy Vans",
    accent: "#ef233c",
    deep: "#080808",
    hook: "NO CREDIT CHECK",
    finalCta: "CHECK IF YOU QUALIFY",
    destinationUrl: "https://www.rent2buyvans.co.uk/",
    templateStyles: ["No Credit Check", "Rent It Drive It Own It", "Vehicle Spotlight"],
    ctas: ["Check If You Qualify", "View Rent2Buy Vans", "Start Application"],
    usps: ["No Credit Check", "Rent It", "Drive It", "Own It", "Final Payment - It's Yours", "Apply in 60 Seconds"],
  },
};

const IMAGE_SOURCE_OPTIONS = [
  ["stock", "Stock image only"],
  ["upload", "Manual upload"],
  ["page", "CMS / first 5 van page images"],
  ["auto", "Auto: Uploaded > CMS > Van Page > Stock"],
];

const VISUAL_TEMPLATES = [
  ["blackPremium", "Black Premium Showcase"],
  ["tiktokPunch", "TikTok Punch Showcase"],
  ["luxuryDealer", "Luxury Dealer Showcase"],
];

const VISUAL_TEMPLATE_CONFIG = {
  blackPremium: {
    label: "Black Premium Showcase",
    imageArea: { x: 50, y: 216, width: REEL_WIDTH - 100, height: 880 },
    textY: 1164,
    headlineHook: 86,
    headline: 62,
    cta: 74,
    panel: false,
    sweepAlpha: 0.28,
    flash: 0.08,
    zoom: 0.004,
    punch: 0.012,
  },
  tiktokPunch: {
    label: "TikTok Punch Showcase",
    imageArea: { x: 42, y: 210, width: REEL_WIDTH - 84, height: 900 },
    textY: 1152,
    headlineHook: 96,
    headline: 68,
    cta: 82,
    panel: false,
    sweepAlpha: 0.42,
    flash: 0.18,
    zoom: 0.006,
    punch: 0.026,
  },
  luxuryDealer: {
    label: "Luxury Dealer Showcase",
    imageArea: { x: 70, y: 230, width: REEL_WIDTH - 140, height: 842 },
    textY: 1168,
    headlineHook: 76,
    headline: 56,
    cta: 68,
    panel: true,
    sweepAlpha: 0.18,
    flash: 0.05,
    zoom: 0.002,
    punch: 0.006,
  },
};

const DEFAULT_HOOKS = {
  vanFinance: "FROM \u00a399 DEPOSIT",
  rent2buy: "NO CREDIT CHECK",
};

const DEFAULT_SUPPORT_LINES = {
  vanFinance: "ALL CREDIT PROFILES CONSIDERED",
  rent2buy: "APPLY IN MINUTES",
};

const DEFAULT_BRAND_HEADERS = {
  vanFinance: PRODUCTS.vanFinance.brand,
  rent2buy: PRODUCTS.rent2buy.brand,
};

function cleanText(value) {
  return String(value || "").replace(/\u00c2\u00a3/g, "\u00a3").replace(/\s+/g, " ").trim();
}

function safeFilePart(value) {
  return cleanText(value)
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "reel-lab";
}

function vehicleRegistration(vehicle) {
  return cleanText(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name).toUpperCase().replace(/\s+/g, "");
}

function vehicleTitle(vehicle) {
  return cleanText(vehicle?.vanDescription || vehicle?.description || vehicle?.title || vehicle?.name || vehicleRegistration(vehicle) || "Selected vehicle");
}

function vehicleImage(vehicle) {
  return cleanText(vehicle?.image || vehicle?.picture || vehicle?.mainImage || "");
}

function vehiclePageUrl(vehicle) {
  return cleanText(vehicle?.link || vehicle?.weblink || vehicle?.webLink || vehicle?.stockUrl || vehicle?.url || "");
}

function vehiclePriceLine(vehicle, productKey) {
  if (productKey === "rent2buy") {
    return cleanText(vehicle?.monthly || vehicle?.week || vehicle?.initialRental || "Flexible Rent2Buy options");
  }
  return cleanText(vehicle?.monthly || vehicle?.salePrice || vehicle?.price || "Finance monthly options available");
}

function vehicleCashPriceLine(vehicle) {
  const rawPrice = cleanText(vehicle?.price || vehicle?.cashPrice || vehicle?.cash_price || "");
  if (!rawPrice || /\bp\/m\b|per\s+month|monthly|deposit/i.test(rawPrice)) return "";
  const vatText = cleanText(vehicle?.vat || vehicle?.VAT || vehicle?.priceVat || vehicle?.price_vat || "");
  const priceHasVat = /\+?\s*vat\b/i.test(rawPrice);
  const vatApplies = priceHasVat
    || /\+?\s*vat\b/i.test(vatText)
    || vatText === "true"
    || vatText === "1"
    || vatText.toLowerCase() === "yes";
  return `${rawPrice}${vatApplies && !priceHasVat ? " + VAT" : ""}`;
}

function vehicleMileageLine(vehicle) {
  const rawMileage = cleanText(vehicle?.mileage || vehicle?.miles || vehicle?.odometer || vehicle?.mileageText || "");
  if (!rawMileage) return "";
  if (/mile/i.test(rawMileage)) return rawMileage.toUpperCase();
  const numeric = Number(String(rawMileage).replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return `${Math.round(numeric).toLocaleString("en-GB")} MILES`;
  return rawMileage.toUpperCase();
}

function financeBuyLine(vehicle) {
  const price = vehiclePriceLine(vehicle, "vanFinance")
    .replace(/^from\s+/i, "")
    .replace(/\bp\/m\b/i, "per month")
    .trim();
  return price ? `PURCHASE THIS VAN FROM ONLY ${price.toUpperCase()}` : "PURCHASE THIS VAN WITH FLEXIBLE FINANCE";
}

function displayDomain(url) {
  try {
    return new URL(url).hostname.replace(/^vanfinancecompany\.co\.uk$/i, "www.vanfinancecompany.co.uk");
  } catch {
    return cleanText(url).replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
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

function buildOrderedImageRecords(records) {
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
    ordered.push({
      url,
      source: cleanText(record?.source || "stock image"),
    });
  });

  return {
    records: ordered.slice(0, 5),
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

function extractRegistrationFromText(value) {
  const text = cleanText(value).toUpperCase();
  const explicitMatch = text.match(/(?:REG(?:ISTRATION)?|VRM|NUMBER\s*PLATE|PLATE)\s*[:#-]?\s*([A-Z]{2}\s?\d{2}\s?[A-Z]{3})/i);
  if (explicitMatch) return explicitMatch[1].replace(/\s+/g, "");
  const looseMatch = text.match(/\b[A-Z]{2}\s?\d{2}\s?[A-Z]{3}\b/);
  return looseMatch ? looseMatch[0].replace(/\s+/g, "") : "";
}

function getCmsField(source, keyPatterns) {
  const entry = Object.entries(source || {}).find(([key]) => {
    const normalKey = normalizeCmsKey(key);
    return keyPatterns.some((pattern) => pattern.test(normalKey));
  });
  return entry ? entry[1] : "";
}

function normalizeCmsImageUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  const wixMatch = text.match(/^(?:wix:)?image:\/\/v1\/([^/#?]+)/i);
  if (wixMatch) return `https://static.wixstatic.com/media/${wixMatch[1]}`;
  if (/^\/\/static\.wixstatic\.com\//i.test(text)) return `https:${text}`;
  return text;
}

function isLikelyCmsImageUrl(value) {
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
      matches
        .map((url) => normalizeCmsImageUrl(url))
        .filter(isLikelyCmsImageUrl)
        .forEach((url) => urls.push(url));
      return;
    }
    if (/^wix:image:\/\//i.test(text) || /^image:\/\//i.test(text) || /static\.wixstatic\.com\/media\//i.test(text)) {
      urls.push(text);
    }
  };

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "object" && item) {
        addUrl(item.url || item.src || item.fileUrl || item.image || item.uri);
      } else {
        addUrl(item);
      }
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

function normalizeCmsRow(row, index = 0) {
  const source = row || {};
  const explicitReg = getCmsField(source, [
    /^reg$/,
    /^registration/,
    /vrm/,
    /numberplate/,
    /licenceplate/,
    /licenseplate/,
  ]);
  const rowText = Object.values(source).map((value) => (typeof value === "string" ? value : JSON.stringify(value || ""))).join(" ");
  const registration = vehicleRegistration({ reg: explicitReg }) || extractRegistrationFromText(rowText);
  const title = cleanText(
    getCmsField(source, [/^title$/, /^name$/, /vehicletitle/, /^vehicle$/, /description/, /vandescription/, /makemodel/])
  );
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

  const imageRecords = buildOrderedImageRecords(
    imageValues.map((url, imageIndex) => ({ url, source: `CMS upload image ${imageIndex + 1}` }))
  ).records;

  return {
    id: `cms-${index}`,
    registration,
    title,
    imageRecords,
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

function getProductVehicles(vehicles, productKey) {
  if (productKey === "rent2buy") {
    return (vehicles || [])
      .filter((vehicle) => vehicle?.rent2buyEligible || vehicle?.pipeline === "rent2buy")
      .map((vehicle) => {
        const rent = vehicle.rent2buyData || {};
        const image = vehicleImage(rent) || vehicleImage(vehicle);
        return {
          ...vehicle,
          ...rent,
          id: vehicle.id,
          image,
          picture: image,
          pipeline: "rent2buy",
        };
      });
  }

  return (vehicles || []).map((vehicle) => ({
    ...vehicle,
    pipeline: "vanFinance",
  }));
}

function imageSourceLabel(value) {
  return IMAGE_SOURCE_OPTIONS.find(([key]) => key === value)?.[1] || "Stock image only";
}

function createCaption({ productKey, vehicle, cta }) {
  const product = PRODUCTS[productKey];
  const reg = vehicleRegistration(vehicle);
  const title = vehicleTitle(vehicle);

  if (productKey === "rent2buy") {
    return `${product.brand}
${title}

No credit check. Rent it, drive it, own it.
${cta}
${product.destinationUrl}`;
  }

  return `${product.brand}
${title}

From £99 deposit. All credit profiles considered. Low deposit options.
${cta}
${vehiclePageUrl(vehicle) || product.destinationUrl}${reg ? `?reg=${encodeURIComponent(reg)}` : ""}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load reel image."));
    image.src = src;
  });
}

function drawCoverImage(ctx, image, x, y, width, height, zoom = 1, panX = 0, panY = 0) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2 + panX;
  const drawY = y + (height - drawHeight) / 2 + panY;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
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
  const drawX = x + (width - drawWidth) / 2 + safePanX;
  const drawY = y + (height - drawHeight) / 2 + safePanY;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
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

function drawFitText(ctx, text, x, y, maxWidth, maxFontSize, minFontSize, fontWeight = 900) {
  const clean = cleanText(text);
  let fontSize = maxFontSize;
  while (fontSize > minFontSize) {
    ctx.font = `${fontWeight} ${fontSize}px ${CANVAS_FONT}`;
    if (ctx.measureText(clean).width <= maxWidth) break;
    fontSize -= 2;
  }
  ctx.fillText(clean, x, y);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
}

function easeInOut(value) {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function stagedOpacity(elapsedSeconds, start, end) {
  if (elapsedSeconds <= start) return 0;
  if (elapsedSeconds >= end) return 1;
  return easeOutCubic((elapsedSeconds - start) / (end - start));
}

function fadeOut(elapsedSeconds, start, end) {
  if (elapsedSeconds <= start) return 1;
  if (elapsedSeconds >= end) return 0;
  return 1 - easeInOut((elapsedSeconds - start) / (end - start));
}

function getFrameTiming(elapsedSeconds) {
  const firstFrameDuration = 2.5;
  const remainingFrameDuration = (REEL_DURATION_SECONDS - firstFrameDuration) / 4;
  if (elapsedSeconds < firstFrameDuration) {
    return {
      frameIndex: 0,
      frameProgress: Math.min(1, elapsedSeconds / firstFrameDuration),
    };
  }
  const remainingElapsed = Math.min(REEL_DURATION_SECONDS - firstFrameDuration, elapsedSeconds - firstFrameDuration);
  const frameIndex = Math.min(4, 1 + Math.floor(remainingElapsed / remainingFrameDuration));
  const frameStart = firstFrameDuration + (frameIndex - 1) * remainingFrameDuration;
  return {
    frameIndex,
    frameProgress: Math.min(1, (elapsedSeconds - frameStart) / remainingFrameDuration),
  };
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  drawRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function getFrameSpec(productKey, vehicle, frameIndex, hookText, supportText, ctaText) {
  const price = vehiclePriceLine(vehicle, productKey);
  const cashPrice = vehicleCashPriceLine(vehicle);
  const mileage = vehicleMileageLine(vehicle);
  const title = vehicleTitle(vehicle);
  const hook = cleanText(hookText) || DEFAULT_HOOKS[productKey];
  const support = cleanText(supportText) || DEFAULT_SUPPORT_LINES[productKey];
  const finalCta = cleanText(ctaText) || PRODUCTS[productKey].finalCta;
  const finalButton = PRODUCTS[productKey].finalCta;
  const finalDomain = displayDomain(PRODUCTS[productKey].destinationUrl);

  if (productKey === "rent2buy") {
    return [
      { kind: "hook", eyebrow: "RENT2BUY VANS", headline: hook, subline: support },
      { kind: "details", eyebrow: "SELECTED VAN", headline: title, subline: "HUGE SELECTION OF VANS IN STOCK TO CHOOSE FROM" },
      { kind: "statement", eyebrow: "SIMPLE VAN OWNERSHIP", headline: "RENT IT - DRIVE IT - OWN IT", subline: vehicleRegistration(vehicle) },
      { kind: "statement", eyebrow: "RENT2BUY", headline: "FINAL PAYMENT IT'S YOURS", subline: support },
      { kind: "cta", eyebrow: "APPLY TODAY", headline: finalCta, buttonLabel: finalButton, subline: finalDomain },
    ][frameIndex];
  }

  return [
    { kind: "hook", eyebrow: "VAN FINANCE COMPANY", headline: hook, subline: support },
    { kind: "details", eyebrow: "SELECTED VAN", headline: cashPrice ? `${cashPrice} | ${title}` : title, subline: mileage || "CHOOSE FROM OVER 200 VANS IN STOCK" },
    { kind: "statement", eyebrow: "MONTHLY PAYMENTS", headline: financeBuyLine(vehicle), subline: "FROM AS LITTLE AS \u00a399 DEPOSIT" },
    { kind: "statement", eyebrow: "VAN FINANCE", headline: support, subline: "NO.1 VAN FINANCE COMPANY IN THE UK" },
    { kind: "cta", eyebrow: "APPLY TODAY", headline: finalCta, buttonLabel: finalButton, subline: finalDomain },
  ][frameIndex];
}

function drawLightSweep(ctx, x, y, width, height, progress, alpha = 0.35) {
  const sweepX = x - width * 0.45 + progress * width * 1.9;
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

function drawRedStreak(ctx, progress) {
  const x = -280 + progress * (REEL_WIDTH + 560);
  const gradient = ctx.createLinearGradient(x, 0, x + 280, 0);
  gradient.addColorStop(0, "rgba(239,35,60,0)");
  gradient.addColorStop(0.48, "rgba(239,35,60,0.56)");
  gradient.addColorStop(1, "rgba(239,35,60,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.translate(x, 0);
  ctx.rotate(-0.18);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 1110, 360, 92);
  ctx.restore();
}

function drawTopBrandHeader(ctx, product, visualTemplate, imageArea, brandHeaderText) {
  const isLuxury = visualTemplate === "luxuryDealer";
  const isTikTok = visualTemplate === "tiktokPunch";
  const headerY = 56;
  const headerHeight = 150;
  const gradient = ctx.createLinearGradient(imageArea.x, headerY, imageArea.x + imageArea.width, headerY + headerHeight);
  gradient.addColorStop(0, isLuxury ? "rgba(255,255,255,0.08)" : "rgba(239,35,60,0.18)");
  gradient.addColorStop(0.32, "rgba(10,10,12,0.94)");
  gradient.addColorStop(1, isTikTok ? "rgba(239,35,60,0.28)" : "rgba(0,0,0,0.96)");

  ctx.save();
  ctx.shadowColor = isLuxury ? "rgba(255,255,255,0.12)" : "rgba(239,35,60,0.34)";
  ctx.shadowBlur = isTikTok ? 36 : 22;
  ctx.shadowOffsetY = 10;
  fillRoundRect(ctx, imageArea.x, headerY, imageArea.width, headerHeight, isLuxury ? 18 : 24, gradient);
  ctx.shadowBlur = 0;
  ctx.fillStyle = product.accent;
  ctx.fillRect(imageArea.x, headerY + headerHeight - 8, imageArea.width, 8);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `${isLuxury ? 900 : 980} ${isTikTok ? 68 : 62}px ${CANVAS_FONT}`;
  drawFitText(ctx, cleanText(brandHeaderText || product.brand).toUpperCase(), REEL_WIDTH / 2, headerY + 94, imageArea.width - 86, isTikTok ? 68 : 62, 42);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawBottomTextFrame(ctx, product, productKey, spec, frameProgress, frameIndex, visualTemplate, textX, textY, textWidth) {
  const config = VISUAL_TEMPLATE_CONFIG[visualTemplate] || VISUAL_TEMPLATE_CONFIG.blackPremium;
  const isTikTok = visualTemplate === "tiktokPunch";
  const isLuxury = visualTemplate === "luxuryDealer";
  const isHook = spec.kind === "hook";
  const isCta = spec.kind === "cta";
  const isStatement = spec.kind === "statement";
  const enterBase = easeOutCubic(Math.min(1, frameProgress / (isTikTok ? 0.16 : isLuxury ? 0.36 : 0.24)));
  const enter = isHook && frameIndex === 0 ? Math.max(0.9, enterBase) : enterBase;
  const slideY = (1 - enter) * (isTikTok ? 96 : isLuxury ? 42 : 74);
  const glowPulse = 0.72 + Math.sin(frameProgress * Math.PI * (isTikTok ? 4 : 2)) * (isTikTok ? 0.22 : 0.1);
  const punch = isHook ? 1 + Math.sin(Math.min(1, frameProgress / 0.32) * Math.PI) * config.punch : 1;
  const headlineSize = isHook ? config.headlineHook : isCta ? config.cta : config.headline;

  ctx.save();
  ctx.translate(0, slideY);
  ctx.globalAlpha = enter;

  if (config.panel) {
    const panelGradient = ctx.createLinearGradient(textX, textY - 18, textX, REEL_HEIGHT - 230);
    panelGradient.addColorStop(0, "rgba(16,16,20,0.58)");
    panelGradient.addColorStop(1, "rgba(0,0,0,0.92)");
    fillRoundRect(ctx, textX - 8, textY - 28, textWidth + 16, 422, 30, panelGradient);
  }

  ctx.shadowColor = `rgba(239,35,60,${isTikTok ? 0.62 * glowPulse : isLuxury ? 0.22 * glowPulse : 0.38 * glowPulse})`;
  ctx.shadowBlur = isTikTok ? 58 : isLuxury ? 22 : 42;
  ctx.fillStyle = isLuxury ? "rgba(255,255,255,0.68)" : product.accent;
  ctx.font = `${isLuxury ? 800 : 900} ${isLuxury ? 24 : 27}px ${CANVAS_FONT}`;
  ctx.fillText(spec.eyebrow, textX + 28, textY + 36);

  ctx.save();
  if (punch !== 1) {
    ctx.translate(REEL_WIDTH / 2, textY + 150);
    ctx.scale(punch, punch);
    ctx.translate(-REEL_WIDTH / 2, -(textY + 150));
  }
  ctx.shadowColor = "rgba(0,0,0,0.64)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  ctx.font = `${isLuxury ? 850 : 950} ${headlineSize}px ${CANVAS_FONT}`;
  if (spec.kind === "details") {
    wrapText(ctx, spec.headline, textX + 28, textY + 128, textWidth - 56, isLuxury ? 62 : 70, 2);
  } else {
    wrapText(ctx, spec.headline, textX + 28, textY + 150, textWidth - 56, isHook ? headlineSize + 6 : headlineSize + 8, 2);
  }
  ctx.restore();

  if (isCta) {
    const buttonY = textY + (isLuxury ? 292 : 306);
    const domainY = buttonY + (isLuxury ? 178 : 196);
    fillRoundRect(ctx, textX + 28, buttonY, textWidth - 56, isLuxury ? 88 : 98, isLuxury ? 22 : 30, product.accent);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `${isLuxury ? 850 : 950} ${isLuxury ? 38 : 42}px ${CANVAS_FONT}`;
    drawFitText(ctx, spec.buttonLabel || product.finalCta, REEL_WIDTH / 2, buttonY + (isLuxury ? 56 : 62), textWidth - 116, isLuxury ? 38 : 42, 29);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${isLuxury ? 850 : 900} ${isLuxury ? 38 : 40}px ${CANVAS_FONT}`;
    drawFitText(ctx, spec.subline, REEL_WIDTH / 2, domainY, textWidth - 100, isLuxury ? 38 : 40, 27);
    ctx.textAlign = "left";
  } else {
    ctx.shadowBlur = 0;
    ctx.fillStyle = isLuxury ? "rgba(255,255,255,0.70)" : isStatement ? "rgba(255,255,255,0.86)" : "rgba(255,255,255,0.74)";
    ctx.font = `${isLuxury ? 700 : 850} ${isHook ? 34 : 31}px ${CANVAS_FONT}`;
    wrapText(ctx, spec.subline, textX + 30, textY + 316, textWidth - 60, 40, 2);
  }

  if (isHook || isStatement || isCta) {
    drawLightSweep(ctx, textX, textY + 68, textWidth, 184, Math.min(1, frameProgress * (isTikTok ? 1.8 : 1.15)), config.sweepAlpha);
  }
  if (isTikTok && frameProgress < 0.22 && frameIndex > 0) drawRedStreak(ctx, frameProgress / 0.22);
  ctx.restore();
}

function drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, brandHeaderText, hookText, supportText, ctaText, elapsedSeconds }) {
  const product = PRODUCTS[productKey];
  const config = VISUAL_TEMPLATE_CONFIG[visualTemplate] || VISUAL_TEMPLATE_CONFIG.blackPremium;
  const isLuxury = visualTemplate === "luxuryDealer";
  const isTikTok = visualTemplate === "tiktokPunch";
  const images = loadedImages.length ? loadedImages : [];
  const { frameIndex, frameProgress } = getFrameTiming(elapsedSeconds);
  const image = images[Math.min(frameIndex, images.length - 1)] || images[0];
  const imageArea = config.imageArea;
  const textX = 68;
  const textY = config.textY;
  const textWidth = REEL_WIDTH - 136;
  const containScale = 0.988 + (frameIndex === 0 ? Math.sin(Math.min(1, frameProgress / 0.22) * Math.PI) * config.punch : Math.sin(frameProgress * Math.PI) * config.zoom);
  const panX = frameProgress < 0.18 && frameIndex > 0 ? (1 - frameProgress / 0.18) * (isTikTok ? 18 : 8) : 0;
  const panY = 0;

  ctx.clearRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  if (isLuxury) {
    const bg = ctx.createLinearGradient(0, 0, 0, REEL_HEIGHT);
    bg.addColorStop(0, "#08080a");
    bg.addColorStop(0.56, "#000000");
    bg.addColorStop(1, "#120507");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  }

  drawTopBrandHeader(ctx, product, visualTemplate, imageArea, brandHeaderText);

  if (image) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    drawCoverImage(ctx, image, 0, 0, REEL_WIDTH, REEL_HEIGHT, 1.03, 0, 0);
    ctx.fillStyle = isLuxury ? "rgba(0,0,0,0.78)" : "rgba(0,0,0,0.70)";
    ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = isLuxury ? "rgba(255,255,255,0.10)" : "rgba(239,35,60,0.18)";
    ctx.shadowBlur = isLuxury ? 24 : isTikTok ? 58 : 42;
    ctx.shadowOffsetY = isLuxury ? 10 : 16;
    drawRoundRect(ctx, imageArea.x, imageArea.y, imageArea.width, imageArea.height, 30);
    ctx.clip();
    ctx.fillStyle = "#050505";
    ctx.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);
    drawContainImage(ctx, image, imageArea.x, imageArea.y, imageArea.width, imageArea.height, containScale, panX, panY);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  drawRoundRect(ctx, imageArea.x, imageArea.y, imageArea.width, imageArea.height, 30);
  ctx.stroke();
  ctx.restore();

  const lowerGlow = ctx.createRadialGradient(REEL_WIDTH / 2, 1340, 60, REEL_WIDTH / 2, 1340, 620);
  lowerGlow.addColorStop(0, `rgba(239,35,60,${isTikTok ? 0.30 : isLuxury ? 0.10 : 0.18})`);
  lowerGlow.addColorStop(1, "rgba(239,35,60,0)");
  ctx.fillStyle = lowerGlow;
  ctx.fillRect(0, 1030, REEL_WIDTH, 660);

  const flashAlpha = frameProgress < 0.08 && frameIndex > 0 ? (1 - frameProgress / 0.08) * config.flash : 0;
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
    ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  }

  const spec = getFrameSpec(productKey, vehicle, frameIndex, hookText, supportText, ctaText);
  drawBottomTextFrame(ctx, product, productKey, spec, frameProgress, frameIndex, visualTemplate, textX, textY, textWidth);
}

async function generateReelLabAsset({ productKey, vehicle, visualTemplate, brandHeaderText, hookText, supportText, ctaText, imageUrls, onProgress }) {
  if (typeof HTMLCanvasElement === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record Reel Lab videos.");
  }

  const supportedMime =
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  if (!supportedMime) throw new Error("This browser cannot record WebM video.");

  onProgress?.("Loading images");
  const loadedImages = [];
  for (const url of imageUrls.filter(Boolean)) {
    try {
      loadedImages.push(await loadImage(url));
    } catch {
      // Ignore failed optional images.
    }
  }
  if (!loadedImages.length) throw new Error("No usable image is available for this reel.");

  const canvas = document.createElement("canvas");
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create Reel Lab canvas.");

  const stream = canvas.captureStream(REEL_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: supportedMime });
  const chunks = [];
  let timer = 0;

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onerror = (event) => reject(event?.error || new Error("Reel Lab recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: supportedMime }));
  });

  const totalFrames = REEL_DURATION_SECONDS * REEL_FPS;
  let frame = 0;
  const render = () => {
    const elapsedSeconds = Math.min(REEL_DURATION_SECONDS, frame / REEL_FPS);
    drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, brandHeaderText, hookText, supportText, ctaText, elapsedSeconds });
    if (frame % 20 === 0) onProgress?.(`Rendering ${Math.round((frame / totalFrames) * 100)}%`);
    frame += 1;
    if (frame <= totalFrames) {
      timer = window.setTimeout(render, 1000 / REEL_FPS);
    } else if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start();
  render();

  try {
    const blob = await finished;
    const url = URL.createObjectURL(blob);
    return { blob, url, extension: "webm" };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function downloadMp4FromWebm(blob, filename) {
  const response = await fetch("/api/convert-reel-mp4", {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "video/webm",
      "X-Reel-Filename": filename,
    },
    body: blob,
  });

  if (!response.ok) {
    let message = "Could not convert Reel Lab video to MP4.";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch {}
    throw new Error(message);
  }

  const mp4Blob = await response.blob();
  const url = URL.createObjectURL(mp4Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchFirstFivePageImages({ productKey, vehicle }) {
  const pageUrl = vehiclePageUrl(vehicle);
  const params = new URLSearchParams({
    product: productKey,
    url: pageUrl,
    registration: vehicleRegistration(vehicle),
    title: vehicleTitle(vehicle),
  });

  const response = await fetch(`/api/reel-lab-page-images?${params.toString()}`);
  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(payload?.error || "Could not test selected van page images.");
  }

  return {
    images: Array.isArray(payload?.images) ? payload.images.slice(0, 5) : [],
    imageRecords: Array.isArray(payload?.imageRecords)
      ? payload.imageRecords.slice(0, 5)
      : Array.isArray(payload?.images)
        ? payload.images.slice(0, 5).map((url) => ({ url, source: "gallery/mainImages" }))
        : [],
    message: payload?.message || "",
    matchedRegistration: Boolean(payload?.matchedRegistration),
    matchedTitle: Boolean(payload?.matchedTitle),
    debug: payload?.debug || null,
    pageUrl: payload?.pageUrl || pageUrl,
    productLabel: payload?.productLabel || PRODUCTS[productKey]?.label || productKey,
  };
}

export default function ReelLabBetaPage({ vehicles = [], vehiclesLoading = false, vehiclesError = "" }) {
  const [productKey, setProductKey] = useState("vanFinance");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [imageSource, setImageSource] = useState("auto");
  const [visualTemplate, setVisualTemplate] = useState("blackPremium");
  const [brandHeaderByProduct, setBrandHeaderByProduct] = useState(DEFAULT_BRAND_HEADERS);
  const [hookByProduct, setHookByProduct] = useState(DEFAULT_HOOKS);
  const [supportByProduct, setSupportByProduct] = useState(DEFAULT_SUPPORT_LINES);
  const [uploadsByProduct, setUploadsByProduct] = useState({ vanFinance: [], rent2buy: [] });
  const [cmsUploadsByProduct, setCmsUploadsByProduct] = useState({ vanFinance: null, rent2buy: null });
  const [ctaByProduct, setCtaByProduct] = useState({
    vanFinance: PRODUCTS.vanFinance.finalCta,
    rent2buy: PRODUCTS.rent2buy.finalCta,
  });
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pageImageTests, setPageImageTests] = useState({ vanFinance: null, rent2buy: null });
  const fileInputRef = useRef(null);
  const cmsInputRef = useRef(null);
  const generationKeyRef = useRef("");

  const product = PRODUCTS[productKey];
  const productVehicles = useMemo(() => getProductVehicles(vehicles, productKey), [vehicles, productKey]);
  const selectedVehicle = useMemo(
    () => productVehicles.find((vehicle) => String(vehicle.id) === selectedVehicleId) || productVehicles[0] || null,
    [productVehicles, selectedVehicleId]
  );
  const uploadedImages = uploadsByProduct[productKey] || [];
  const cmsUpload = cmsUploadsByProduct[productKey] || null;
  const cmsMatch = selectedVehicle ? findCmsMatch(cmsUpload?.rows || [], selectedVehicle) : null;
  const stockImage = vehicleImage(selectedVehicle);
  const cta = ctaByProduct[productKey];
  const brandHeaderText = brandHeaderByProduct[productKey] || DEFAULT_BRAND_HEADERS[productKey];
  const hookText = hookByProduct[productKey] || DEFAULT_HOOKS[productKey];
  const supportText = supportByProduct[productKey] || DEFAULT_SUPPORT_LINES[productKey];
  const selectedVehicleKey = selectedVehicle ? `${productKey}:${selectedVehicle.id}:${vehicleRegistration(selectedVehicle)}` : "";
  const pageImageTest = pageImageTests[productKey]?.vehicleKey === selectedVehicleKey ? pageImageTests[productKey] : null;

  useEffect(() => {
    setSelectedVehicleId("");
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setError("");
    setStatus("");
  }, [productKey]);

  useEffect(() => {
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setStatus("");
    setError("");
  }, [selectedVehicleKey]);

  useEffect(() => {
    return () => {
      Object.values(uploadsByProduct).flat().forEach((item) => URL.revokeObjectURL(item.url));
      if (asset?.url) URL.revokeObjectURL(asset.url);
    };
  }, []);

  const resolvedImageOrder = useMemo(() => {
    const manualRecords = uploadedImages.map((item) => ({ url: item.url, source: "manual upload" }));
    const cmsRecords = Array.isArray(cmsMatch?.imageRecords)
      ? cmsMatch.imageRecords.map((item) => ({ url: item.url, source: item.source || `${product.label} CMS upload` }))
      : [];
    const pageRecords = Array.isArray(pageImageTest?.imageRecords)
      ? pageImageTest.imageRecords.map((item) => ({ url: item.url, source: item.source || "gallery/mainImages" }))
      : [];
    const stockRecord = stockImage ? [{ url: stockImage, source: "stock image" }] : [];

    if (imageSource === "upload") return buildOrderedImageRecords(manualRecords);
    if (imageSource === "page") return buildOrderedImageRecords(cmsRecords.length ? cmsRecords : pageRecords.length ? pageRecords : stockRecord);
    if (imageSource === "auto") {
      if (manualRecords.length) return buildOrderedImageRecords(manualRecords);
      if (cmsRecords.length) return buildOrderedImageRecords(cmsRecords);
      if (pageRecords.length) return buildOrderedImageRecords(pageRecords);
      return buildOrderedImageRecords(stockRecord);
    }
    return buildOrderedImageRecords(stockRecord);
  }, [cmsMatch, imageSource, pageImageTest, product.label, uploadedImages, stockImage]);
  const resolvedImages = resolvedImageOrder.records.map((item) => item.url);
  const currentPreviewKey = selectedVehicle ? `${selectedVehicleKey}:${visualTemplate}:${imageSource}:${brandHeaderText}:${hookText}:${supportText}:${cta}:${resolvedImages.join("|")}` : "";
  const currentAsset = asset?.previewKey === currentPreviewKey ? asset : null;

  useEffect(() => {
    generationKeyRef.current = currentPreviewKey;
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setStatus("");
    setError("");
  }, [currentPreviewKey]);

  const sourceNote =
    imageSource === "page"
      ? cmsMatch?.imageRecords?.length
        ? `Using ${product.label} CMS upload images in matched row order.`
        : pageImageTest?.imageRecords?.length
        ? "Using tested van page images in the exact returned order."
        : "Upload matching CMS rows or test first 5 van page images below. Stock image fallback is used until real ordered URLs are returned."
      : imageSource === "auto" && !uploadedImages.length
        ? cmsMatch?.imageRecords?.length
          ? `Auto is using matched ${product.label} CMS upload images because no manual uploads are present.`
          : pageImageTest?.imageRecords?.length
            ? "Auto is using tested van page images because no uploaded or CMS images are present."
            : "Auto is using stock image because no uploaded, CMS, or tested van page images are present."
        : "";

  function handleUploads(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    setUploadsByProduct((prev) => {
      const current = prev[productKey] || [];
      const remaining = Math.max(0, MAX_UPLOADS - current.length);
      const next = files.slice(0, remaining).map((file) => ({
        id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        url: URL.createObjectURL(file),
      }));
      return { ...prev, [productKey]: [...current, ...next] };
    });
    event.target.value = "";
  }

  function removeUpload(id) {
    setUploadsByProduct((prev) => {
      const current = prev[productKey] || [];
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return { ...prev, [productKey]: current.filter((item) => item.id !== id) };
    });
  }

  async function handleCmsUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCmsUploadText(text);
      setCmsUploadsByProduct((prev) => ({
        ...prev,
        [productKey]: {
          fileName: file.name,
          rows,
        },
      }));
      if (imageSource === "stock") setImageSource("auto");
      setStatus(`${product.label} CMS upload loaded: ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
      setError("");
    } catch (uploadError) {
      setError(uploadError.message || `Could not read ${product.label} CMS upload.`);
    } finally {
      event.target.value = "";
    }
  }

  function clearCmsUpload() {
    setCmsUploadsByProduct((prev) => ({ ...prev, [productKey]: null }));
  }

  async function handleTestPageImages() {
    setError("");
    if (!selectedVehicle) {
      setError("Select a vehicle before testing van page images.");
      return;
    }

    const vehicleKey = selectedVehicleKey;
    setPageImageTests((prev) => ({
      ...prev,
      [productKey]: {
        vehicleKey,
        status: "checking",
        message: "Checking selected van page for the first 5 images...",
        images: [],
        error: "",
      },
    }));

    try {
      const result = await fetchFirstFivePageImages({ productKey, vehicle: selectedVehicle });
      const images = result.images || [];
      const imageRecords = result.imageRecords || images.map((url) => ({ url, source: "gallery/mainImages" }));
      setPageImageTests((prev) => ({
        ...prev,
        [productKey]: {
          vehicleKey,
          status: images.length ? "found" : "empty",
          message: images.length
            ? `${images.length} van page image${images.length === 1 ? "" : "s"} found. Stock image fallback remains active for generation.`
            : "No van page images found -- stock image fallback will be used.",
          images,
          imageRecords,
          error: "",
          matchedRegistration: result.matchedRegistration,
          matchedTitle: result.matchedTitle,
          debug: result.debug,
          pageUrl: result.pageUrl,
          productLabel: result.productLabel,
        },
      }));
    } catch (pageImageError) {
      setPageImageTests((prev) => ({
        ...prev,
        [productKey]: {
          vehicleKey,
          status: "error",
          message: "Van page image test failed -- stock image fallback will be used.",
          images: [],
          error: pageImageError.message || "Could not test selected van page images.",
          debug: {
            selectedReg: vehicleRegistration(selectedVehicle),
            selectedTitle: vehicleTitle(selectedVehicle),
            selectedPageUrl: vehiclePageUrl(selectedVehicle),
            product: productKey,
          },
        },
      }));
    }
  }

  async function handleGenerate() {
    setError("");
    setStatus("");
    if (!selectedVehicle) {
      setError("Select a vehicle before generating a Reel Lab preview.");
      return;
    }
    if (!resolvedImages.length) {
      setError("No usable image is available. Select stock image or upload at least one image.");
      return;
    }
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    const renderPreviewKey = currentPreviewKey;
    generationKeyRef.current = renderPreviewKey;
    try {
      const nextAsset = await generateReelLabAsset({
        productKey,
        vehicle: selectedVehicle,
        visualTemplate,
        brandHeaderText,
        hookText,
        supportText,
        ctaText: cta,
        imageUrls: resolvedImages,
        onProgress: setStatus,
      });
      if (generationKeyRef.current !== renderPreviewKey) {
        URL.revokeObjectURL(nextAsset.url);
        return;
      }
      setAsset({ ...nextAsset, previewKey: renderPreviewKey });
      setStatus(`Preview ready for ${vehicleRegistration(selectedVehicle) || "selected vehicle"} using ${VISUAL_TEMPLATE_CONFIG[visualTemplate]?.label}.`);
    } catch (generationError) {
      setError(generationError.message || "Could not generate Reel Lab preview.");
      setStatus("");
    }
  }

  async function handleDownloadMp4() {
    setError("");
    if (!currentAsset?.blob) {
      setError("Generate a Reel Lab preview before downloading MP4.");
      return;
    }
    try {
      setStatus("Converting to MP4");
      const filename = `${safeFilePart(`${product.label}-${vehicleRegistration(selectedVehicle)}-${VISUAL_TEMPLATE_CONFIG[visualTemplate]?.label || visualTemplate}`)}.mp4`;
      await downloadMp4FromWebm(currentAsset.blob, filename);
      setStatus("MP4 downloaded.");
    } catch (downloadError) {
      setError(downloadError.message || "Could not download MP4.");
      setStatus("");
    }
  }

  return (
    <section className="reel-lab">
      <div className="page-header">
        <div>
          <span className="eyebrow">Safe beta tool</span>
          <h2>Reel Lab Beta</h2>
          <p>Preview and download test reels without posting, queueing, saving to Creative Library, or changing stock.</p>
        </div>
      </div>

      <div className="reel-lab__grid">
        <div className="reel-lab__panel">
          <div className="reel-lab__segment">
            {Object.entries(PRODUCTS).map(([key, item]) => (
              <button
                key={key}
                className={productKey === key ? "is-active" : ""}
                type="button"
                onClick={() => setProductKey(key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="reel-lab__field">
            <span>Vehicle</span>
            <select value={selectedVehicle ? String(selectedVehicle.id) : ""} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              {vehiclesLoading ? <option>Loading vehicles...</option> : null}
              {vehiclesError ? <option>{vehiclesError}</option> : null}
              {!productVehicles.length && !vehiclesLoading ? <option>No vehicles available</option> : null}
              {productVehicles.map((vehicle) => (
                <option key={`${productKey}-${vehicle.id}`} value={String(vehicle.id)}>
                  {vehicleRegistration(vehicle) || "NO REG"} - {vehicleTitle(vehicle)}
                </option>
              ))}
            </select>
          </label>

          <label className="reel-lab__field">
            <span>Image source</span>
            <select value={imageSource} onChange={(event) => setImageSource(event.target.value)}>
              {IMAGE_SOURCE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <div className="reel-lab__upload-row">
            <button className="button button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
              Upload Images
            </button>
            <span>{uploadedImages.length} / {MAX_UPLOADS} uploaded for {product.label}</span>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUploads} />
          </div>

          {uploadedImages.length ? (
            <div className="reel-lab__thumbs">
              {uploadedImages.map((item) => (
                <div key={item.id} className="reel-lab__thumb">
                  <img src={item.url} alt={item.name} />
                  <button type="button" onClick={() => removeUpload(item.id)}>Remove</button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="reel-lab__cms-upload">
            <div>
              <span>{productKey === "rent2buy" ? "Rent2Buy CMS Upload" : "Van Finance CMS Upload"}</span>
              <p>Session-only CMS rows for {product.label}. Matched by selected registration first, then title. Images stay in CMS row order.</p>
            </div>
            <div className="reel-lab__upload-row">
              <button className="button button--ghost" type="button" onClick={() => cmsInputRef.current?.click()}>
                Upload CMS File
              </button>
              {cmsUpload ? <button className="button button--ghost" type="button" onClick={clearCmsUpload}>Clear CMS</button> : null}
              <span>{cmsUpload ? `${cmsUpload.fileName} · ${cmsUpload.rows.length} rows` : `No ${product.label} CMS file uploaded`}</span>
              <input ref={cmsInputRef} type="file" accept=".csv,.json,.txt,application/json,text/csv,text/plain" onChange={handleCmsUpload} />
            </div>
            {cmsUpload ? (
              <div className="reel-lab__page-result">
                <strong>{cmsMatch ? `Matched CMS row for ${vehicleRegistration(selectedVehicle) || vehicleTitle(selectedVehicle)}` : "No matching CMS row for selected vehicle"}</strong>
                <div className="reel-lab__debug-grid">
                  <span><b>Product CMS</b>{product.label}</span>
                  <span><b>Rows loaded</b>{cmsUpload.rows.length}</span>
                  <span><b>Matched reg</b>{cmsMatch?.registration || "None"}</span>
                  <span><b>CMS images</b>{cmsMatch?.imageRecords?.length || 0}</span>
                </div>
                {cmsMatch?.imageRecords?.length ? (
                  <div className="reel-lab__page-thumbs">
                    {cmsMatch.imageRecords.slice(0, 5).map((item, index) => (
                      <img key={`${item.url}-${index}`} src={item.url} alt={`CMS image ${index + 1}`} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {sourceNote ? <div className="reel-lab__note">{sourceNote}</div> : null}

          <div className="reel-lab__page-test">
            <div>
              <span>Van page image test</span>
              <p>Checks the selected {product.label} vehicle page only. Report-only; generation still falls back safely.</p>
            </div>
            <button
              className="button button--ghost"
              type="button"
              onClick={handleTestPageImages}
              disabled={!selectedVehicle || pageImageTest?.status === "checking"}
            >
              {pageImageTest?.status === "checking" ? "Checking Images..." : "Test First 5 Van Page Images"}
            </button>
          </div>

          {pageImageTest ? (
            <div className={`reel-lab__page-result reel-lab__page-result--${pageImageTest.status}`}>
              <strong>{pageImageTest.message}</strong>
              {pageImageTest.error ? <span>{pageImageTest.error}</span> : null}
              <div className="reel-lab__debug-grid">
                <span><b>Selected reg</b>{pageImageTest.debug?.selectedReg || vehicleRegistration(selectedVehicle) || "No reg"}</span>
                <span><b>Source</b>{pageImageTest.productLabel || product.label}</span>
                <span><b>Reg match</b>{pageImageTest.matchedRegistration ? "Yes" : "No"}</span>
                <span><b>Title match</b>{pageImageTest.matchedTitle ? "Yes" : "No"}</span>
                <span><b>Main images refs</b>{Number(pageImageTest.debug?.mainImagesRefsFound || 0)}</span>
                <span><b>Gallery refs</b>{Number(pageImageTest.debug?.galleryRefsFound || 0)}</span>
                <span><b>Candidate images</b>{Number(pageImageTest.debug?.candidateImagesFound || 0)}</span>
                <span><b>Returned</b>{pageImageTest.images?.length || 0}</span>
                <span><b>Image 1 source</b>{pageImageTest.imageRecords?.[0]?.source || pageImageTest.debug?.image1Source || "None"}</span>
                <span><b>Dedupe happened</b>{pageImageTest.debug?.dedupeHappened ? "Yes" : "No"}</span>
                <span><b>Final ordered count</b>{pageImageTest.imageRecords?.length || 0}</span>
                {[0, 1, 2, 3, 4].map((index) => (
                  <span key={`image-debug-${index}`}>
                    <b>{`Image ${index + 1} URL`}</b>
                    {pageImageTest.imageRecords?.[index]?.url || pageImageTest.debug?.[`image${index + 1}Url`] || "None"}
                  </span>
                ))}
              </div>
              {pageImageTest.pageUrl ? <span>Page URL: {pageImageTest.pageUrl}</span> : null}
              {pageImageTest.images?.length ? (
                <div className="reel-lab__page-thumbs">
                  {pageImageTest.images.map((url, index) => (
                    <img key={`${url}-${index}`} src={url} alt={`Van page ${index + 1}`} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="reel-lab__image-order">
            <strong>Current final image order</strong>
            <div className="reel-lab__debug-grid">
              <span><b>Image 1 source</b>{resolvedImageOrder.records[0]?.source || "None"}</span>
              <span><b>Dedupe happened</b>{resolvedImageOrder.dedupeHappened ? "Yes" : "No"}</span>
              <span><b>Final ordered count</b>{resolvedImageOrder.records.length}</span>
              {[0, 1, 2, 3, 4].map((index) => (
                <span key={`final-image-debug-${index}`}>
                  <b>{`Image ${index + 1} URL`}</b>
                  {resolvedImageOrder.records[index]?.url || "None"}
                </span>
              ))}
            </div>
          </div>

          <label className="reel-lab__field">
            <span>Visual template</span>
            <select value={visualTemplate} onChange={(event) => setVisualTemplate(event.target.value)}>
              {VISUAL_TEMPLATES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="reel-lab__field">
            <span>Top header text</span>
            <input
              type="text"
              value={brandHeaderText}
              onChange={(event) => setBrandHeaderByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}
              placeholder={DEFAULT_BRAND_HEADERS[productKey]}
            />
          </label>

          <label className="reel-lab__field">
            <span>Manual hook text</span>
            <input
              type="text"
              value={hookText}
              onChange={(event) => setHookByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}
              placeholder={DEFAULT_HOOKS[productKey]}
            />
          </label>

          <label className="reel-lab__field">
            <span>Supporting line</span>
            <input
              type="text"
              value={supportText}
              onChange={(event) => setSupportByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}
              placeholder={DEFAULT_SUPPORT_LINES[productKey]}
            />
          </label>

          <label className="reel-lab__field">
            <span>Final CTA text</span>
            <input
              type="text"
              value={cta}
              onChange={(event) => setCtaByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}
              placeholder={product.finalCta}
            />
          </label>

          <div className="reel-lab__copy">
            <span>{product.label} wording preview</span>
            <pre>{createCaption({ productKey, vehicle: selectedVehicle, cta })}</pre>
          </div>

          <div className="reel-lab__actions">
            <button className="button button--primary" type="button" onClick={handleGenerate}>
              Generate Preview
            </button>
            <button className="button button--ghost" type="button" onClick={handleDownloadMp4} disabled={!currentAsset?.blob}>
              Download MP4
            </button>
          </div>

          {status ? <div className="reel-lab__status">{status}</div> : null}
          {error ? <div className="reel-lab__error">{error}</div> : null}
        </div>

        <div className="reel-lab__preview-panel">
          <div className="reel-lab__phone">
            {currentAsset?.url ? (
              <video src={currentAsset.url} controls playsInline />
            ) : (
              <div className={`reel-lab__poster reel-lab__poster--${productKey === "rent2buy" ? "rent" : "finance"}`}>
                {resolvedImages[0] ? <img src={resolvedImages[0]} alt={vehicleTitle(selectedVehicle)} /> : null}
                <div className="reel-lab__poster-card">
                  <span>{product.brand}</span>
                  <strong>{selectedVehicle ? vehicleTitle(selectedVehicle) : "Select a vehicle"}</strong>
                  <em>{imageSourceLabel(imageSource)}</em>
                </div>
              </div>
            )}
          </div>
          <div className="reel-lab__safety">
            Preview/download only. No posting queue, Facebook page, Creative Library, Supabase tracking, or stock record is changed.
          </div>
        </div>
      </div>
    </section>
  );
}
