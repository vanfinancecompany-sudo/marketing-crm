function safeDownloadName(value) {
  const base = String(value || "facebook-reel")
    .replace(/\.(webm|mp4)$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${base || "facebook-reel"}.mp4`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read reel video."));
    reader.readAsDataURL(blob);
  });
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

export async function downloadFacebookMp4Reel(reel) {
  const sourceBlob = await getReelBlob(reel);
  const filename = safeDownloadName(reel?.downloadName || reel?.fileName || reel?.id);
  const videoDataUrl = await blobToDataUrl(sourceBlob);

  const response = await fetch("/api/convert-reel-mp4", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename,
      videoDataUrl,
    }),
  });

  if (!response.ok) {
    let message = "Could not convert reel to Facebook MP4.";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch {}
    throw new Error(message);
  }

  const mp4Blob = await response.blob();
  triggerDownload(mp4Blob, filename);

  return {
    filename,
    size: mp4Blob.size,
  };
}
