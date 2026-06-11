import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";

export const config = {
  maxDuration: 120,
};

const POC_PREFIX = "temp-youtube-renders";
const WIDTH = 1080;
const HEIGHT = 1920;
const IMAGE_WIDTH = 940;
const IMAGE_HEIGHT = 820;
const IMAGE_X = 70;
const IMAGE_Y = 275;
const DEFAULT_FPS = 30;
const DEFAULT_DURATION_SECONDS = 20;
const FRAME_COUNT = 10;
const CRF = "18";
const PRESET = "veryfast";

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function compactError(error) {
  return String(error?.message || "Real vehicle MP4 POC failed.")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .join(" ")
    .slice(0, 1600);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("FFmpeg binary is not available."));
      return;
    }

    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

function safeText(value, fallback = "") {
  return String(value || fallback)
    .replace(/[^\w\s./&+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, maxChars, maxLines = 2) {
  const words = safeText(text).split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [""];
}

function setPixel(buffer, x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 3;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
}

function fillRect(buffer, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + height); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(WIDTH, x + width); col += 1) {
      setPixel(buffer, col, row, color);
    }
  }
}

function drawText(buffer, text, x, y, scale, color) {
  const normalized = safeText(text).toUpperCase();
  let cursorX = x;
  for (const char of normalized) {
    const glyph = FONT[char] || FONT[" "];
    glyph.forEach((rowPattern, row) => {
      [...rowPattern].forEach((cell, col) => {
        if (cell !== "1") return;
        fillRect(buffer, cursorX + col * scale, y + row * scale, scale, scale, color);
      });
    });
    cursorX += 6 * scale;
  }
}

function textWidth(text, scale) {
  return safeText(text).length * 6 * scale;
}

function centeredTextX(text, scale) {
  return Math.round((WIDTH - textWidth(text, scale)) / 2);
}

function drawCenteredText(buffer, text, y, scale, color) {
  drawText(buffer, text, centeredTextX(text, scale), y, scale, color);
}

function drawWrappedLeft(buffer, text, x, y, scale, color, maxChars, maxLines = 2, lineGap = 18) {
  const lines = wrapText(text, maxChars, maxLines);
  lines.forEach((line, index) => {
    drawText(buffer, line, x, y + index * (7 * scale + lineGap), scale, color);
  });
}

function writePpm(filePath, buffer, width = WIDTH, height = HEIGHT) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  return fs.writeFile(filePath, Buffer.concat([header, buffer]));
}

function readToken(file, state) {
  while (state.offset < file.length && file[state.offset] <= 32) state.offset += 1;
  if (file[state.offset] === 35) {
    while (state.offset < file.length && file[state.offset] !== 10) state.offset += 1;
    return readToken(file, state);
  }
  const start = state.offset;
  while (state.offset < file.length && file[state.offset] > 32) state.offset += 1;
  return file.toString("ascii", start, state.offset);
}

async function readPpm(filePath) {
  const file = await fs.readFile(filePath);
  const state = { offset: 0 };
  const magic = readToken(file, state);
  const width = Number(readToken(file, state));
  const height = Number(readToken(file, state));
  const max = Number(readToken(file, state));
  if (magic !== "P6" || !width || !height || max !== 255) {
    throw new Error(`Unsupported PPM output for ${path.basename(filePath)}.`);
  }
  while (state.offset < file.length && file[state.offset] <= 32) state.offset += 1;
  return { width, height, pixels: file.subarray(state.offset) };
}

function blitImage(target, image, x, y) {
  for (let row = 0; row < image.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= HEIGHT) continue;
    const sourceStart = row * image.width * 3;
    const sourceEnd = sourceStart + image.width * 3;
    const targetStart = (targetY * WIDTH + x) * 3;
    image.pixels.copy(target, targetStart, sourceStart, sourceEnd);
  }
}

async function downloadImage(url, filePath) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    throw new Error(`Image download failed ${response.status} for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
  return bytes.length;
}

async function prepareImagePpm(imagePath, ppmPath) {
  await runFfmpeg([
    "-y",
    "-i",
    imagePath,
    "-vf",
    `scale=${IMAGE_WIDTH}:${IMAGE_HEIGHT}:force_original_aspect_ratio=decrease,pad=${IMAGE_WIDTH}:${IMAGE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x101014,format=rgb24`,
    "-frames:v",
    "1",
    ppmPath,
  ]);
  return readPpm(ppmPath);
}

function productDefaults(productKey) {
  if (productKey === "rent2buy") {
    return {
      productName: "RENT2BUY VANS",
      hook: "NO CREDIT CHECK",
      website: "www.rent2buyvans.co.uk",
      finalHeadline: "CHECK IF YOU QUALIFY",
      finalButton: "APPLY ONLINE",
      paymentFallback: "RENT IT DRIVE IT OWN IT",
      featureLines: [
        "NOT YOUR CREDIT SCORE",
        "AFFORDABILITY BASED",
        "DRIVE AWAY SOON",
        "HUGE STOCK CHOICE",
        "FINAL PAYMENT ITS YOURS",
        "APPLY ONLINE TODAY",
      ],
    };
  }

  return {
    productName: "VAN FINANCE COMPANY",
    hook: "FROM 99 DEPOSIT",
    website: "www.vanfinancecompany.co.uk",
    finalHeadline: "APPLY ONLINE TODAY",
    finalButton: "START APPLICATION",
    paymentFallback: "FLEXIBLE VAN FINANCE",
    featureLines: [
      "GOOD OR BAD CREDIT",
      "ALL CREDIT PROFILES",
      "LOW DEPOSIT OPTIONS",
      "SELF EMPLOYED WELCOME",
      "FAST ONLINE APPLICATION",
      "NO.1 VAN FINANCE",
    ],
  };
}

function buildFrameSpecs(body) {
  const productKey = body.productKey === "rent2buy" ? "rent2buy" : "vanFinance";
  const defaults = productDefaults(productKey);
  const title = safeText(body.title || body.vehicleTitle, "Selected Vehicle");
  const registration = safeText(body.registration || body.reg, "");
  const priceText = safeText(body.priceText || body.price || body.vehiclePrice, "");
  const monthlyText = safeText(body.monthlyText || body.monthly || body.financeMonthly || body.weeklyText, "");
  const paymentText = monthlyText
    ? productKey === "rent2buy"
      ? monthlyText
      : `BUY THIS VAN FROM ONLY ${monthlyText}`
    : defaults.paymentFallback;

  const suppliedFrames = Array.isArray(body.frameSpecs) ? body.frameSpecs : [];
  const baseFrames = [
    { headline: safeText(body.hook || defaults.hook), support: registration || defaults.productName },
    { headline: title, support: priceText || registration || defaults.productName },
    { headline: paymentText, support: registration },
    ...defaults.featureLines.map((line) => ({ headline: line, support: defaults.website })),
    { headline: defaults.finalHeadline, support: defaults.website, button: defaults.finalButton, finalCta: true },
  ].slice(0, FRAME_COUNT);

  while (baseFrames.length < FRAME_COUNT) {
    baseFrames.splice(baseFrames.length - 1, 0, { headline: defaults.featureLines[0], support: defaults.website });
  }

  return baseFrames.map((frame, index) => {
    const supplied = suppliedFrames[index] && typeof suppliedFrames[index] === "object" ? suppliedFrames[index] : {};
    const finalCta = index === FRAME_COUNT - 1;
    return {
      ...frame,
      ...supplied,
      headline: safeText(supplied.headline || supplied.title || frame.headline),
      support: safeText(supplied.support || supplied.subheading || frame.support),
      button: finalCta ? safeText(supplied.button || supplied.cta || frame.button || defaults.finalButton) : "",
      finalCta,
    };
  });
}

async function writeVehicleFrame(filePath, { frameNumber, frame, image, defaults }) {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
  const finalCta = frame.finalCta;

  for (let y = 0; y < HEIGHT; y += 1) {
    const shade = Math.round(5 + (y / HEIGHT) * 22);
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      const vignette = Math.abs(x - WIDTH / 2) / (WIDTH / 2);
      buffer[offset] = Math.max(0, shade + (finalCta ? 32 : 10) - Math.round(vignette * 10));
      buffer[offset + 1] = Math.max(0, shade - Math.round(vignette * 7));
      buffer[offset + 2] = shade + 7;
    }
  }

  fillRect(buffer, 0, 0, WIDTH, 235, [10, 10, 15]);
  fillRect(buffer, 0, 235, WIDTH, 10, [239, 35, 60]);
  drawCenteredText(buffer, defaults.productName, 95, 8, [255, 255, 255]);
  drawText(buffer, `FRAME ${frameNumber}`, 70, 178, 5, [239, 35, 60]);

  fillRect(buffer, IMAGE_X - 8, IMAGE_Y - 8, IMAGE_WIDTH + 16, IMAGE_HEIGHT + 16, [0, 0, 0]);
  blitImage(buffer, image, IMAGE_X, IMAGE_Y);
  fillRect(buffer, IMAGE_X, IMAGE_Y + IMAGE_HEIGHT, IMAGE_WIDTH, 8, [239, 35, 60]);

  if (finalCta) {
    drawWrappedLeft(buffer, frame.headline, 110, 1190, 11, [255, 255, 255], 14, 2, 22);
    fillRect(buffer, 110, 1450, WIDTH - 220, 145, [239, 35, 60]);
    drawCenteredText(buffer, frame.button, 1497, 8, [255, 255, 255]);
    drawCenteredText(buffer, frame.support || defaults.website, 1665, 5, [255, 255, 255]);
  } else {
    drawText(buffer, defaults.productName, 86, 1160, 4, [239, 35, 60]);
    drawWrappedLeft(buffer, frame.headline, 86, 1225, 8, [255, 255, 255], 18, 2, 18);
    if (frame.support) {
      drawWrappedLeft(buffer, frame.support, 86, 1435, 5, [255, 255, 255], 30, 2, 14);
    }
    drawCenteredText(buffer, defaults.website, 1655, 5, [255, 255, 255]);
  }

  await writePpm(filePath, buffer);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const body = parseBody(req);
  if (body.confirmPoc !== true) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing confirmPoc safety flag.",
      expectedBody: { confirmPoc: true },
    });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    sendJson(res, 500, {
      ok: false,
      error: "Vercel Blob is not configured. Missing Blob credentials.",
    });
    return;
  }

  const imageUrls = [...new Set((Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(Boolean).map(String))].slice(0, FRAME_COUNT);
  if (!imageUrls.length) {
    sendJson(res, 400, {
      ok: false,
      error: "At least one image URL is required for the real vehicle POC.",
    });
    return;
  }

  const productKey = body.productKey === "rent2buy" ? "rent2buy" : "vanFinance";
  const defaults = productDefaults(productKey);
  const frameSpecs = buildFrameSpecs(body);
  const fps = Number(body.fps || DEFAULT_FPS) || DEFAULT_FPS;
  const durationSeconds = Number(body.durationSeconds || DEFAULT_DURATION_SECONDS) || DEFAULT_DURATION_SECONDS;
  const frameSeconds = durationSeconds / FRAME_COUNT;
  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[^0-9]/g, "");
  const registration = safeText(body.registration || body.reg || "vehicle").replace(/\s+/g, "").toLowerCase();
  const blobPath = `${POC_PREFIX}/real-vehicle-poc-${productKey}-${registration}-${stamp}.mp4`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-real-vehicle-poc-"));
  const outputPath = path.join(workDir, "youtube-real-vehicle-poc.mp4");
  const concatPath = path.join(workDir, "frames.txt");

  console.log("[youtube-mp4-real-vehicle-poc] render start", {
    startedAt: new Date(startedAt).toISOString(),
    blobPath,
    imageCount: imageUrls.length,
    productKey,
  });

  try {
    const preparedImages = [];
    const imageDownloadFailures = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const imagePath = path.join(workDir, `source-${index + 1}`);
      const ppmPath = path.join(workDir, `source-${index + 1}.ppm`);
      try {
        await downloadImage(imageUrls[index], imagePath);
        preparedImages.push(await prepareImagePpm(imagePath, ppmPath));
      } catch (error) {
        imageDownloadFailures.push({
          index: index + 1,
          url: imageUrls[index],
          error: compactError(error),
        });
      }
    }

    if (!preparedImages.length) {
      throw new Error("No supplied image URLs could be downloaded for the real vehicle POC.");
    }

    const framePaths = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const framePath = path.join(workDir, `frame-${index + 1}.ppm`);
      const image = preparedImages[Math.min(index, preparedImages.length - 1)];
      await writeVehicleFrame(framePath, {
        frameNumber: index + 1,
        frame: frameSpecs[index],
        image,
        defaults,
      });
      framePaths.push(framePath);
    }

    const concatLines = [];
    for (const framePath of framePaths) {
      concatLines.push(`file '${framePath.replace(/\\/g, "/")}'`);
      concatLines.push(`duration ${frameSeconds}`);
    }
    concatLines.push(`file '${framePaths[framePaths.length - 1].replace(/\\/g, "/")}'`);
    await fs.writeFile(concatPath, concatLines.join("\n"), "utf8");

    const ffmpegSettings = {
      codec: "libx264",
      crf: Number(CRF),
      preset: PRESET,
      fps,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "96k",
      movflags: "+faststart",
      frameCount: FRAME_COUNT,
      frameSeconds,
      templateKey: safeText(body.templateKey, "blackPremium") || "blackPremium",
    };

    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      String(durationSeconds),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      PRESET,
      "-crf",
      CRF,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const renderedAt = Date.now();
    const output = await fs.readFile(outputPath);
    const uploaded = await put(blobPath, output, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    const finishedAt = Date.now();

    console.log("[youtube-mp4-real-vehicle-poc] upload success", {
      blobPath,
      sizeBytes: output.length,
      renderTimeMs: renderedAt - startedAt,
      totalTimeMs: finishedAt - startedAt,
      url: uploaded.url,
    });

    sendJson(res, 200, {
      ok: true,
      downloadUrl: uploaded.url,
      url: uploaded.url,
      blobPathname: uploaded.pathname || blobPath,
      sizeBytes: output.length,
      durationSeconds,
      renderTimeMs: renderedAt - startedAt,
      totalTimeMs: finishedAt - startedAt,
      frameCount: FRAME_COUNT,
      finalFrameConfirmed: true,
      sourceImageCount: imageUrls.length,
      usableImageCount: preparedImages.length,
      imageDownloadFailures,
      ffmpegSettings,
      message: "Real vehicle YouTube MP4 POC generated and uploaded to temporary Blob storage.",
    });
  } catch (error) {
    const message = compactError(error);
    console.error("[youtube-mp4-real-vehicle-poc] failed", { error: message });
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
