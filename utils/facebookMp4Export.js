function safeDownloadName(value) {
  const base = String(value || "facebook-reel")
    .replace(/\.(webm|mp4)$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${base || "facebook-reel"}.mp4`;
}

function safeTextDownloadName(value) {
  return safeDownloadName(value).replace(/\.mp4$/i, "-description.txt");
}

function cleanTextValue(value) {
  return String(value || "")
    .replace(/Â£/g, "£")
    .replace(/â€“/g, "–")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function getReelRegistration(reel) {
  return cleanTextValue(
    reel?.registration ||
      reel?.vehicle?.reg ||
      reel?.vehicle?.registration ||
      reel?.reg ||
      ""
  )
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getReelTitle(reel) {
  return cleanTextValue(
    reel?.title ||
      reel?.vehicle?.vanDescription ||
      reel?.vehicle?.description ||
      reel?.vehicle?.name ||
      "Van"
  );
}

function formatReelSpecs(reel) {
  const lines = [];
  const reg = getReelRegistration(reel);
  const description = cleanTextValue(reel?.description || reel?.vehicle?.spec || reel?.vehicle?.vanSpec || "");
  const year = cleanTextValue(reel?.vehicle?.year || description.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "");
  const mileage = cleanTextValue(
    reel?.vehicle?.mileage ||
      description.match(/\bMILEAGE\s*:?\s*([0-9][0-9,.\s]*)/i)?.[1] ||
      description.match(/\b([0-9][0-9,.\s]*)\s*(?:MILES|MILEAGE)\b/i)?.[1] ||
      ""
  );
  const euro = cleanTextValue(
    reel?.vehicle?.euro || description.match(/\bEURO\s*:?\s*([0-9A-Z]+)/i)?.[1] || ""
  );

  if (reg) lines.push(`REGISTRATION: ${reg}`);
  if (year) lines.push(`YEAR: ${year}`);
  if (mileage) lines.push(`MILEAGE: ${mileage}`);
  if (euro) lines.push(`EURO: ${euro}`);

  return lines.join("\n");
}

function financeVehicleUrl(reel) {
  const reg = getReelRegistration(reel);
  return reg
    ? `https://www.vanfinancecompany.co.uk/van-finance/${encodeURIComponent(reg)}`
    : "https://www.vanfinancecompany.co.uk/";
}

function rentVehicleUrl(reel) {
  const reg = getReelRegistration(reel);
  return reg
    ? `https://www.rent2buyvans.co.uk/van-pages/${encodeURIComponent(reg)}`
    : "https://www.rent2buyvans.co.uk/";
}

function rentMonthlyLine(reel) {
  const priceLine = cleanTextValue(reel?.priceLine || "");
  const monthly = priceLine.split("|")[0]?.trim();
  return monthly ? `NO CREDIT CHECK | ${monthly}` : "NO CREDIT CHECK";
}

function buildReelDescriptionText(reel) {
  const isRent = reel?.pipeline === "rent2buy";
  const title = getReelTitle(reel);
  const specs = formatReelSpecs(reel);

  if (isRent) {
    return cleanTextValue(`${rentMonthlyLine(reel)}

RENT IT! - DRIVE IT! - OWN IT!

Over x36 months / initial rental charges apply.

${title}

${specs}

Get on the road fast - no hassle.

* No credit check
* Apply in 60 seconds
* Drive away fast
* Own your van from £99

Join 5,000+ drivers already driving today.

Apply now and get approved today.
JUST £99 FINAL PAYMENT.
IT'S YOURS!

${rentVehicleUrl(reel)}`);
  }

  return cleanTextValue(`${cleanTextValue(reel?.priceLine) || "FROM £99 DEPOSIT | Finance monthly options available"}

VAN FINANCE COMPANY | £99 DEPOSIT OPTIONS

${title}

${specs}

Van finance from just £99 deposit.
Get your next van without tying up your cash.

* Finance the VAT
* £99 deposit options
* 200+ vans in stock
* Free UK delivery

All credit profiles considered - been declined elsewhere? We can help.
Built for businesses, sole traders and individuals who want to keep cash flow strong.

Apply now - takes 60 seconds.

FAST, SIMPLE APPLICATION, APPROVED IN JUST 60 MINUTES – APPLY TODAY

${financeVehicleUrl(reel)}`);
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

function triggerDescriptionDownload(reel, mp4Filename) {
  const text = buildReelDescriptionText(reel);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, safeTextDownloadName(mp4Filename));
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
  triggerDescriptionDownload(reel, filename);

  return {
    filename,
    descriptionFilename: safeTextDownloadName(filename),
    size: mp4Blob.size,
  };
}
