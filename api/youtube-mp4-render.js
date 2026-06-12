import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);
const INTER_BOLD_FONT_PATH = require.resolve("@fontsource/inter/files/inter-latin-900-normal.woff");
const interFontBytes = readFileSync(INTER_BOLD_FONT_PATH);
const INTER_BOLD_FONT = opentype.parse(interFontBytes.buffer.slice(interFontBytes.byteOffset, interFontBytes.byteOffset + interFontBytes.byteLength));

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
const DEFAULT_FRAME_COUNT = 10;
const MAX_FRAME_COUNT = 15;
const MAX_DURATION_SECONDS = 30;
const CRF = "18";
const PRESET = "veryfast";
const DEFAULT_AUDIO_PATH = path.join(process.cwd(), "assets", "default-reel-audio.mp3");

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
    .replace(/[^\w\s./&+£,\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDisplayText(value, fallback = "") {
  return String(value || fallback)
    .replace(/\u00c2\u00a3/g, "\u00a3")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
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
  if (state.offset < file.length && file[state.offset] <= 32) state.offset += 1;
  const pixels = file.subarray(state.offset);
  const expectedBytes = width * height * 3;
  if (pixels.length < expectedBytes) {
    throw new Error(`PPM output was shorter than expected for ${path.basename(filePath)}.`);
  }
  return { width, height, pixels: pixels.subarray(0, expectedBytes) };
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
  return {
    bytes,
    size: bytes.length,
    contentType: response.headers.get("content-type") || "image/jpeg",
  };
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

function safeFrameCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FRAME_COUNT;
  return Math.max(1, Math.min(MAX_FRAME_COUNT, Math.round(parsed)));
}

function safeDurationSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DURATION_SECONDS;
  return Math.max(5, Math.min(MAX_DURATION_SECONDS, Math.round(parsed)));
}

function safeFps(value) {
  return Number(value) === 30 ? 30 : 24;
}

function buildFrameSpecs(body, frameCount) {
  const productKey = body.productKey === "rent2buy" ? "rent2buy" : "vanFinance";
  const defaults = productDefaults(productKey);
  const title = safeDisplayText(body.title || body.vehicleTitle, "Selected Vehicle");
  const registration = safeDisplayText(body.registration || body.reg, "");
  const priceText = safeDisplayText(body.priceText || body.price || body.vehiclePrice, "");
  const monthlyText = safeDisplayText(body.monthlyText || body.monthly || body.financeMonthly || body.weeklyText, "");
  const paymentText = monthlyText
    ? productKey === "rent2buy"
      ? monthlyText
      : `BUY THIS VAN FROM ONLY ${monthlyText}`
    : defaults.paymentFallback;

  const suppliedFrames = Array.isArray(body.frameSpecs) ? body.frameSpecs : [];
  const baseFrames = [
    { headline: safeDisplayText(body.hook || defaults.hook), support: registration || defaults.productName },
    { headline: title, support: priceText || registration || defaults.productName },
    { headline: paymentText, support: registration },
    ...defaults.featureLines.map((line) => ({ headline: line, support: defaults.website })),
    { headline: defaults.finalHeadline, support: defaults.website, button: defaults.finalButton, finalCta: true },
  ].slice(0, frameCount);

  while (baseFrames.length < frameCount) {
    baseFrames.splice(baseFrames.length - 1, 0, { headline: defaults.featureLines[0], support: defaults.website });
  }

  return baseFrames.map((frame, index) => {
    const supplied = suppliedFrames[index] && typeof suppliedFrames[index] === "object" ? suppliedFrames[index] : {};
    const finalCta = index === frameCount - 1;
    return {
      ...frame,
      ...supplied,
      headline: safeDisplayText(supplied.headline || supplied.title || frame.headline),
      support: safeDisplayText(supplied.support || supplied.subheading || frame.support),
      button: finalCta ? safeDisplayText(supplied.button || supplied.cta || frame.button || defaults.finalButton) : "",
      finalCta,
    };
  });
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitSvgLines(text, maxChars, maxLines = 2) {
  return wrapText(text, maxChars, maxLines).map((line) => line.toUpperCase());
}

function splitVectorLines(text, maxWidth, size, maxLines = 2) {
  const words = safeDisplayText(text).toUpperCase().split(" ").filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measureVectorText(next, size) <= maxWidth) {
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

function measureVectorText(text, size, letterSpacing = 0) {
  const normalized = safeDisplayText(text).toUpperCase();
  let width = 0;
  for (const char of normalized) {
    const glyph = INTER_BOLD_FONT.charToGlyph(char);
    width += (glyph.advanceWidth || INTER_BOLD_FONT.unitsPerEm * 0.5) * (size / INTER_BOLD_FONT.unitsPerEm) + letterSpacing;
  }
  return Math.max(0, width - letterSpacing);
}

function vectorTextPath(text, x, y, size, { anchor = "start", letterSpacing = 0 } = {}) {
  const normalized = safeDisplayText(text).toUpperCase();
  let cursor = anchor === "middle" ? x - measureVectorText(normalized, size, letterSpacing) / 2 : x;
  const parts = [];
  for (const char of normalized) {
    const glyph = INTER_BOLD_FONT.charToGlyph(char);
    parts.push(glyph.getPath(cursor, y, size).toPathData(2));
    cursor += (glyph.advanceWidth || INTER_BOLD_FONT.unitsPerEm * 0.5) * (size / INTER_BOLD_FONT.unitsPerEm) + letterSpacing;
  }
  return parts.join(" ");
}

function containsEmoji(text) {
  return /[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(String(text || ""));
}

function isEmojiChar(char) {
  return /[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(char);
}

function emojiIcon(char, x, y, size) {
  const box = size * 0.72;
  const top = y - size * 0.76;
  const centerY = top + box / 2;
  if (["✅", "✔", "☑", "✓"].includes(char)) {
    return `<rect x="${x}" y="${top}" width="${box}" height="${box}" rx="${box * 0.2}" fill="#10b95c"/>
      <path d="M ${x + box * 0.22} ${top + box * 0.53} L ${x + box * 0.42} ${top + box * 0.72} L ${x + box * 0.8} ${top + box * 0.28}" fill="none" stroke="#ffffff" stroke-width="${box * 0.12}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (char === "🔥") {
    return `<path d="M ${x + box * 0.5} ${top} C ${x + box * 0.82} ${top + box * 0.28}, ${x + box * 0.86} ${top + box * 0.64}, ${x + box * 0.55} ${top + box} C ${x + box * 0.2} ${top + box * 0.78}, ${x + box * 0.1} ${top + box * 0.45}, ${x + box * 0.36} ${top + box * 0.18} C ${x + box * 0.34} ${top + box * 0.42}, ${x + box * 0.48} ${top + box * 0.46}, ${x + box * 0.5} ${top} Z" fill="#ff7a18"/>
      <path d="M ${x + box * 0.48} ${top + box * 0.34} C ${x + box * 0.66} ${top + box * 0.55}, ${x + box * 0.62} ${top + box * 0.78}, ${x + box * 0.45} ${top + box * 0.92} C ${x + box * 0.28} ${top + box * 0.72}, ${x + box * 0.34} ${top + box * 0.54}, ${x + box * 0.48} ${top + box * 0.34} Z" fill="#ffe45c"/>`;
  }
  if (["⭐", "★"].includes(char)) {
    const cx = x + box / 2;
    const cy = centerY;
    const r1 = box * 0.44;
    const r2 = box * 0.2;
    const points = Array.from({ length: 10 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const r = index % 2 === 0 ? r1 : r2;
      return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
    }).join(" ");
    return `<polygon points="${points}" fill="#ffd166"/>`;
  }
  if (["⚡", "🚀"].includes(char)) {
    return `<path d="M ${x + box * 0.56} ${top} L ${x + box * 0.18} ${top + box * 0.55} H ${x + box * 0.48} L ${x + box * 0.36} ${top + box} L ${x + box * 0.82} ${top + box * 0.36} H ${x + box * 0.52} Z" fill="#ffd166"/>`;
  }
  if (["🚚", "🚛"].includes(char)) {
    return `<rect x="${x + box * 0.08}" y="${top + box * 0.28}" width="${box * 0.52}" height="${box * 0.38}" rx="${box * 0.06}" fill="#ffffff"/>
      <path d="M ${x + box * 0.6} ${top + box * 0.4} H ${x + box * 0.8} L ${x + box * 0.9} ${top + box * 0.56} V ${top + box * 0.66} H ${x + box * 0.6} Z" fill="#ffffff"/>
      <circle cx="${x + box * 0.28}" cy="${top + box * 0.72}" r="${box * 0.09}" fill="#ef233c"/>
      <circle cx="${x + box * 0.76}" cy="${top + box * 0.72}" r="${box * 0.09}" fill="#ef233c"/>`;
  }
  if (char === "✅" || char === "✔" || char === "☑") {
    return `<rect x="${x}" y="${top}" width="${box}" height="${box}" rx="${box * 0.2}" fill="#10b95c"/>
      <path d="M ${x + box * 0.22} ${top + box * 0.53} L ${x + box * 0.42} ${top + box * 0.72} L ${x + box * 0.8} ${top + box * 0.28}" fill="none" stroke="#ffffff" stroke-width="${box * 0.12}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (char === "🔥") {
    return `<path d="M ${x + box * 0.5} ${top} C ${x + box * 0.82} ${top + box * 0.28}, ${x + box * 0.86} ${top + box * 0.64}, ${x + box * 0.55} ${top + box} C ${x + box * 0.2} ${top + box * 0.78}, ${x + box * 0.1} ${top + box * 0.45}, ${x + box * 0.36} ${top + box * 0.18} C ${x + box * 0.34} ${top + box * 0.42}, ${x + box * 0.48} ${top + box * 0.46}, ${x + box * 0.5} ${top} Z" fill="#ff7a18"/>
      <path d="M ${x + box * 0.48} ${top + box * 0.34} C ${x + box * 0.66} ${top + box * 0.55}, ${x + box * 0.62} ${top + box * 0.78}, ${x + box * 0.45} ${top + box * 0.92} C ${x + box * 0.28} ${top + box * 0.72}, ${x + box * 0.34} ${top + box * 0.54}, ${x + box * 0.48} ${top + box * 0.34} Z" fill="#ffe45c"/>`;
  }
  return "";
}

function svgMixedText(text, { x, y, size, fill = "#ffffff", anchor = "start", letterSpacing = 0 }) {
  const normalized = safeDisplayText(text).toUpperCase();
  const widths = [...normalized].map((char) => {
    if (char === " ") return size * 0.34;
    return isEmojiChar(char) ? size * 0.82 : measureVectorText(char, size, 0);
  });
  const totalWidth = widths.reduce((sum, width) => sum + width + letterSpacing, 0) - letterSpacing;
  let cursor = anchor === "middle" ? x - totalWidth / 2 : anchor === "end" ? x - totalWidth : x;
  const parts = [];
  [...normalized].forEach((char, index) => {
    if (isEmojiChar(char)) {
      parts.push(emojiIcon(char, cursor, y, size));
    } else {
      const glyph = INTER_BOLD_FONT.charToGlyph(char);
      parts.push(`<path d="${glyph.getPath(cursor, y, size).toPathData(2)}" fill="${fill}"/>`);
    }
    cursor += widths[index] + letterSpacing;
  });
  return parts.join("");
}

function svgPathText(text, { x, y, size, fill = "#ffffff", anchor = "start", letterSpacing = 0 }) {
  if (containsEmoji(text)) return svgMixedText(text, { x, y, size, fill, anchor, letterSpacing });
  const d = vectorTextPath(text, x, y, size, { anchor, letterSpacing });
  return d ? `<path d="${d}" fill="${fill}"/>` : "";
}

function svgTextBlock(lines, { x, y, size, weight = 900, fill = "#ffffff", lineGap = 1.08, anchor = "start", letterSpacing = 0 }) {
  return lines
    .filter(Boolean)
    .map((line, index) => {
      const dy = index === 0 ? 0 : size * lineGap;
      return svgPathText(line, { x, y: y + dy, size, fill, anchor, letterSpacing });
    })
    .join("");
}

function imageDataUri(image) {
  const type = /^image\//i.test(image.contentType || "") ? image.contentType : "image/jpeg";
  return `data:${type};base64,${image.bytes.toString("base64")}`;
}

function renderTemplateEffects(templateKey) {
  const normalized = String(templateKey || "blackPremium");
  const isTikTok = normalized === "tiktokPunch";
  const isLuxury = normalized === "luxuryDealer";
  return {
    isTikTok,
    isLuxury,
    bgOpacity: isLuxury ? 0.12 : 0.16,
    overlayOpacity: isLuxury ? 0.76 : 0.7,
    imageGlowBlur: isTikTok ? 36 : isLuxury ? 18 : 28,
    imageGlowColor: isLuxury ? "#ffffff" : "#ef233c",
    imageGlowOpacity: isTikTok ? 0.34 : isLuxury ? 0.12 : 0.24,
    lowerGlowOpacity: isTikTok ? 0.3 : isLuxury ? 0.12 : 0.2,
    sweepOpacity: isTikTok ? 0.12 : isLuxury ? 0.06 : 0.09,
    flashOpacity: isTikTok ? 0.04 : isLuxury ? 0.015 : 0.025,
    imagePunch: isTikTok ? 1.012 : isLuxury ? 1.003 : 1.006,
  };
}

async function writeSvgFrame(filePath, svg) {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      fontFiles: [INTER_BOLD_FONT_PATH],
      defaultFontFamily: "Inter",
      loadSystemFonts: true,
    },
  }).render();
  await fs.writeFile(filePath, rendered.asPng());
}

async function writeVehicleFrame(filePath, { frameNumber, frame, image, defaults, templateKey, headerText }) {
  const finalCta = frame.finalCta;
  const accent = "#ef233c";
  const imageHref = imageDataUri(image);
  const effects = renderTemplateEffects(templateKey);
  const header = safeDisplayText(headerText || defaults.productName).toUpperCase();
  const eyebrow = safeDisplayText(frame.eyebrow || defaults.productName).toUpperCase();
  const headlineSize = 64;
  const headlineLines = splitVectorLines(frame.headline || defaults.hook || "", 900, headlineSize, finalCta ? 2 : 3);
  const supportLines = splitVectorLines(frame.support || defaults.website, 900, 32, finalCta ? 1 : 2);
  const buttonText = safeDisplayText(frame.button || defaults.finalButton).toUpperCase();
  const website = safeDisplayText(frame.support || defaults.website).toUpperCase();
  const panelY = finalCta ? 1178 : 1198;
  const panelHeight = finalCta ? 560 : 560;
  const eyebrowY = finalCta ? 1250 : 1290;
  const headlineY = finalCta ? 1378 : 1402;
  const headlineLineHeight = headlineSize * 1.08;
  const supportY = finalCta ? 1588 : headlineY + headlineLines.length * headlineLineHeight + 72;
  const websiteY = finalCta ? 1740 : 1744;
  const imageScale = effects.imagePunch;
  const imagePanX = frameNumber > 1 ? (frameNumber % 2 === 0 ? 4 : -4) : 0;
  const imagePanY = frameNumber % 3 === 0 ? 3 : 0;
  const imageDrawX = IMAGE_X + imagePanX - (IMAGE_WIDTH * imageScale - IMAGE_WIDTH) / 2;
  const imageDrawY = IMAGE_Y + imagePanY - (IMAGE_HEIGHT * imageScale - IMAGE_HEIGHT) / 2;

  const headlineBlock = finalCta
    ? svgTextBlock(headlineLines, { x: 96, y: headlineY, size: headlineSize, weight: 950, fill: "#ffffff", lineGap: 1.08 })
    : svgTextBlock(headlineLines, { x: 86, y: headlineY, size: headlineSize, weight: 950, fill: "#ffffff", lineGap: 1.08 });

  const supportBlock = finalCta
    ? ""
    : svgTextBlock(supportLines, { x: 86, y: supportY, size: 32, weight: 850, fill: "rgba(255,255,255,0.86)", lineGap: 1.16 });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050608"/>
      <stop offset="0.54" stop-color="#000000"/>
      <stop offset="1" stop-color="${finalCta ? "#24070d" : "#100406"}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="72%" r="45%">
      <stop offset="0" stop-color="${accent}" stop-opacity="${finalCta ? "0.28" : "0.18"}"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lowerGlow" cx="50%" cy="71%" r="48%">
      <stop offset="0" stop-color="${accent}" stop-opacity="${effects.lowerGlowOpacity}"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.48" stop-color="#ffffff" stop-opacity="${effects.sweepOpacity}"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="redStreak" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}" stop-opacity="0"/>
      <stop offset="0.48" stop-color="${accent}" stop-opacity="0.48"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.24"/>
      <stop offset="0.46" stop-color="#08080a" stop-opacity="0.98"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.98"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.16"/>
      <stop offset="0.34" stop-color="#1c080b" stop-opacity="0.88"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.76"/>
    </linearGradient>
    <clipPath id="imageClip">
      <rect x="${IMAGE_X}" y="${IMAGE_Y}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" rx="30" ry="30"/>
    </clipPath>
    <clipPath id="panelClip">
      <rect x="52" y="${panelY}" width="976" height="${panelHeight}" rx="28" ry="28"/>
    </clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="${effects.imageGlowBlur}" flood-color="${effects.imageGlowColor}" flood-opacity="${effects.imageGlowOpacity}"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <image href="${imageHref}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice" opacity="${effects.bgOpacity}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#000000" opacity="${effects.overlayOpacity}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#lowerGlow)"/>

  <rect x="58" y="74" width="964" height="154" rx="26" fill="url(#header)"/>
  <rect x="58" y="220" width="964" height="8" fill="${accent}"/>
  ${svgPathText(header, { x: 540, y: 168, size: 58, fill: "#ffffff", anchor: "middle" })}

  <rect x="${IMAGE_X - 8}" y="${IMAGE_Y - 8}" width="${IMAGE_WIDTH + 16}" height="${IMAGE_HEIGHT + 16}" rx="34" fill="#000000" filter="url(#shadow)"/>
  <rect x="${IMAGE_X}" y="${IMAGE_Y}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" rx="30" fill="#101014"/>
  <image href="${imageHref}" x="${imageDrawX}" y="${imageDrawY}" width="${IMAGE_WIDTH * imageScale}" height="${IMAGE_HEIGHT * imageScale}" preserveAspectRatio="xMidYMid meet" clip-path="url(#imageClip)"/>
  <rect x="${IMAGE_X}" y="${IMAGE_Y}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" rx="30" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>

  <rect x="52" y="${panelY}" width="976" height="${panelHeight}" rx="28" fill="url(#panel)"/>
  <rect x="52" y="${panelY}" width="976" height="7" fill="${accent}" opacity="0.9"/>
  ${effects.isTikTok && frameNumber > 1 ? `<rect x="-120" y="${panelY + 26}" width="470" height="82" fill="url(#redStreak)" opacity="0.9" transform="rotate(-10 115 ${panelY + 67})"/>` : ""}
  ${svgPathText(eyebrow, { x: 86, y: eyebrowY, size: 24, fill: accent })}
  ${headlineBlock}
  ${supportBlock}
  ${
    finalCta
      ? `<rect x="130" y="1540" width="820" height="112" rx="32" fill="${accent}"/>
         ${svgPathText(buttonText, { x: 540, y: 1612, size: 44, fill: "#ffffff", anchor: "middle" })}
         ${svgPathText(website, { x: 540, y: websiteY, size: 32, fill: "rgba(255,255,255,0.9)", anchor: "middle" })}`
      : `${svgPathText(defaults.website, { x: 540, y: websiteY, size: 30, fill: "rgba(255,255,255,0.9)", anchor: "middle" })}`
  }
  ${(finalCta || frameNumber === 1 || frameNumber >= 3) ? `<g clip-path="url(#panelClip)"><rect x="-20" y="${panelY + 20}" width="220" height="${panelHeight + 110}" fill="url(#sweep)" transform="rotate(-18 90 ${panelY + 120})"/></g>` : ""}
  ${frameNumber > 1 ? `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" opacity="${effects.flashOpacity}"/>` : ""}
</svg>`;

  await writeSvgFrame(filePath, svg);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const body = parseBody(req);

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    sendJson(res, 500, {
      ok: false,
      error: "Vercel Blob is not configured. Missing Blob credentials.",
    });
    return;
  }

  const productKey = body.productKey === "rent2buy" ? "rent2buy" : body.productKey === "vanFinance" ? "vanFinance" : "";
  if (!productKey) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing or invalid productKey. Expected vanFinance or rent2buy.",
    });
    return;
  }

  if (!Array.isArray(body.frameSpecs) || !body.frameSpecs.length) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing frameSpecs for YouTube MP4 render.",
    });
    return;
  }

  const frameCount = safeFrameCount(body.frameCount || body.frameSpecs.length);
  const imageUrls = [...new Set((Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(Boolean).map(String))].slice(0, frameCount);
  if (!imageUrls.length) {
    sendJson(res, 400, {
      ok: false,
      error: "At least one image URL is required for YouTube MP4 render.",
    });
    return;
  }

  const defaults = productDefaults(productKey);
  const frameSpecs = buildFrameSpecs(body, frameCount);
  const fps = safeFps(body.fps || DEFAULT_FPS);
  const durationSeconds = safeDurationSeconds(body.durationSeconds || DEFAULT_DURATION_SECONDS);
  const frameSeconds = durationSeconds / frameCount;
  const templateKey = safeText(body.templateKey, "blackPremium") || "blackPremium";
  const headerText = safeDisplayText(body.headerText || body.header || defaults.productName);
  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[^0-9]/g, "");
  const registration = safeText(body.registration || body.reg || "vehicle").replace(/\s+/g, "").toLowerCase();
  const blobPath = `${POC_PREFIX}/youtube-render-${productKey}-${registration}-${stamp}.mp4`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mp4-render-"));
  const outputPath = path.join(workDir, "youtube-mp4-render.mp4");
  const concatPath = path.join(workDir, "frames.txt");

  console.log("[youtube-mp4-render] render start", {
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
      try {
        preparedImages.push(await downloadImage(imageUrls[index], imagePath));
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
    for (let index = 0; index < frameCount; index += 1) {
      const framePath = path.join(workDir, `frame-${index + 1}.png`);
      const image = preparedImages[Math.min(index, preparedImages.length - 1)];
      await writeVehicleFrame(framePath, {
        frameNumber: index + 1,
        frame: frameSpecs[index],
        image,
        defaults,
        templateKey,
        headerText,
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

    const audioEmbedded = await fileExists(DEFAULT_AUDIO_PATH);
    const audioWarning = audioEmbedded ? "" : "Default reel audio was not found. Render used silent fallback audio.";
    const audioInputArgs = audioEmbedded
      ? ["-stream_loop", "-1", "-i", DEFAULT_AUDIO_PATH]
      : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
    const audioFilterArgs = audioEmbedded ? ["-af", "volume=0.72"] : [];

    const ffmpegSettings = {
      codec: "libx264",
      crf: Number(CRF),
      preset: PRESET,
      fps,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "128k",
      movflags: "+faststart",
      frameCount,
      frameSeconds,
      templateKey,
      audioSource: audioEmbedded ? "assets/default-reel-audio.mp3" : "silent fallback",
    };

    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      ...audioInputArgs,
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
      "128k",
      ...audioFilterArgs,
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

    console.log("[youtube-mp4-render] upload success", {
      blobPath,
      sizeBytes: output.length,
      renderTimeMs: renderedAt - startedAt,
      totalTimeMs: finishedAt - startedAt,
      url: uploaded.url,
      audioEmbedded,
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
      frameCount,
      finalFrameConfirmed: true,
      sourceImageCount: imageUrls.length,
      usableImageCount: preparedImages.length,
      imageDownloadFailures,
      audioEmbedded,
      audioWarning,
      ffmpegSettings,
      message: "YouTube MP4 generated and uploaded to temporary Blob storage.",
    });
  } catch (error) {
    const message = compactError(error);
    console.error("[youtube-mp4-render] failed", { error: message });
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
