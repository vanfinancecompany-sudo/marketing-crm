import { useEffect, useMemo, useRef, useState } from "react";

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;
const REEL_FPS = 30;
const REEL_DURATION_SECONDS = 10;
const MAX_UPLOADS = 10;

const PRODUCTS = {
  vanFinance: {
    label: "Van Finance",
    brand: "Van Finance Company",
    accent: "#ef233c",
    destinationUrl: "https://www.vanfinancecompany.co.uk/",
    templateStyles: ["Premium Stock Card", "Finance Offer", "Vehicle Spotlight"],
    ctas: ["View This Van", "Check Monthly Payments", "Apply For Finance"],
    usps: ["From £99 Deposit", "Finance Available", "Approved in 60 Minutes", "Free UK Delivery", "200+ Vans In Stock"],
  },
  rent2buy: {
    label: "Rent2Buy",
    brand: "Rent2Buy Vans",
    accent: "#16a34a",
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
  return String(value || "").replace(/\s+/g, " ").trim();
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
${vehicle?.link || vehicle?.weblink || product.destinationUrl}${reg ? `?reg=${encodeURIComponent(reg)}` : ""}`;
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
    ctx.font = `${fontWeight} ${fontSize}px Arial`;
    if (ctx.measureText(clean).width <= maxWidth) break;
    fontSize -= 2;
  }
  ctx.fillText(clean, x, y);
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
  ctx.fillStyle = productKey === "rent2buy" ? "#06150d" : "#071426";
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

  ctx.save();
  drawRoundRect(ctx, safeLeft, safeTop + 24, 360, 66, 18);
  ctx.fillStyle = product.accent;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  drawFitText(ctx, product.brand, safeLeft + 28, safeTop + 68, 292, 29, 22);
  ctx.restore();

  ctx.save();
  drawRoundRect(ctx, safeLeft, 1050, safeWidth, 98, 10);
  ctx.fillStyle = product.accent;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  drawFitText(ctx, productKey === "vanFinance" ? "FROM \u00a399 DEPOSIT" : "NO CREDIT CHECK", REEL_WIDTH / 2, 1114, safeWidth - 80, 56, 36);
  ctx.textAlign = "left";
  ctx.restore();

  ctx.save();
  drawRoundRect(ctx, safeLeft, 1178, safeWidth, safeBottom - 1178, 30);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.fillStyle = product.accent;
  ctx.font = "900 36px Arial";
  ctx.fillText(templateStyle, 105, 1240);

  ctx.fillStyle = "#111827";
  ctx.font = "900 56px Arial";
  wrapText(ctx, vehicleTitle(vehicle), 105, 1312, 820, 62, 2);

  ctx.fillStyle = "#374151";
  ctx.font = "800 34px Arial";
  ctx.fillText(vehicleRegistration(vehicle) || "SELECTED STOCK", 105, 1458);
  ctx.fillText(vehiclePriceLine(vehicle, productKey), 105, 1510);

  drawRoundRect(ctx, 600, 1440, 330, 96, 26);
  ctx.fillStyle = product.accent;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 31px Arial";
  wrapText(ctx, cta, 632, 1498, 266, 34, 2);
  ctx.restore();

  const uspStart = 1556;
  product.usps.slice(0, 3).forEach((usp, index) => {
    const x = index === 2 ? 105 : 105 + index * 328;
    const y = index === 2 ? uspStart + 58 : uspStart;
    ctx.save();
    drawRoundRect(ctx, x, y, index === 2 ? 420 : 292, 42, 15);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    ctx.fillStyle = "#111827";
    drawFitText(ctx, usp, x + 20, y + 29, (index === 2 ? 380 : 252), 23, 18);
    ctx.restore();
  });

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "800 24px Arial";
  ctx.fillText(product.destinationUrl.replace(/^https?:\/\//, ""), safeLeft, 1678);
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
  const fileInputRef = useRef(null);

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

  useEffect(() => {
    setSelectedVehicleId("");
    setAsset(null);
    setError("");
    setStatus("");
  }, [productKey]);

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
      ? "Van page image fetching is not connected in this safe beta yet. Using stock image fallback."
      : imageSource === "auto" && !uploadedImages.length
        ? "Auto is using stock image because no uploaded images are present."
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
    try {
      const nextAsset = await generateReelLabAsset({
        productKey,
        vehicle: selectedVehicle,
        templateStyle,
        cta,
        imageUrls: resolvedImages,
        onProgress: setStatus,
      });
      setAsset(nextAsset);
      setStatus("Preview ready. Download MP4 when you are happy with it.");
    } catch (generationError) {
      setError(generationError.message || "Could not generate Reel Lab preview.");
      setStatus("");
    }
  }

  async function handleDownloadMp4() {
    setError("");
    if (!asset?.blob) {
      setError("Generate a Reel Lab preview before downloading MP4.");
      return;
    }
    try {
      setStatus("Converting to MP4");
      const filename = `${safeFilePart(`${product.label}-${vehicleRegistration(selectedVehicle)}-${templateStyle}`)}.mp4`;
      await downloadMp4FromWebm(asset.blob, filename);
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
            <button className="button button--ghost" type="button" onClick={handleDownloadMp4} disabled={!asset?.blob}>
              Download MP4
            </button>
          </div>

          {status ? <div className="reel-lab__status">{status}</div> : null}
          {error ? <div className="reel-lab__error">{error}</div> : null}
        </div>

        <div className="reel-lab__preview-panel">
          <div className="reel-lab__phone">
            {asset?.url ? (
              <video src={asset.url} controls playsInline />
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
