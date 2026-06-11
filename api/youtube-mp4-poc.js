import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";

export const config = {
  maxDuration: 60,
};

const POC_PREFIX = "temp-youtube-renders";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DURATION_SECONDS = 5;

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

function drawTextFilter() {
  const base = "fontcolor=white:borderw=4:bordercolor=black";
  return [
    `drawtext=text='YouTube MP4 POC':${base}:fontsize=78:x=(w-text_w)/2:y=460`,
    `drawtext=text='Frame 1':${base}:fontsize=64:x=(w-text_w)/2:y=760:enable='lt(t,2)'`,
    `drawtext=text='Final CTA Test':fontcolor=white:borderw=5:bordercolor=black:fontsize=82:x=(w-text_w)/2:y=1120:enable='gte(t,3.5)'`,
    "drawbox=x=120:y=1320:w=840:h=120:color=#ef233c@0.95:t=fill:enable='gte(t,3.5)'",
    `drawtext=text='APPLY NOW':fontcolor=white:fontsize=54:x=(w-text_w)/2:y=1354:enable='gte(t,3.5)'`,
  ].join(",");
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
  const blobPath = `${POC_PREFIX}/poc-${stamp}.mp4`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mp4-poc-"));
  const outputPath = path.join(workDir, "youtube-mp4-poc.mp4");

  console.log("[youtube-mp4-poc] render start", { startedAt: new Date(startedAt).toISOString(), blobPath });

  try {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=#050608:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION_SECONDS}`,
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=44100`,
      "-t",
      String(DURATION_SECONDS),
      "-vf",
      drawTextFilter(),
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "19",
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

    console.log("[youtube-mp4-poc] upload success", {
      blobPath,
      sizeBytes: output.length,
      renderMs: renderedAt - startedAt,
      totalMs: finishedAt - startedAt,
      url: uploaded.url,
    });

    sendJson(res, 200, {
      ok: true,
      downloadUrl: uploaded.url,
      pathname: uploaded.pathname || blobPath,
      sizeBytes: output.length,
      durationSeconds: DURATION_SECONDS,
      renderMs: renderedAt - startedAt,
      totalMs: finishedAt - startedAt,
      message: "POC MP4 generated and uploaded to temporary Blob storage.",
    });
  } catch (error) {
    const message = compactFfmpegError(error);
    console.error("[youtube-mp4-poc] failed", { error: message });
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
