import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

export const config = {
  api: {
    bodyParser: false,
  },
};

const FACEBOOK_REEL_DURATION_SECONDS = 11;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function safeBaseFilename(value) {
  const name = String(value || "facebook-reel")
    .replace(/\.(webm|mp4)$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return name || "facebook-reel";
}

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function parseJsonBuffer(buffer) {
  if (!buffer?.length) return {};

  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return {};
  }
}

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
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
        resolve();
        return;
      }

      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "");
  const rawBody = await readRawBody(req);
  const isJsonRequest = contentType.includes("application/json");
  const jsonBody = isJsonRequest ? parseJsonBuffer(rawBody) : {};
  const parsed = isJsonRequest ? parseDataUrl(jsonBody.videoDataUrl) : null;
  const inputBuffer = parsed?.buffer?.length ? parsed.buffer : rawBody;

  if (!inputBuffer?.length) {
    sendJson(res, 400, { error: "Missing reel video data." });
    return;
  }

  const mimeType = parsed?.mimeType || contentType || "video/webm";
  const requestedFilename = jsonBody.filename || req.headers["x-reel-filename"] || "facebook-reel.mp4";
  const inputExtension = mimeType.includes("mp4") ? "mp4" : "webm";
  const outputName = `${safeBaseFilename(requestedFilename)}.mp4`;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "reel-mp4-"));
  const inputPath = path.join(workDir, `input.${inputExtension}`);
  const outputPath = path.join(workDir, outputName);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await runFfmpeg([
      "-y",
      "-fflags",
      "+genpts",
      "-i",
      inputPath,
      "-t",
      String(FACEBOOK_REEL_DURATION_SECONDS),
      "-vf",
      "fps=30,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "6000k",
      "-maxrate",
      "7000k",
      "-bufsize",
      "12000k",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-avoid_negative_ts",
      "make_zero",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const output = await fs.readFile(outputPath);

    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename=\"${outputName}\"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(output);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Could not convert reel to Facebook MP4.",
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
