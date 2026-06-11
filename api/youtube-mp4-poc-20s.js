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
const FPS = 30;
const DURATION_SECONDS = 20;
const FRAME_SECONDS = 2;
const CRF = "18";
const PRESET = "veryfast";

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
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

const FRAME_TEXT = [
  ["YOUTUBE SHORT POC", "FRAME 1"],
  ["VEHICLE DETAILS FRAME", "FRAME 2"],
  ["PAYMENT FRAME", "FRAME 3"],
  ["FEATURE FRAME 4", "FRAME 4"],
  ["FEATURE FRAME 5", "FRAME 5"],
  ["FEATURE FRAME 6", "FRAME 6"],
  ["FEATURE FRAME 7", "FRAME 7"],
  ["FEATURE FRAME 8", "FRAME 8"],
  ["FEATURE FRAME 9", "FRAME 9"],
  ["FINAL CTA FRAME", "APPLY NOW"],
];

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

function compactFfmpegError(error) {
  return String(error?.message || "FFmpeg failed.")
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
  const normalized = String(text || "").toUpperCase();
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

function centeredTextX(text, scale) {
  return Math.round((WIDTH - String(text || "").length * 6 * scale) / 2);
}

async function writePpmFrame(filePath, { frameNumber, heading, subheading, finalCta }) {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
  const redBoost = finalCta ? 28 : frameNumber * 2;

  for (let y = 0; y < HEIGHT; y += 1) {
    const shade = Math.round(7 + (y / HEIGHT) * 27);
    for (let x = 0; x < WIDTH; x += 1) {
      const vignette = Math.abs(x - WIDTH / 2) / (WIDTH / 2);
      const offset = (y * WIDTH + x) * 3;
      buffer[offset] = Math.max(0, shade + redBoost - Math.round(vignette * 12));
      buffer[offset + 1] = Math.max(0, shade - Math.round(vignette * 8));
      buffer[offset + 2] = shade + 7;
    }
  }

  fillRect(buffer, 0, 0, WIDTH, 230, [15, 15, 19]);
  fillRect(buffer, 0, 230, WIDTH, 12, finalCta ? [255, 35, 64] : [239, 35, 60]);
  fillRect(buffer, 70, 395, WIDTH - 140, 620, [20 + redBoost, 8, 12]);
  fillRect(buffer, 70, 395, WIDTH - 140, 14, [239, 35, 60]);
  fillRect(buffer, 70, 1001, WIDTH - 140, 14, [239, 35, 60]);
  drawText(buffer, `FRAME ${frameNumber}`, 70, 110, 8, [239, 35, 60]);
  drawText(buffer, heading, centeredTextX(heading, finalCta ? 10 : 9), 600, finalCta ? 10 : 9, [255, 255, 255]);
  drawText(buffer, subheading, centeredTextX(subheading, finalCta ? 11 : 8), 1130, finalCta ? 11 : 8, [255, 255, 255]);

  if (finalCta) {
    fillRect(buffer, 140, 1320, WIDTH - 280, 150, [239, 35, 60]);
    drawText(buffer, "FINAL CTA", centeredTextX("FINAL CTA", 10), 1368, 10, [255, 255, 255]);
    drawText(buffer, "BLOB MP4 TEST", centeredTextX("BLOB MP4 TEST", 6), 1535, 6, [255, 255, 255]);
  }

  const header = Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, "ascii");
  await fs.writeFile(filePath, Buffer.concat([header, buffer]));
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

  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[^0-9]/g, "");
  const blobPath = `${POC_PREFIX}/poc-20s-${stamp}.mp4`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mp4-poc-20s-"));
  const outputPath = path.join(workDir, "youtube-mp4-poc-20s.mp4");
  const concatPath = path.join(workDir, "frames.txt");

  console.log("[youtube-mp4-poc-20s] render start", { startedAt: new Date(startedAt).toISOString(), blobPath });

  try {
    const framePaths = [];
    for (let index = 0; index < FRAME_TEXT.length; index += 1) {
      const framePath = path.join(workDir, `frame-${index + 1}.ppm`);
      const [heading, subheading] = FRAME_TEXT[index];
      await writePpmFrame(framePath, {
        frameNumber: index + 1,
        heading,
        subheading,
        finalCta: index === FRAME_TEXT.length - 1,
      });
      framePaths.push(framePath);
    }

    const concatLines = [];
    for (const framePath of framePaths) {
      concatLines.push(`file '${framePath.replace(/\\/g, "/")}'`);
      concatLines.push(`duration ${FRAME_SECONDS}`);
    }
    concatLines.push(`file '${framePaths[framePaths.length - 1].replace(/\\/g, "/")}'`);
    await fs.writeFile(concatPath, concatLines.join("\n"), "utf8");

    const ffmpegArgs = [
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
      String(DURATION_SECONDS),
      "-r",
      String(FPS),
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
    ];

    await runFfmpeg(ffmpegArgs);

    const renderedAt = Date.now();
    const output = await fs.readFile(outputPath);
    const uploaded = await put(blobPath, output, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
    });
    const finishedAt = Date.now();

    console.log("[youtube-mp4-poc-20s] upload success", {
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
      pathname: uploaded.pathname || blobPath,
      sizeBytes: output.length,
      durationSeconds: DURATION_SECONDS,
      renderTimeMs: renderedAt - startedAt,
      totalTimeMs: finishedAt - startedAt,
      ffmpegSettings: {
        codec: "libx264",
        crf: Number(CRF),
        preset: PRESET,
        fps: FPS,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        audioBitrate: "96k",
        movflags: "+faststart",
        frameCount: FRAME_TEXT.length,
        frameSeconds: FRAME_SECONDS,
      },
      message: "20-second YouTube MP4 POC generated and uploaded to temporary Blob storage.",
    });
  } catch (error) {
    const message = compactFfmpegError(error);
    console.error("[youtube-mp4-poc-20s] failed", { error: message });
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
