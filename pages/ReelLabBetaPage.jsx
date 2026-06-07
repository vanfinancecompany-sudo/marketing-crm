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

function drawBrandPill(ctx, product, x, y) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  fillRoundRect(ctx, x, y, 372, 70, 20, "rgba(10,12,18,0.82)");
  fillRoundRect(ctx, x + 14, y + 14, 42, 42, 14, product.accent);
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 27px ${CANVAS_FONT}`;
  ctx.fillText(product.brand.toUpperCase(), x + 72, y + 45);
  ctx.restore();
}

function drawPremiumHook(ctx, product, productKey, elapsedSeconds, safeLeft, safeTop, safeWidth) {
  const alpha = stagedOpacity(elapsedSeconds, 0.25, 0.7) * fadeOut(elapsedSeconds, 2.35, 2.9);
  if (alpha <= 0.01) return;

  const entrance = stagedOpacity(elapsedSeconds, 0.25, 0.7);
  const exit = fadeOut(elapsedSeconds, 2.35, 2.9);
  const slide = (1 - entrance) * 60 - (1 - exit) * 38;
  const panelY = safeTop + 600 + slide;
  const gradient = ctx.createLinearGradient(safeLeft, panelY, safeLeft + safeWidth, panelY + 270);
  gradient.addColorStop(0, "rgba(8,10,16,0.92)");
  gradient.addColorStop(0.62, "rgba(14,16,24,0.84)");
  gradient.addColorStop(1, "rgba(239,35,60,0.78)");

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 16;
  fillRoundRect(ctx, safeLeft + 22, panelY, safeWidth - 44, 270, 34, gradient);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `900 29px ${CANVAS_FONT}`;
  ctx.fillText(productKey === "rent2buy" ? "RENT IT. DRIVE IT. OWN IT." : "FINANCE AVAILABLE ON THIS VAN", safeLeft + 72, panelY + 68);

  ctx.fillStyle = "#ffffff";
  drawFitText(ctx, product.hook, safeLeft + 72, panelY + 175, safeWidth - 144, 86, 54);

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `800 31px ${CANVAS_FONT}`;
  ctx.fillText(productKey === "rent2buy" ? "Apply in 60 seconds" : "Approved in 60 minutes", safeLeft + 74, panelY + 228);
  ctx.restore();
}

function drawVehicleCard(ctx, product, productKey, vehicle, templateStyle, safeLeft, safeBottom) {
  const cardX = safeLeft;
  const cardY = 1138;
  const cardWidth = REEL_WIDTH - safeLeft * 2;
  const cardHeight = safeBottom - cardY - 34;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 18;
  fillRoundRect(ctx, cardX, cardY, cardWidth, cardHeight, 34, "rgba(255,255,255,0.94)");
  ctx.shadowBlur = 0;

  ctx.fillStyle = product.accent;
  ctx.font = `900 30px ${CANVAS_FONT}`;
  ctx.fillText(templateStyle.toUpperCase(), cardX + 42, cardY + 62);

  ctx.fillStyle = "#0f172a";
  ctx.font = `900 57px ${CANVAS_FONT}`;
  wrapText(ctx, vehicleTitle(vehicle), cardX + 42, cardY + 136, cardWidth - 84, 62, 2);

  fillRoundRect(ctx, cardX + 42, cardY + 262, 242, 58, 18, "#111827");
  ctx.fillStyle = "#ffffff";
  drawFitText(ctx, vehicleRegistration(vehicle) || "SELECTED STOCK", cardX + 68, cardY + 300, 190, 28, 22);

  ctx.fillStyle = "#475569";
  ctx.font = `800 30px ${CANVAS_FONT}`;
  ctx.fillText(vehiclePriceLine(vehicle, productKey).toUpperCase(), cardX + 322, cardY + 300);

  product.usps.slice(0, 3).forEach((usp, index) => {
    const pillX = cardX + 42 + index * 282;
    fillRoundRect(ctx, pillX, cardY + 348, 256, 48, 16, "rgba(15,23,42,0.06)");
    ctx.fillStyle = "#111827";
    drawFitText(ctx, usp, pillX + 20, cardY + 380, 216, 23, 17, 900);
  });
  ctx.restore();
}

function drawFinalCta(ctx, product, productKey, cta, elapsedSeconds, safeLeft, safeTop, safeWidth, safeBottom) {
  const alpha = stagedOpacity(elapsedSeconds, 7.25, 8.0);
  if (alpha <= 0.01) return;

  const slide = (1 - alpha) * 64;
  const panelY = safeTop + 865 - slide;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 18;
  fillRoundRect(ctx, safeLeft + 30, panelY, safeWidth - 60, safeBottom - panelY - 18, 34, "rgba(8,10,16,0.90)");
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(255,255,255,0.74)";
  ctx.font = `900 28px ${CANVAS_FONT}`;
  ctx.fillText(productKey === "rent2buy" ? "READY TO START?" : "LIKE THIS VAN?", safeLeft + 82, panelY + 78);

  fillRoundRect(ctx, safeLeft + 82, panelY + 118, safeWidth - 164, 108, 28, product.accent);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  drawFitText(ctx, (cta || product.finalCta).toUpperCase(), REEL_WIDTH / 2, panelY + 187, safeWidth - 230, 48, 32);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `800 30px ${CANVAS_FONT}`;
  ctx.fillText(product.destinationUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), safeLeft + 82, panelY + 285);
  ctx.restore();
}

function drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, templateStyle, cta, elapsedSeconds }) {
  const product = PRODUCTS[productKey];
  const images = loadedImages.length ? loadedImages : [];
  const sceneCount = Math.max(1, images.length);
  const sceneDuration = REEL_DURATION_SECONDS / sceneCount;
  const sceneIndex = Math.min(sceneCount - 1, Math.floor(elapsedSeconds / sceneDuration));
  const sceneProgress = Math.min(1, (elapsedSeconds - sceneIndex * sceneDuration) / sceneDuration);
  const image = images[sceneIndex] || images[0];
  const safeLeft = 60;
  const safeTop = 120;
  const safeBottom = REEL_HEIGHT - 280;
  const safeWidth = REEL_WIDTH - safeLeft * 2;
  const containScale = 0.965 + Math.sin(sceneProgress * Math.PI) * 0.015;
  const panX = Math.sin(sceneProgress * Math.PI * 2) * 12;
  const panY = Math.cos(sceneProgress * Math.PI * 2) * 8;

  ctx.clearRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  ctx.fillStyle = product.deep;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  if (image) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawCoverImage(ctx, image, 0, 0, REEL_WIDTH, REEL_HEIGHT, 1.02, 0, 0);
    ctx.restore();

    ctx.save();
    drawRoundRect(ctx, safeLeft, safeTop, safeWidth, 900, 26);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(safeLeft, safeTop, safeWidth, 900);
    drawContainImage(ctx, image, safeLeft, safeTop, safeWidth, 900, containScale, panX, panY);
    ctx.restore();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, REEL_HEIGHT);
  gradient.addColorStop(0, "rgba(7,20,38,0.04)");
  gradient.addColorStop(0.62, "rgba(7,20,38,0.04)");
  gradient.addColorStop(1, "rgba(7,20,38,0.70)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  drawBrandPill(ctx, product, safeLeft, safeTop + 24);
  drawPremiumHook(ctx, product, productKey, elapsedSeconds, safeLeft, safeTop, safeWidth);

  const cardAlpha = stagedOpacity(elapsedSeconds, 3.25, 3.55) * fadeOut(elapsedSeconds, 6.7, 7.05);
  if (cardAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = cardAlpha;
    ctx.translate(0, (1 - cardAlpha) * 40);
    drawVehicleCard(ctx, product, productKey, vehicle, templateStyle, safeLeft, safeBottom);
    ctx.restore();
  }

  drawFinalCta(ctx, product, productKey, cta, elapsedSeconds, safeLeft, safeTop, safeWidth, safeBottom);
}

async function generateReelLabAsset({ productKey, vehicle, templateStyle, cta, imageUrls, onProgress }) {
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
    drawReelLabFrame(ctx, loadedImages, { productKey, vehicle, templateStyle, cta, elapsedSeconds });
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
  const [uploadsByProduct, setUploadsByProduct] = useState({ vanFinance: [], rent2buy: [] });
  const [templateByProduct, setTemplateByProduct] = useState({
    vanFinance: PRODUCTS.vanFinance.templateStyles[0],
    rent2buy: PRODUCTS.rent2buy.templateStyles[0],
  });
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
  const templateStyle = templateByProduct[productKey];
  const cta = ctaByProduct[productKey];
  const selectedVehicleKey = selectedVehicle ? `${productKey}:${selectedVehicle.id}:${vehicleRegistration(selectedVehicle)}` : "";
  const pageImageTest = pageImageTests[productKey]?.vehicleKey === selectedVehicleKey ? pageImageTests[productKey] : null;
  const currentAsset = asset?.vehicleKey === selectedVehicleKey ? asset : null;

  useEffect(() => {
    setSelectedVehicleId("");
    if (asset?.url) URL.revokeObjectURL(asset.url);
    setAsset(null);
    setError("");
    setStatus("");
  }, [productKey]);

  useEffect(() => {
    generationKeyRef.current = selectedVehicleKey;
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

  const resolvedImages = useMemo(() => {
    if (imageSource === "upload") return uploadedImages.map((item) => item.url);
    if (imageSource === "page") return stockImage ? [stockImage] : [];
    if (imageSource === "auto") {
      const manual = uploadedImages.map((item) => item.url);
      return manual.length ? manual : stockImage ? [stockImage] : [];
    }
    return stockImage ? [stockImage] : [];
  }, [imageSource, uploadedImages, stockImage]);

  const sourceNote =
    imageSource === "page"
      ? "First 5 van page images can be tested below. Reel generation still uses stock fallback until confirmed safe."
      : imageSource === "auto" && !uploadedImages.length
        ? "Auto is using stock image because uploaded and van page images are not confirmed for this beta yet."
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
      setPageImageTests((prev) => ({
        ...prev,
        [productKey]: {
          vehicleKey,
          status: images.length ? "found" : "empty",
          message: images.length
            ? `${images.length} van page image${images.length === 1 ? "" : "s"} found. Stock image fallback remains active for generation.`
            : "No van page images found -- stock image fallback will be used.",
          images,
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
    const renderVehicleKey = selectedVehicleKey;
    generationKeyRef.current = renderVehicleKey;
    try {
      const nextAsset = await generateReelLabAsset({
        productKey,
        vehicle: selectedVehicle,
        templateStyle,
        cta,
        imageUrls: resolvedImages,
        onProgress: setStatus,
      });
      if (generationKeyRef.current !== renderVehicleKey) {
        URL.revokeObjectURL(nextAsset.url);
        return;
      }
      setAsset({ ...nextAsset, vehicleKey: renderVehicleKey });
      setStatus(`Preview ready for ${vehicleRegistration(selectedVehicle) || "selected vehicle"}. Download MP4 when you are happy with it.`);
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
      const filename = `${safeFilePart(`${product.label}-${vehicleRegistration(selectedVehicle)}-${templateStyle}`)}.mp4`;
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

          <label className="reel-lab__field">
            <span>Template style</span>
            <select
              value={templateStyle}
              onChange={(event) => setTemplateByProduct((prev) => ({ ...prev, [productKey]: event.target.value }))}
            >
              {product.templateStyles.map((style) => (
                <option key={style} value={style}>{style}</option>
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
