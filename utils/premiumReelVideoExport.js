import financeLogo from "../assets/van-finance-company.png";
import rent2buyLogo from "../assets/rent2buy-vans.png";
import defaultReelAudio from "../assets/default-reel-audio.mp3";

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;
const PREMIUM_REEL_FPS = 30;
const PREMIUM_REEL_DURATION_MS = 11000;
const PREMIUM_REEL_DURATION_SECONDS = PREMIUM_REEL_DURATION_MS / 1000;
const INTRO_END_SECONDS = 2.5;
const VEHICLE_END_SECONDS = 6.5;
const BENEFITS_END_SECONDS = 7.8;

function cleanText(value) {
  return String(value || "").replace(/Â£/g, "£").trim();
}

function brandLogoForPipeline(pipeline) {
  return pipeline === "rent2buy" ? rent2buyLogo : financeLogo;
}

function brandLabelForPipeline(pipeline) {
  return pipeline === "rent2buy" ? "RENT2BUY VANS" : "VAN FINANCE COMPANY";
}

function brandDomainForPipeline(pipeline) {
  return pipeline === "rent2buy" ? "rent2buyvans.co.uk" : "vanfinancecompany.co.uk";
}

function safeFilePart(value) {
  return String(value || "premium-reel")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function safeDownloadName(value) {
  const base = safeFilePart(value).replace(/\.(webm|mp4)$/i, "");
  return `${base || "premium-reel"}.mp4`;
}

function triggerDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function easeOutCubic(value) {
  const t = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(value) {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const options = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

async function loadCanvasImage(imageUrl, missingMessage) {
  if (!imageUrl) {
    throw new Error(missingMessage || "No image available.");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Could not load image asset: ${imageUrl}`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not decode image asset: ${imageUrl}`));
      img.src = objectUrl;
    });

    return {
      image,
      cleanup: () => window.URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    window.URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function createAudioStream(durationMs) {
  if (typeof window === "undefined" || !window.AudioContext) {
    throw new Error("This browser cannot add audio to the premium reel.");
  }

  const audioContext = new window.AudioContext();

  try {
    const response = await fetch(defaultReelAudio);
    if (!response.ok) {
      throw new Error("Could not load the existing reel audio.");
    }

    const audioBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();

    source.buffer = audioBuffer;
    source.loop = audioBuffer.duration * 1000 < durationMs;
    gain.gain.value = 0.22;
    source.connect(gain);
    gain.connect(destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

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
  return {
    stream: null,
    cleanup: () => {},
  };
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawCoverImage(ctx, image, x, y, width, height, scaleBoost = 1) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceWidth = image.width;
  let sourceHeight = image.height;

  if (imageRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
  } else {
    sourceHeight = image.width / targetRatio;
  }

  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  const boostedWidth = width * scaleBoost;
  const boostedHeight = height * scaleBoost;

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x - (boostedWidth - width) / 2,
    y - (boostedHeight - height) / 2,
    boostedWidth,
    boostedHeight
  );
}

function drawContainedImage(ctx, image, x, y, width, height, scale = 1) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;

  if (imageRatio > targetRatio) {
    drawHeight = drawWidth / imageRatio;
  } else {
    drawWidth = drawHeight * imageRatio;
  }

  drawWidth *= scale;
  drawHeight *= scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function wrapText(ctx, text, maxWidth) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function fitText(ctx, text, options) {
  const { maxWidth, maxHeight, maxLines, startSize, minSize, weight = 900 } = options;

  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px Arial, sans-serif`;
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = Math.round(size * 1.08);

    if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) {
      return { lines, size, lineHeight };
    }
  }

  ctx.font = `${weight} ${minSize}px Arial, sans-serif`;
  return {
    lines: wrapText(ctx, text, maxWidth).slice(0, maxLines),
    size: minSize,
    lineHeight: Math.round(minSize * 1.08),
  };
}

function drawTextBlock(ctx, text, options) {
  const {
    x,
    y,
    maxWidth,
    maxHeight,
    maxLines = 3,
    startSize = 88,
    minSize = 36,
    weight = 900,
    color = "#ffffff",
    align = "center",
    shadow = true,
  } = options;
  const fitted = fitText(ctx, text, { maxWidth, maxHeight, maxLines, startSize, minSize, weight });

  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.font = `${weight} ${fitted.size}px Arial, sans-serif`;
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
  }

  let cursorY = y;
  fitted.lines.forEach((line) => {
    ctx.fillText(line, x, cursorY);
    cursorY += fitted.lineHeight;
  });
  ctx.restore();

  return cursorY - y;
}

function drawLogo(ctx, logoImage, x, y, maxWidth, maxHeight, align = "center") {
  if (!logoImage) return;

  const scale = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
  const width = logoImage.width * scale;
  const height = logoImage.height * scale;
  const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;

  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 20;
  ctx.drawImage(logoImage, left, y, width, height);
  ctx.restore();
}

function drawPill(ctx, text, x, y, width, height, options = {}) {
  ctx.save();
  ctx.fillStyle = options.fill || "#ffffff";
  ctx.strokeStyle = options.stroke || "rgba(255,255,255,0.2)";
  ctx.lineWidth = options.lineWidth || 2;
  drawRoundedRect(ctx, x, y, width, height, options.radius || 32);
  ctx.fill();
  ctx.stroke();
  drawTextBlock(ctx, text, {
    x: x + width / 2,
    y: y + Math.max(12, (height - 42) / 2),
    maxWidth: width - 40,
    maxHeight: height - 18,
    maxLines: options.maxLines || 1,
    startSize: options.startSize || 38,
    minSize: options.minSize || 22,
    weight: 900,
    color: options.color || "#09090b",
    shadow: false,
  });
  ctx.restore();
}

function drawProgress(ctx, elapsedSeconds) {
  const progress = Math.max(0, Math.min(elapsedSeconds / PREMIUM_REEL_DURATION_SECONDS, 1));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  drawRoundedRect(ctx, 70, 1850, 940, 10, 999);
  ctx.fill();
  ctx.fillStyle = "#ef121c";
  drawRoundedRect(ctx, 70, 1850, Math.max(10, 940 * progress), 10, 999);
  ctx.fill();
  ctx.restore();
}

function drawFrameChrome(ctx, pipeline) {
  const accent = pipeline === "rent2buy" ? "#ef121c" : "#dc111a";

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 8;
  ctx.strokeRect(36, 36, REEL_WIDTH - 72, REEL_HEIGHT - 72);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(52, 52, REEL_WIDTH - 104, REEL_HEIGHT - 104);
  ctx.restore();
}

function drawPremiumBackground(ctx, pipeline) {
  const gradient = ctx.createLinearGradient(0, 0, 0, REEL_HEIGHT);
  gradient.addColorStop(0, "#09131f");
  gradient.addColorStop(0.46, pipeline === "rent2buy" ? "#122117" : "#15245b");
  gradient.addColorStop(1, "#020712");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  const glow = ctx.createRadialGradient(REEL_WIDTH / 2, REEL_HEIGHT * 0.55, 60, REEL_WIDTH / 2, REEL_HEIGHT * 0.55, 760);
  glow.addColorStop(0, "rgba(255,255,255,0.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
}

function drawPhotoAtmosphere(ctx, image, pipeline, elapsedSeconds) {
  const drift = easeInOut((elapsedSeconds % PREMIUM_REEL_DURATION_SECONDS) / PREMIUM_REEL_DURATION_SECONDS);
  const scale = 1.09 + drift * 0.035;

  ctx.save();
  ctx.filter = "blur(12px)";
  ctx.globalAlpha = 0.72;
  drawCoverImage(ctx, image, -42, -42, REEL_WIDTH + 84, REEL_HEIGHT + 84, scale);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 23, 0.76)";
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  const vertical = ctx.createLinearGradient(0, 0, 0, REEL_HEIGHT);
  vertical.addColorStop(0, "rgba(2, 6, 23, 0.74)");
  vertical.addColorStop(0.44, pipeline === "rent2buy" ? "rgba(3, 26, 18, 0.7)" : "rgba(13, 28, 72, 0.68)");
  vertical.addColorStop(1, "rgba(2, 6, 23, 0.86)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);

  const focus = ctx.createRadialGradient(REEL_WIDTH / 2, REEL_HEIGHT * 0.54, 80, REEL_WIDTH / 2, REEL_HEIGHT * 0.54, 820);
  focus.addColorStop(0, "rgba(255,255,255,0.08)");
  focus.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = focus;
  ctx.fillRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  ctx.restore();
}

function drawOldStructureIntro(ctx, logoImage, reel, scene) {
  const p = easeOutCubic(scene / 0.55);
  const title = cleanText(reel.title || reel.vehicleName || "");

  ctx.save();
  ctx.globalAlpha = p;
  const hookHeight = drawTextBlock(ctx, cleanText(reel.hook).toUpperCase(), {
    x: REEL_WIDTH / 2,
    y: 760 - (1 - p) * 28,
    maxWidth: 880,
    maxHeight: 250,
    maxLines: 3,
    startSize: 92,
    minSize: 46,
    weight: 900,
    color: "#ffffff",
  });

  drawTextBlock(ctx, title, {
    x: REEL_WIDTH / 2,
    y: 760 + hookHeight + 46,
    maxWidth: 900,
    maxHeight: 90,
    maxLines: 2,
    startSize: 42,
    minSize: 24,
    weight: 900,
    color: "#e8eef8",
  });

  drawTextBlock(ctx, brandDomainForPipeline(reel.pipeline), {
    x: REEL_WIDTH / 2,
    y: 1135,
    maxWidth: 760,
    maxHeight: 66,
    maxLines: 1,
    startSize: 38,
    minSize: 24,
    weight: 800,
    color: "#d5e4f7",
  });
  drawLogo(ctx, logoImage, REEL_WIDTH / 2, 1260, 370, 132);
  ctx.restore();
}

function drawImageOfferBanner(ctx, reel, x, y, width, height) {
  const isRent = reel.pipeline === "rent2buy";
  const blueWidth = 245;
  const bannerHeight = 120;
  const bannerY = y + height - bannerHeight;

  ctx.save();
  ctx.fillStyle = "#111870";
  ctx.fillRect(x, bannerY, blueWidth, bannerHeight);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.strokeRect(x, bannerY, blueWidth, bannerHeight);
  drawTextBlock(ctx, isRent ? "NO CREDIT" : "FREE", {
    x: x + blueWidth / 2,
    y: bannerY + 18,
    maxWidth: blueWidth - 28,
    maxHeight: 48,
    maxLines: 1,
    startSize: 48,
    minSize: 24,
    weight: 900,
    color: "#ffffff",
    shadow: false,
  });
  drawTextBlock(ctx, isRent ? "CHECK" : "DELIVERY", {
    x: x + blueWidth / 2,
    y: bannerY + 70,
    maxWidth: blueWidth - 28,
    maxHeight: 38,
    maxLines: 1,
    startSize: 31,
    minSize: 20,
    weight: 900,
    color: "#ffffff",
    shadow: false,
  });

  ctx.fillStyle = "#d40000";
  ctx.fillRect(x + blueWidth, bannerY + 40, width - blueWidth, bannerHeight - 40);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.strokeRect(x + blueWidth, bannerY + 40, width - blueWidth, bannerHeight - 40);
  drawTextBlock(ctx, isRent ? "RENT2BUY THIS VAN" : "FROM £99 DEPOSIT", {
    x: x + blueWidth + (width - blueWidth) / 2,
    y: bannerY + 58,
    maxWidth: width - blueWidth - 46,
    maxHeight: 58,
    maxLines: 1,
    startSize: 50,
    minSize: 24,
    weight: 900,
    color: "#ffffff",
    shadow: false,
  });
  ctx.restore();
}

function drawOldStructureVehicle(ctx, image, logoImage, reel, scene) {
  const p = easeOutCubic(scene / 0.65);
  const cardX = 58;
  const cardY = 470 - (1 - p) * 24;
  const cardWidth = 964;
  const cardHeight = 760;
  const priceY = 1304;
  const imageX = cardX + 18;
  const imageY = cardY + 16;
  const imageWidth = cardWidth - 36;
  const imageHeight = cardHeight - 40;

  ctx.save();
  ctx.globalAlpha = p;

  const isRent = reel.pipeline === "rent2buy";
  const uspText = cleanText(reel.uspLine || (isRent ? "NO CREDIT CHECKS" : "200 VANS IN STOCK")).toUpperCase();
  const uspAccent = isRent ? "rgba(239, 18, 28, 0.66)" : "rgba(239, 18, 28, 0.72)";

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "rgba(3, 7, 18, 0.74)";
  ctx.strokeStyle = uspAccent;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 82, 312 - (1 - p) * 14, 916, 118, 30);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = isRent ? "rgba(239, 18, 28, 0.9)" : "rgba(255,255,255,0.22)";
  drawRoundedRect(ctx, 122, 412 - (1 - p) * 14, 836, 6, 999);
  ctx.fill();
  drawTextBlock(ctx, uspText, {
    x: REEL_WIDTH / 2,
    y: 334 - (1 - p) * 14,
    maxWidth: 870,
    maxHeight: 72,
    maxLines: 1,
    startSize: 78,
    minSize: 54,
    weight: 900,
    color: "#ffffff",
  });
  ctx.restore();

  ctx.shadowColor = "rgba(239,18,28,0.2)";
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "rgba(3, 7, 18, 0.88)";
  drawRoundedRect(ctx, cardX, cardY - 18, cardWidth, cardHeight + 42, 36);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#070b14";
  drawRoundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 8);
  ctx.fill();
  ctx.save();
  drawRoundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 6);
  ctx.clip();
  drawContainedImage(ctx, image, imageX + 16, imageY + 16, imageWidth - 32, imageHeight - 32, 0.985 + p * 0.012);
  ctx.restore();
  ctx.strokeStyle = "rgba(239,18,28,0.72)";
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, imageX, imageY, imageWidth, imageHeight, 6);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, imageX + 8, imageY + 8, imageWidth - 16, imageHeight - 16, 4);
  ctx.stroke();

  drawTextBlock(ctx, cleanText(reel.priceLine), {
    x: REEL_WIDTH / 2,
    y: priceY,
    maxWidth: 930,
    maxHeight: 92,
    maxLines: 1,
    startSize: 66,
    minSize: 36,
    weight: 900,
    color: "#ffffff",
  });

  drawTextBlock(ctx, cleanText(reel.title || reel.vehicleName), {
    x: REEL_WIDTH / 2,
    y: priceY + 110,
    maxWidth: 820,
    maxHeight: 86,
    maxLines: 2,
    startSize: 40,
    minSize: 24,
    weight: 900,
    color: "#e8eef8",
  });

  drawLogo(ctx, logoImage, REEL_WIDTH - 76, 1618, 270, 100, "right");
  ctx.restore();
}

function drawOldStructureBenefits(ctx, logoImage, reel, scene) {
  if (scene > 1.05) {
    drawOldStructureCta(ctx, logoImage, reel, scene - 1.05);
    return;
  }

  const p = easeOutCubic(scene / 0.5);

  ctx.save();
  ctx.globalAlpha = p;
  drawTextBlock(ctx, cleanText(reel.subtext), {
    x: REEL_WIDTH / 2,
    y: 815 - (1 - p) * 22,
    maxWidth: 900,
    maxHeight: 330,
    maxLines: 4,
    startSize: 64,
    minSize: 34,
    weight: 900,
    color: "#ffffff",
  });
  drawLogo(ctx, logoImage, REEL_WIDTH / 2, 1196, 365, 136);
  ctx.restore();
}

function drawOldStructureCta(ctx, logoImage, reel, scene) {
  const p = easeOutCubic(scene / 0.45);

  ctx.save();
  ctx.globalAlpha = p;
  drawTextBlock(ctx, cleanText(reel.ctaLine || "APPLY NOW"), {
    x: REEL_WIDTH / 2,
    y: 780 - (1 - p) * 22,
    maxWidth: 820,
    maxHeight: 130,
    maxLines: 1,
    startSize: 88,
    minSize: 42,
    weight: 900,
    color: "#ffffff",
  });
  drawTextBlock(ctx, brandDomainForPipeline(reel.pipeline), {
    x: REEL_WIDTH / 2,
    y: 1000,
    maxWidth: 760,
    maxHeight: 70,
    maxLines: 1,
    startSize: 42,
    minSize: 24,
    weight: 800,
    color: "#d5e4f7",
  });
  drawLogo(ctx, logoImage, REEL_WIDTH / 2, 1124, 455, 168);
  ctx.restore();
}

function drawPremiumFrame(ctx, image, logoImage, reel, elapsedSeconds) {
  const pipeline = reel.pipeline === "rent2buy" ? "rent2buy" : "vanFinance";
  const scene = Math.max(0, elapsedSeconds);

  ctx.clearRect(0, 0, REEL_WIDTH, REEL_HEIGHT);
  drawPremiumBackground(ctx, pipeline);
  drawPhotoAtmosphere(ctx, image, pipeline, scene);
  drawFrameChrome(ctx, pipeline);

  if (scene < INTRO_END_SECONDS) {
    drawOldStructureIntro(ctx, logoImage, reel, scene);
  } else if (scene < VEHICLE_END_SECONDS) {
    drawOldStructureVehicle(ctx, image, logoImage, reel, scene - INTRO_END_SECONDS);
  } else if (scene < BENEFITS_END_SECONDS) {
    drawOldStructureBenefits(ctx, logoImage, reel, scene - VEHICLE_END_SECONDS);
  } else {
    drawOldStructureCta(ctx, logoImage, reel, scene - BENEFITS_END_SECONDS);
  }

  drawProgress(ctx, elapsedSeconds);
}

export async function generatePremiumReelVideoAsset(reel, options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Premium reel generation is only available in the browser.");
  }

  if (typeof HTMLCanvasElement === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support premium reel generation.");
  }

  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    throw new Error("This browser cannot record premium reel video.");
  }

  options.onProgress?.({ label: "Preparing reel", percent: 5 });
  options.onProgress?.({ label: "Loading vehicle image", percent: 18 });
  const imageAsset = await loadCanvasImage(reel.image, "No vehicle image is available for this premium reel.");
  options.onProgress?.({ label: "Loading vehicle image", percent: 28 });
  const logoAsset = await loadCanvasImage(brandLogoForPipeline(reel.pipeline), "No brand logo is available for this premium reel.");
  options.onProgress?.({ label: "Building premium frames", percent: 38 });
  let audioAsset = emptyAudioStream();

  options.onProgress?.({ label: "Adding audio", percent: 46 });
  if (reel.musicOn) {
    try {
      audioAsset = await createAudioStream(PREMIUM_REEL_DURATION_MS);
    } catch (error) {
      console.warn("Premium reel music disabled for this export:", error);
    }
  }
  options.onProgress?.({ label: "Generating preview", percent: 58 });
  const canvas = document.createElement("canvas");
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    imageAsset.cleanup();
    logoAsset.cleanup();
    audioAsset.cleanup();
    throw new Error("Could not create premium reel canvas.");
  }

  let posterUrl = reel.image || "";
  try {
    drawPremiumFrame(ctx, imageAsset.image, logoAsset.image, reel, 4.2);
    posterUrl = canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    posterUrl = reel.image || "";
  }

  const canvasStream = canvas.captureStream(30);
  const mixedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(audioAsset.stream ? audioAsset.stream.getAudioTracks() : []),
  ]);
  const recorder = new MediaRecorder(mixedStream, { mimeType });
  const chunks = [];
  let renderTimer = 0;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const finishedBlob = new Promise((resolve, reject) => {
    recorder.onerror = (event) => reject(event?.error || new Error("Premium reel recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
  });

  const totalFrames = Math.round(PREMIUM_REEL_DURATION_SECONDS * PREMIUM_REEL_FPS);
  let frameIndex = 0;
  const renderLoop = () => {
    const elapsedSeconds = Math.min(frameIndex / PREMIUM_REEL_FPS, PREMIUM_REEL_DURATION_SECONDS);
    drawPremiumFrame(ctx, imageAsset.image, logoAsset.image, reel, elapsedSeconds);
    if (frameIndex % 15 === 0) {
      options.onProgress?.({
        label: "Generating preview",
        percent: Math.min(96, 58 + Math.round((elapsedSeconds / PREMIUM_REEL_DURATION_SECONDS) * 38)),
      });
    }
    frameIndex += 1;

    if (frameIndex <= totalFrames) {
      renderTimer = window.setTimeout(renderLoop, 1000 / PREMIUM_REEL_FPS);
    } else if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start();
  renderLoop();

  try {
    const blob = await finishedBlob;
    options.onProgress?.({ label: "Ready", percent: 100 });
    const url = window.URL.createObjectURL(blob);
    const fileBase = safeFilePart(`${reel.pipeline || "premium"}-${reel.registration || reel.title || "reel"}-${reel.hook || "hook"}`);

    imageAsset.cleanup();
    logoAsset.cleanup();
    audioAsset.cleanup();

    return {
      blob,
      url,
      posterUrl,
      mimeType: blob.type,
      extension: "webm",
      downloadName: `${fileBase}.webm`,
      audioEmbedded: mixedStream.getAudioTracks().length > 0,
      durationMs: PREMIUM_REEL_DURATION_MS,
    };
  } catch (error) {
    if (renderTimer) {
      window.clearTimeout(renderTimer);
    }
    imageAsset.cleanup();
    logoAsset.cleanup();
    audioAsset.cleanup();
    throw error;
  }
}

export async function downloadPremiumReelMp4(reel, options = {}) {
  if (!reel?.blob) {
    throw new Error("Generate the premium reel before exporting MP4.");
  }

  const filename = safeDownloadName(reel.downloadName || reel.fileName || reel.id);
  options.onPreparing?.();
  options.onUploading?.();

  const response = await fetch("/api/convert-reel-mp4", {
    method: "POST",
    headers: {
      "Content-Type": reel.blob.type || "video/webm",
      "X-Reel-Filename": filename,
    },
    body: reel.blob,
  });

  options.onConverting?.();

  if (!response.ok) {
    let message = "Could not convert premium reel to MP4.";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch {}
    throw new Error(message);
  }

  const mp4Blob = await response.blob();
  options.onDownloading?.();
  triggerDownload(mp4Blob, filename);

  return {
    filename,
    size: mp4Blob.size,
  };
}
