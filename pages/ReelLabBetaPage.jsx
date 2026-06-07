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
    finalCta: "VIEW THIS VAN",
    destinationUrl: "https://www.vanfinancecompany.co.uk/",
    templateStyles: ["Premium Stock Card", "Finance Offer", "Vehicle Spotlight"],
    ctas: ["View This Van", "Check Monthly Payments", "Apply For Finance"],
    usps: ["From £99 Deposit", "Finance Available", "Approved in 60 Minutes", "Free UK Delivery", "200+ Vans In Stock"],
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
  ["page", "First 5 van page images"],
  ["auto", "Auto: Uploaded > Van Page > Stock"],
];

const VISUAL_TEMPLATES = [
  ["blackPremium", "Black Premium Showcase"],
  ["tiktokPunch", "TikTok Punch Showcase"],
  ["luxuryDealer", "Luxury Dealer Showcase"],
];

const VISUAL_TEMPLATE_CONFIG = {
  blackPremium: {
    label: "Black Premium Showcase",
    imageArea: { x: 50, y: 92, width: REEL_WIDTH - 100, height: 1010 },
    textY: 1164,
    headlineHook: 86,
    headline: 62,
    cta: 74,
    panel: false,
    sweepAlpha: 0.28,
    flash: 0.08,
    zoom: 0.018,
    punch: 0.022,
  },
  tiktokPunch: {
    label: "TikTok Punch Showcase",
    imageArea: { x: 42, y: 76, width: REEL_WIDTH - 84, height: 1034 },
    textY: 1152,
    headlineHook: 96,
    headline: 68,
    cta: 82,
    panel: false,
    sweepAlpha: 0.42,
    flash: 0.18,
    zoom: 0.026,
    punch: 0.055,
  },
  luxuryDealer: {
    label: "Luxury Dealer Showcase",
    imageArea: { x: 70, y: 116, width: REEL_WIDTH - 140, height: 948 },
    textY: 1168,
    headlineHook: 76,
    headline: 56,
    cta: 68,
    panel: true,
    sweepAlpha: 0.18,
    flash: 0.05,
    zoom: 0.012,
    punch: 0.012,
  },
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

function financeBuyLine(vehicle) {
  const price = vehiclePriceLine(vehicle, "vanFinance")
    .replace(/^from\s+/i, "")
    .replace(/\bp\/m\b/i, "per month")
    .trim();
  return price ? `BUY FROM ${price.toUpperCase()}` : "BUY FROM AVAILABLE FINANCE";
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

From £99 deposit. Finance available. Approved in 60 minutes.
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

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  drawRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function getFrameSpec(productKey, vehicle, frameIndex) {
  const price = vehiclePriceLine(vehicle, productKey);
  const title = vehicleTitle(vehicle);

  if (productKey === "rent2buy") {
    return [
      { kind: "hook", eyebrow: "RENT2BUY VANS", headline: "NO CREDIT CHECK", subline: "Apply in 60 seconds" },
      { kind: "details", eyebrow: "SELECTED VAN", headline: title, subline: price },
      { kind: "statement", eyebrow: "SIMPLE VAN OWNERSHIP", headline: "RENT IT - DRIVE IT - OWN IT", subline: vehicleRegistration(vehicle) },
      { kind: "statement", eyebrow: "FINAL PAYMENT", headline: "IT'S YOURS", subline: "Built for drivers who need a clear route forward" },
      { kind: "cta", eyebrow: "READY TO START?", headline: "CHECK IF YOU QUALIFY", subline: "rent2buyvans.co.uk" },
    ][frameIndex];
  }

  return [
    { kind: "hook", eyebrow: "VAN FINANCE COMPANY", headline: "FROM \u00a399 DEPOSIT", subline: "Finance available on this van" },
    { kind: "details", eyebrow: "SELECTED VAN", headline: title, subline: price },
    { kind: "statement", eyebrow: "FINANCE OFFER", headline: financeBuyLine(vehicle), subline: vehicleRegistration(vehicle) },
    { kind: "statement", eyebrow: "NATIONWIDE", headline: "FREE UK DELIVERY", subline: "Delivered direct to your door" },
    { kind: "cta", eyebrow: "START TODAY", headline: "APPLY NOW", subline: "vanfinancecompany.co.uk" },
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

function drawBottomTextFrame(ctx, product, productKey, spec, frameProgress, frameIndex, visualTemplate, textX, textY, textWidth) {
  const config = VISUAL_TEMPLATE_CONFIG[visualTemplate] || VISUAL_TEMPLATE_CONFIG.blackPremium;
  const isTikTok = visualTemplate === "tiktokPunch";
  const isLuxury = visualTemplate === "luxuryDealer";
  const enter = easeOutCubic(Math.min(1, frameProgress / (isTikTok ? 0.16 : isLuxury ? 0.36 : 0.24)));
  const slideY = (1 - enter) * (isTikTok ? 96 : isLuxury ? 42 : 74);
  const glowPulse = 0.72 + Math.sin(frameProgress * Math.PI * (isTikTok ? 4 : 2)) * (isTikTok ? 0.22 : 0.1);
  const isHook = spec.kind === "hook";
  const isCta = spec.kind === "cta";
  const isStatement = spec.kind === "statement";
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
    fillRoundRect(ctx, textX + 28, textY + 252, textWidth - 56, isLuxury ? 88 : 98, isLuxury ? 22 : 30, product.accent);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `${isLuxury ? 850 : 950} ${isLuxury ? 38 : 42}px ${CANVAS_FONT}`;
    drawFitText(ctx, spec.headline, REEL_WIDTH / 2, textY + (isLuxury ? 308 : 315), textWidth - 116, isLuxury ? 38 : 42, 29);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `${isLuxury ? 750 : 800} 30px ${CANVAS_FONT}`;
    ctx.fillText(spec.subline, textX + 52, textY + (isLuxury ? 376 : 386));
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

function drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, elapsedSeconds }) {
  const product = PRODUCTS[productKey];
  const config = VISUAL_TEMPLATE_CONFIG[visualTemplate] || VISUAL_TEMPLATE_CONFIG.blackPremium;
  const isLuxury = visualTemplate === "luxuryDealer";
  const isTikTok = visualTemplate === "tiktokPunch";
  const images = loadedImages.length ? loadedImages : [];
  const frameCount = 5;
  const frameDuration = REEL_DURATION_SECONDS / frameCount;
  const frameIndex = Math.min(frameCount - 1, Math.floor(elapsedSeconds / frameDuration));
  const frameProgress = Math.min(1, (elapsedSeconds - frameIndex * frameDuration) / frameDuration);
  const image = images[Math.min(frameIndex, images.length - 1)] || images[0];
  const imageArea = config.imageArea;
  const textX = 68;
  const textY = config.textY;
  const textWidth = REEL_WIDTH - 136;
  const containScale = 0.982 + Math.sin(frameProgress * Math.PI) * config.zoom + (frameIndex === 0 ? Math.sin(Math.min(1, frameProgress / 0.32) * Math.PI) * config.punch : 0);
  const panX = Math.sin((frameProgress + frameIndex * 0.17) * Math.PI * 2) * (isTikTok ? 14 : isLuxury ? 5 : 9);
  const panY = Math.cos((frameProgress + frameIndex * 0.11) * Math.PI * 2) * (isTikTok ? 10 : isLuxury ? 4 : 7);

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

  const spec = getFrameSpec(productKey, vehicle, frameIndex);
  drawBottomTextFrame(ctx, product, productKey, spec, frameProgress, frameIndex, visualTemplate, textX, textY, textWidth);
}

async function generateReelLabAsset({ productKey, vehicle, visualTemplate, imageUrls, onProgress }) {
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
    drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, visualTemplate, elapsedSeconds });
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
  const [imageSource, setImageSource] = useState("stock");
  const [visualTemplate, setVisualTemplate] = useState("blackPremium");
  const [uploadsByProduct, setUploadsByProduct] = useState({ vanFinance: [], rent2buy: [] });
  const [ctaByProduct, setCtaByProduct] = useState({
    vanFinance: PRODUCTS.vanFinance.ctas[0],
    rent2buy: PRODUCTS.rent2buy.ctas[0],
  });
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pageImageTests, setPageImageTests] = useState({ vanFinance: null, rent2buy: null });
  const fileInputRef = useRef(null);
  const generationKeyRef = useRef("");

  const product = PRODUCTS[productKey];
  const productVehicles = useMemo(() => getProductVehicles(vehicles, productKey), [vehicles, productKey]);
  const selectedVehicle = useMemo(
    () => productVehicles.find((vehicle) => String(vehicle.id) === selectedVehicleId) || productVehicles[0] || null,
    [productVehicles, selectedVehicleId]
  );
  const uploadedImages = uploadsByProduct[productKey] || [];
  const stockImage = vehicleImage(selectedVehicle);
  const cta = ctaByProduct[productKey];
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
    const pageRecords = Array.isArray(pageImageTest?.imageRecords)
      ? pageImageTest.imageRecords.map((item) => ({ url: item.url, source: item.source || "gallery/mainImages" }))
      : [];
    const stockRecord = stockImage ? [{ url: stockImage, source: "stock image" }] : [];

    if (imageSource === "upload") return buildOrderedImageRecords(manualRecords);
    if (imageSource === "page") return buildOrderedImageRecords(pageRecords.length ? pageRecords : stockRecord);
    if (imageSource === "auto") {
      if (manualRecords.length) return buildOrderedImageRecords(manualRecords);
      if (pageRecords.length) return buildOrderedImageRecords(pageRecords);
      return buildOrderedImageRecords(stockRecord);
    }
    return buildOrderedImageRecords(stockRecord);
  }, [imageSource, pageImageTest, uploadedImages, stockImage]);
  const resolvedImages = resolvedImageOrder.records.map((item) => item.url);
  const currentPreviewKey = selectedVehicle ? `${selectedVehicleKey}:${visualTemplate}:${imageSource}:${resolvedImages.join("|")}` : "";
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
      ? pageImageTest?.imageRecords?.length
        ? "Using tested van page images in the exact returned order."
        : "Test first 5 van page images below. Stock image fallback is used until real ordered URLs are returned."
      : imageSource === "auto" && !uploadedImages.length
        ? pageImageTest?.imageRecords?.length
          ? "Auto is using tested van page images because no uploaded images are present."
          : "Auto is using stock image because no uploaded or tested van page images are present."
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
            <span>CTA</span>
            <select value={cta} onChange={(event) => setCtaByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}>
              {product.ctas.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
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
