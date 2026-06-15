function safeDownloadName(value) {
  const base = String(value || "facebook-reel")
    .replace(/\.(webm|mp4)$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${base || "facebook-reel"}.mp4`;
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

async function getReelBlob(reel) {
  if (reel?.blob instanceof Blob) {
    return reel.blob;
  }

  if (!reel?.url) {
    throw new Error("This reel does not have a generated video to convert yet.");
  }

  const response = await fetch(reel.url);
  if (!response.ok) {
    throw new Error("Could not load the generated reel video for conversion.");
  }

  return response.blob();
}

export async function downloadFacebookMp4Reel(reel, options = {}) {
  options.onPreparing?.();
  const sourceBlob = await getReelBlob(reel);
  const filename = safeDownloadName(reel?.downloadName || reel?.fileName || reel?.id);

  options.onUploading?.();
  let convertingShown = false;
  const convertingTimer = window.setTimeout(() => {
    convertingShown = true;
    options.onConverting?.();
  }, 800);

  const response = await fetch("/api/convert-reel-mp4", {
    method: "POST",
    headers: {
      "Content-Type": sourceBlob.type || "video/webm",
      "X-Reel-Filename": filename,
    },
    body: sourceBlob,
  }).finally(() => window.clearTimeout(convertingTimer));

  if (!convertingShown) options.onConverting?.();
  if (!response.ok) {
    let message = "Could not convert reel to Facebook MP4.";
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
