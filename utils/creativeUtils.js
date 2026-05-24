import rent2buyLogo from "../assets/rent2buy-vans.png";
import financeLogo from "../assets/van-finance-company.png";
import defaultReelAudio from "../assets/default-reel-audio.mp3";

export function createCreativePreview(creative) {
  return {
    headline: `${creative.hookStyle} - ${creative.vehicle.name}`,
    subline: `${creative.templateType} | ${creative.cta}`,
  };
}

export function createCreativeCaption(creative) {
  return `${creative.hookStyle} | ${creative.vehicle.name} | ${creative.vehicle.price} | ${creative.vehicle.monthly}

${creative.cta}

Pipeline: ${creative.vehicle.pipeline}`;
}

export function pipelineLabel(pipeline) {
  return pipeline === "rent2buy" ? "Rent2Buy" : "Finance";
}

export function pipelineDomain(pipeline) {
  return pipeline === "rent2buy"
    ? "www.rent2buyvans.co.uk"
    : "www.vanfinancecompany.co.uk";
}

export function pipelineDestination(pipeline) {
  return pipeline === "rent2buy" ? "Rent2Buy Facebook" : "Van Finance Facebook";
}

function reelBrandAsset(pipeline) {
  return pipeline === "rent2buy" ? rent2buyLogo : financeLogo;
}

function oldFormatPoundDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.startsWith("£") ? text : `£${text}`;
}

function buildFinancePostingDeskPriceLine(vehicle) {
  const priceText = String(vehicle.price || "").replace(/[^\d.,]/g, "").replace(/,/g, "");
  const formattedPrice = priceText ? Number(priceText).toLocaleString("en-GB") : vehicle.price || "";
  const priceWithVat = formattedPrice ? `${formatPoundDisplay(formattedPrice)} ${vehicle.vat || "+ VAT"}` : "";
  const monthlyPart = String(vehicle.salePrice || vehicle.monthly || "").trim();
  return [priceWithVat, monthlyPart].filter(Boolean).join(" | ");
}

function buildRentPostingDeskPriceLine(vehicle) {
  const monthlyPart = String(vehicle.monthly || "").trim();
  const initialPart = String(vehicle.initialRental || vehicle.price || "").trim();
  return [monthlyPart, initialPart].filter(Boolean).join(" | ");
}

function buildPostingDeskDetailsBlock(vehicle) {
  const lines = [];
  if (vehicle.vanDescription || vehicle.description) lines.push(vehicle.vanDescription || vehicle.description);
  if (vehicle.reg) lines.push(`REGISTRATION: ${vehicle.reg}`);
  if (vehicle.vanSpec || vehicle.spec) lines.push(vehicle.vanSpec || vehicle.spec);
  return lines.filter(Boolean).join("\n");
}

function buildMarketplaceTitle(vehicle) {
  const base = vehicle.vanDescription || vehicle.description || vehicle.title || vehicle.name || "Rent2Buy Van";
  return `${base} - ${vehicle.reg || vehicle.title || vehicle.name || ""}`.trim();
}

function legacyBuildPostingCaption(vehicle, { destination = pipelineDestination(vehicle.pipeline), index = 0 } = {}) {
  if (destination === "Facebook Marketplace") {
    const title = buildMarketplaceTitle(vehicle);
    return `NO CREDIT CHECK - ${vehicle.monthly || ""}

RENT IT! - DRIVE IT! - OWN IT!

Over ${vehicle.week || ""} months / initial rental charges apply.

${vehicle.vanDescription || vehicle.description || ""}

${vehicle.vanSpec || vehicle.spec || ""}

Get on the road fast - no hassle.

- No credit check
- Apply in 60 seconds
- Drive away fast
- Own your van from £99

Join 5,000+ drivers already driving today.

Apply now and get approved today.

For more details please visit -

${title}`;
  }

  if (destination === "Rent2Buy Facebook" || vehicle.pipeline === "rent2buy") {
    const rentHooks = ["No credit checks required", "Rent2Buy this van", "Own the van at the end"];
    const primaryHook = rentHooks[index % rentHooks.length];
    const supportHooks = ["Not dead money", "Work towards ownership", "Get back to work fast"];
    const secondaryHook = supportHooks[index % supportHooks.length];
    const priceLine = buildRentPostingDeskPriceLine(vehicle);
    const termLine = vehicle.week
      ? `Over ${vehicle.week} months / initial rental charges apply.`
      : "Initial rental charges apply.";

    return `RENT2BUY | ${primaryHook.toUpperCase()}

${priceLine || "Rent2Buy available"}

${termLine}

${buildPostingDeskDetailsBlock(vehicle)}

---

* ${primaryHook}
* ${secondaryHook}
* ${String(vehicle.initialRental || vehicle.price || "Initial rental applies").trim()}
* ${String(vehicle.monthly || "Monthly payment available").trim()}

Apply today to Rent2Buy this van.

${vehicle.link || "https://www.rent2buyvans.co.uk"}`;
  }

  const financeHooks = ["£99 deposit options", "Bad credit considered", "Self-employed welcome", "Finance the VAT"];
  const primaryHook = financeHooks[index % financeHooks.length].toUpperCase();
  const price = formatMoneyNumber(vehicle.price || "");
  const monthly = formatMonthlyMth(vehicle.salePrice || vehicle.monthly || "monthly options");

  return `FINANCE SPECIALIST | ${primaryHook.toUpperCase()}

${buildFinancePostingDeskPriceLine(vehicle) || "Finance available"}

${buildPostingDeskDetailsBlock(vehicle)}

---

* ${primaryHook}
* ${secondaryHook}
* Finance the VAT
* ${String(vehicle.salePrice || vehicle.monthly || "Finance tailored to you").trim()}

Use the dedicated finance application page to apply today.

${vehicle.link || "https://www.vanfinancecompany.co.uk"}`;
}

function formatPoundDisplay(value) {
  const text = String(value || "").trim().replace(/^Â£/, "£");
  if (!text) return "";
  return text.startsWith("£") ? text : `£${text}`;
}

function cleanCaptionValue(value) {
  return String(value || "")
    .replace(/Â£/g, "£")
    .replace(/Â£/g, "£")
    .replace(/â€“/g, "–")
    .replace(/MILLAGE/gi, "MILEAGE")
    .replace(/\bMTH\s+P\/M\b/gi, "MTH")
    .replace(/\bP\/M\s+MTH\b/gi, "MTH")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function normalizeRegistration(value) {
  const text = cleanCaptionValue(value).toUpperCase();
  if (!text) return "";

  const match = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return (match ? match[1] : text).replace(/\s+/g, "");
}

function vehicleRegistration(vehicle) {
  return normalizeRegistration(
    vehicle?.reg ||
    vehicle?.registration ||
    vehicle?.title ||
    vehicle?.name ||
    vehicle?.vanDescription ||
    vehicle?.description ||
    ""
  );
}

function vehicleTitle(vehicle) {
  return cleanCaptionValue(vehicle?.vanDescription || vehicle?.description || vehicle?.title || vehicle?.name || "Van");
}

function vehicleSpec(vehicle) {
  return cleanCaptionValue(vehicle?.vanSpec || vehicle?.spec || "");
}

function extractSpecValue(vehicle, label) {
  const haystack = [
    vehicle?.year,
    vehicle?.euro,
    vehicle?.mileage,
    vehicle?.vanSpec,
    vehicle?.spec,
    vehicle?.vanDescription,
    vehicle?.description,
    vehicle?.title,
    vehicle?.name,
  ].filter(Boolean).join("\n");
  const text = cleanCaptionValue(haystack);

  if (label === "YEAR") {
    return String(vehicle?.year || text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "").trim();
  }

  if (label === "MILEAGE") {
    const explicit = text.match(/\bMILEAGE\s*:?\s*([0-9][0-9,.\s]*)/i)?.[1];
    const miles = text.match(/\b([0-9][0-9,.\s]*)\s*(?:MILES|MILEAGE)\b/i)?.[1];
    return cleanCaptionValue(vehicle?.mileage || explicit || miles || "");
  }

  if (label === "EURO") {
    return cleanCaptionValue(vehicle?.euro || text.match(/\bEURO\s*:?\s*([0-9A-Z]+)/i)?.[1] || "");
  }

  return "";
}

function splitVehicleName(vehicle) {
  const reg = vehicleRegistration(vehicle);
  const raw = vehicleTitle(vehicle)
    .replace(new RegExp(reg, "i"), "")
    .replace(/\bREGISTRATION\s*:?\s*[A-Z0-9 ]+/gi, "")
    .replace(/\bYEAR\s*:?\s*\d{4}/gi, "")
    .replace(/\bMILEAGE\s*:?\s*[0-9,.\s]+/gi, "")
    .replace(/\bEURO\s*:?\s*[0-9A-Z]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = raw.split(/\s+-\s+|\s{2,}/).map((part) => part.trim()).filter(Boolean);

  return {
    model: parts[0] || raw || vehicle?.name || "Van",
    variant: parts.slice(1).join(" ") || cleanCaptionValue(vehicle?.variant || ""),
  };
}

function formatMoneyNumber(value) {
  const match = cleanCaptionValue(value).replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return "";
  return Number(match[0]).toLocaleString("en-GB");
}

function formatMonthlyMth(value) {
  const amount = formatMoneyNumber(value);
  return amount ? `£${amount} MTH` : cleanCaptionValue(value).replace(/\b(P\/M|PM|PER MONTH|MTH)\b/gi, "").trim();
}

function formatTermLine(vehicle) {
  const term = cleanCaptionValue(vehicle?.week || vehicle?.term || "").match(/\d+/)?.[0] || "36";
  return `Over x${term} months / initial rental charges apply.`;
}

function vehicleNameBlock(vehicle) {
  const { model, variant } = splitVehicleName(vehicle);
  return [model, variant].filter(Boolean).join("\n");
}

function vehicleSpecsBlock(vehicle) {
  const lines = [];
  const reg = vehicleRegistration(vehicle);
  const year = extractSpecValue(vehicle, "YEAR");
  const mileage = extractSpecValue(vehicle, "MILEAGE");
  const euro = extractSpecValue(vehicle, "EURO");

  if (reg) lines.push(`REGISTRATION: ${reg}`);
  if (year) lines.push(`YEAR: ${year}`);
  if (mileage) lines.push(`MILEAGE: ${mileage}`);
  if (euro) lines.push(`EURO: ${euro}`);

  return lines.join("\n");
}

function financeVehicleUrl(vehicle) {
  return `https://www.vanfinancecompany.co.uk/van-finance/${vehicleRegistration(vehicle)}`;
}

function rentVehicleUrl(vehicle) {
  return `https://www.rent2buyvans.co.uk/van-pages/${vehicleRegistration(vehicle)}`;
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = line
      .replace(/^[-*]\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sanitizePostingCaption(caption) {
  const cleanLines = cleanCaptionValue(caption)
    .split("\n")
    .map((line) => line
      .replace(/\bMTH\s+P\/M\b/gi, "MTH")
      .replace(/\bP\/M\s+MTH\b/gi, "MTH")
      .replace(/\b([0-9][0-9,.]*)\s*(?:P\/M|PM|PER MONTH)\b/gi, "£$1 MTH")
      .trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "---") return false;
      if (/^[_=\-]{4,}$/.test(trimmed)) return false;
      return true;
    });

  let hasRegistration = false;
  const normalizedLines = cleanLines.map((line) => {
    if (!/^REGISTRATION\s*:/i.test(line.trim())) return line;
    const registration = normalizeRegistration(line.replace(/^REGISTRATION\s*:/i, ""));
    return registration ? `REGISTRATION: ${registration}` : line;
  }).filter((line) => {
    if (!/^REGISTRATION\s*:/i.test(line.trim())) return true;
    if (hasRegistration) return false;
    hasRegistration = true;
    return true;
  });

  return dedupeLines(normalizedLines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildCleanFinancePostingDeskPriceLine(vehicle) {
  const priceText = String(vehicle.price || "").replace(/[^\d.,]/g, "").replace(/,/g, "");
  const formattedPrice = priceText ? Number(priceText).toLocaleString("en-GB") : cleanCaptionValue(vehicle.price || "");
  const priceWithVat = formattedPrice ? `${formatPoundDisplay(formattedPrice)} ${vehicle.vat || "+ VAT"}` : "";
  const monthlyPart = cleanCaptionValue(vehicle.salePrice || vehicle.monthly || "");
  return [priceWithVat, monthlyPart].filter(Boolean).join(" | ");
}

function buildCleanRentPostingDeskPriceLine(vehicle) {
  const monthlyPart = cleanCaptionValue(vehicle.monthly || "");
  const initialPart = cleanCaptionValue(vehicle.initialRental || vehicle.price || "");
  return [monthlyPart, initialPart].filter(Boolean).join(" | ");
}

function buildCleanPostingDeskDetailsBlock(vehicle) {
  const lines = [];
  const title = vehicleTitle(vehicle);
  const reg = vehicleRegistration(vehicle);
  const spec = vehicleSpec(vehicle);

  if (title) lines.push(title);
  if (reg) lines.push(`REGISTRATION: ${reg}`);
  if (spec) lines.push(spec);

  return dedupeLines(lines).filter(Boolean).join("\n");
}

export function buildPostingCaption(vehicle, { destination = pipelineDestination(vehicle.pipeline), index = 0 } = {}) {
  if (destination === "Facebook Marketplace") {
    return sanitizePostingCaption(`NO CREDIT CHECK - ${formatMonthlyMth(vehicle.monthly || "available")}

RENT IT! - DRIVE IT! - OWN IT!

${formatTermLine(vehicle)}

${vehicleNameBlock(vehicle)}

${vehicleSpecsBlock(vehicle)}

Get on the road fast - no hassle.

- No credit check
- Apply in 60 seconds
- Drive away fast
- Own your van from £99

Join 5,000+ drivers already driving today.

Apply now and get approved today.

${rentVehicleUrl(vehicle)}`);
  }

  if (destination === "Rent2Buy Facebook" || vehicle.pipeline === "rent2buy") {
    return sanitizePostingCaption(`NO CREDIT CHECK | ${formatMonthlyMth(vehicle.monthly || "available")}

RENT IT! - DRIVE IT! - OWN IT!

${formatTermLine(vehicle)}

${vehicleNameBlock(vehicle)}

${vehicleSpecsBlock(vehicle)}

Get on the road fast - no hassle.

* No credit check
* Apply in 60 seconds
* Drive away fast
* Own your van from Â£99

Join 5,000+ drivers already driving today.

Apply now and get approved today.
JUST Â£99 FINAL PAYMENT.
IT'S YOURS!

${rentVehicleUrl(vehicle)}`);
  }

  const financeHooks = ["£99 deposit options", "Bad credit considered", "Self-employed welcome", "Finance the VAT"];
  const primaryHook = financeHooks[index % financeHooks.length].toUpperCase().replace(/Â£/g, "£");
  const secondaryHook = financeHooks[(index + 3) % financeHooks.length];
  const price = formatMoneyNumber(vehicle.price || "");
  const monthly = formatMonthlyMth(vehicle.salePrice || vehicle.monthly || "monthly options");

  return sanitizePostingCaption(`FROM Â£99 DEPOSIT - Â£${price || "PRICE"} + VAT | FROM ${monthly}

VAN FINANCE COMPANY | ${primaryHook}

${vehicleNameBlock(vehicle)}

${vehicleSpecsBlock(vehicle)}

Van finance from just Â£99 deposit.
Get your next van without tying up your cash.

* Finance the VAT
* Â£99 deposit options
* 200+ vans in stock
* Free UK delivery

All credit profiles considered - been declined elsewhere? We can help.
Built for businesses, sole traders and individuals who want to keep cash flow strong.

Apply now - takes 60 seconds.

FAST, SIMPLE APPLICATION, APPROVED IN JUST 60 MINUTES – APPLY TODAY

${financeVehicleUrl(vehicle)}`);
}

export function safeFilename(value) {
  return String(value || "reel")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function cleanPublicReelLabel(value, pipeline) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/\b(deal hook|access hook|finance\s*-\s*deal hook|rent2buy\s*-\s*deal hook|finance\s*-\s*access hook|rent2buy\s*-\s*access hook)\b/i.test(text)) {
    return pipeline === "rent2buy" ? "Rent2Buy" : "Van Finance";
  }

  return text;
}

export function buildReelFilename(reel) {
  const pipeline = reel.pipeline === "rent2buy" ? "rent2buy" : "finance";
  const identifier = safeFilename(reel.registration || reel.title || reel.sourceLabel);
  const hook = safeFilename(reel.hook || reel.templateName);
  return `${pipeline}-${identifier || "stock"}-${hook || "daily-reel"}`;
}

export function buildFinanceReelContent(vehicle) {
  return {
    templateName: "Finance - Deal Hook",
    sourceLabel: "Finance stock",
    subtext: "Low deposit options | Bad credit considered | Self-employed welcome",
    priceLine: `${vehicle?.price || "Price available"} | ${vehicle?.monthly || "monthly options"}`,
    ctaLine: "APPLY NOW",
  };
}

export function buildRentReelContent(vehicle) {
  return {
    templateName: "Rent2Buy - Access Hook",
    sourceLabel: "Rent2Buy stock",
    subtext: "Rent2Buy this van | No credit checks | Own the van at the end",
    priceLine: `${vehicle?.monthly || "Monthly options"} | ${vehicle?.price || "available"}`,
    ctaLine: "APPLY TODAY",
  };
}

export function createReelRecord({
  vehicle,
  image,
  sourceLabel,
  pipeline,
  hook,
  templateName,
  musicOn,
  sourceType,
  subtext,
  priceLine,
  ctaLine,
}) {
  const resolvedPipeline = pipeline || vehicle?.pipeline || "vanFinance";
  const publicHook = cleanPublicReelLabel(hook, resolvedPipeline);
  const publicTemplateName = cleanPublicReelLabel(templateName, resolvedPipeline);
  const publicSourceLabel = cleanPublicReelLabel(sourceLabel, resolvedPipeline);
  const publicSubtext = cleanPublicReelLabel(subtext, resolvedPipeline);
  const title = vehicle ? vehicleTitle(vehicle) : publicSourceLabel || sourceLabel || "Uploaded image";
  const registration = vehicle ? vehicleRegistration(vehicle) : "";
  const domain = pipelineDomain(resolvedPipeline);
  const fileName = buildReelFilename({
    pipeline: resolvedPipeline,
    registration,
    title,
    sourceLabel: publicSourceLabel || sourceLabel,
    hook: publicHook || hook,
    templateName: publicTemplateName || templateName,
  });

  return {
    id: `reel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    vehicleId: vehicle?.id || "",
    pipeline: resolvedPipeline,
    headline: publicHook || hook,
    subtext: publicSubtext || subtext,
    image: image || vehicle?.image || "",
    title,
    registration,
    description: vehicle?.description || vehicle?.spec || "",
    hook: publicHook || hook,
    templateName: publicTemplateName || templateName,
    priceLine,
    ctaLine,
    sourceLabel: publicSourceLabel || sourceLabel || (vehicle ? "Live stock" : "Uploaded image"),
    sourceType: sourceType || "stock",
    domain,
    musicOn,
    fileName,
    createdAt: new Date().toISOString(),
  };
}

export function createCreativeFromReel(reel) {
  const vehicle = {
    id: reel.vehicleId || reel.id,
    name: reel.title || "Generated reel",
    reg: reel.registration || "",
    image: reel.image || "",
    price: reel.priceLine || "",
    monthly: "",
    pipeline: reel.pipeline,
    description: reel.description || reel.subtext || "",
    spec: reel.subtext || "",
    link: reel.domain || "",
  };

  return {
    id: `creative-${reel.id}`,
    vehicle,
    templateType: reel.templateName || "Daily Reel",
    hookStyle: reel.headline || reel.hook || "",
    cta: reel.ctaLine || "",
    versionNumber: 1,
    preview: {
      headline: reel.headline || reel.hook || "",
      subline: `${reel.priceLine || ""} | ${reel.domain || ""}`,
    },
   
caption: `${reel.headline || reel.hook || ""}
${reel.title || ""}
${reel.priceLine || ""}
${reel.subtext || ""}

${reel.ctaLine || ""}
${
  reel.pipeline === "rent2buy"
    ? reel.domain || ""
    : `https://marketing-crm-six.vercel.app/r/finance/${reel.id}?reg=${encodeURIComponent(reel.registration || "")}`
}`,
    mediaUrl: reel.url || "",
    downloadName: reel.downloadName || reel.fileName || "",
    mimeType: reel.mimeType || "",
    posterUrl: reel.posterUrl || "",
    audioEmbedded: Boolean(reel.audioEmbedded),
    createdAt: reel.createdAt || new Date().toISOString(),
    status: "reel_asset",
    postingChannel: pipelineDestination(reel.pipeline),
  };
}

export function createCreativeRecord(vehicle, formValues, versionIndex) {
  const createdAt = new Date().toISOString();
  const preview = createCreativePreview({
    vehicle,
    ...formValues,
  });

  return {
    id: `creative-${Date.now()}-${versionIndex}-${vehicle.id}`,
    vehicle,
    templateType: formValues.templateType,
    hookStyle: formValues.hookStyle,
    cta: formValues.cta,
    versionNumber: versionIndex + 1,
    preview,
    caption: createCreativeCaption({
      vehicle,
      ...formValues,
    }),
    createdAt,
    status: "reel_asset",
    postingChannel:
      vehicle.pipeline === "rent2buy"
        ? "Rent2Buy Facebook"
        : "Van Finance Facebook",
  };
}

export function normalizeCreativeRecord(record) {
  const vehicle = record.vehicle || {
    id: record.vehicle_id || "",
    name: record.vehicle_name || "",
    reg: record.registration || "",
    image: record.preview_payload?.image || "",
    price: record.preview_payload?.price || "",
    monthly: record.preview_payload?.monthly || "",
    pipeline: record.pipeline || "",
  };

  return {
    id: record.id,
    vehicle,
    templateType: record.template_type || "",
    hookStyle: record.hook_style || "",
    cta: record.cta || "",
    versionNumber: record.version_number || 1,
    preview: record.preview_payload?.preview || createCreativePreview({
      vehicle,
      templateType: record.template_type,
      hookStyle: record.hook_style,
      cta: record.cta,
    }),
    caption: record.preview_payload?.caption || createCreativeCaption({
      vehicle,
      templateType: record.template_type,
      hookStyle: record.hook_style,
      cta: record.cta,
    }),
    mediaUrl: record.preview_payload?.mediaUrl || record.preview_payload?.url || "",
    downloadName: record.preview_payload?.downloadName || record.preview_payload?.fileName || "",
    mimeType: record.preview_payload?.mimeType || "",
    posterUrl: record.preview_payload?.posterUrl || "",
    audioEmbedded: Boolean(record.preview_payload?.audioEmbedded),
    createdAt: record.created_at || new Date().toISOString(),
    status: record.status === "draft" ? "reel_asset" : record.status || "reel_asset",
    postingChannel: record.destination_page || (
      record.pipeline === "rent2buy" ? "Rent2Buy Facebook" : "Van Finance Facebook"
    ),
  };
}

export function toMarketingCreativePayload(creative) {
  return {
    vehicle_id: String(creative.vehicle?.id || ""),
    pipeline: creative.vehicle?.pipeline || "",
    vehicle_name: creative.vehicle?.name || "",
    registration: creative.vehicle?.reg || "",
    template_type: creative.templateType || "",
    hook_style: creative.hookStyle || "",
    cta: creative.cta || "",
    version_number: creative.versionNumber || 1,
    preview_payload: {
      preview: creative.preview,
      caption: creative.caption,
      image: creative.vehicle?.image || "",
      price: creative.vehicle?.price || "",
      monthly: creative.vehicle?.monthly || "",
      mediaUrl: creative.mediaUrl || "",
      downloadName: creative.downloadName || "",
      mimeType: creative.mimeType || "",
      posterUrl: creative.posterUrl || "",
      audioEmbedded: Boolean(creative.audioEmbedded),
    },
    status: creative.status || "draft",
    destination_page: creative.postingChannel || "",
  };
}

export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function getSupportedReelMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const options = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];

  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

async function createReelAudioStream(durationMs, musicUrl) {
  if (typeof window === "undefined" || !window.AudioContext || !musicUrl) {
    return { stream: null, cleanup: () => {} };
  }

  const audioContext = new window.AudioContext();

  try {
    const response = await fetch(musicUrl);
    if (!response.ok) {
      throw new Error("Could not load reel audio.");
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const destination = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = audioBuffer;
    source.loop = audioBuffer.duration * 1000 < durationMs;
    gainNode.gain.value = 0.22;

    source.connect(gainNode);
    gainNode.connect(destination);

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

function triggerMediaDownload(url, downloadName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openReelAssetDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Saved reel downloads are not supported in this browser."));
      return;
    }

    const request = indexedDB.open("marketing-crm-reel-assets", 1);
    request.onerror = () => reject(request.error || new Error("Could not open saved reel storage."));
    request.onupgradeneeded = () => {
      request.result.createObjectStore("reels", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveReelVideoBlob(id, blob, metadata = {}) {
  if (!id || !blob) return;

  const db = await openReelAssetDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("reels", "readwrite");
    tx.objectStore("reels").put({
      id,
      blob,
      downloadName: metadata.downloadName || `${id}.webm`,
      mimeType: metadata.mimeType || blob.type || "video/webm",
      savedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not save reel video."));
  });
  db.close();
}

export async function loadReelVideoBlob(id) {
  if (!id) return null;

  const db = await openReelAssetDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction("reels", "readonly");
    const request = tx.objectStore("reels").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not load saved reel video."));
  });
  db.close();
  return result;
}

async function loadCanvasImage(imageUrl, missingMessage = "No image available.") {
  if (!imageUrl) {
    throw new Error(missingMessage);
  }

  let response;

  try {
    response = await fetch(imageUrl);
  } catch (error) {
    throw new Error(`Could not load image asset: ${imageUrl}`);
  }

  if (!response.ok) {
    throw new Error(`Could not load image asset: ${imageUrl}`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not decode vehicle image: ${imageUrl}`));
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

function drawVideoBackground(ctx, width, height, pipeline) {
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0f172a");
  background.addColorStop(0.52, pipeline === "rent2buy" ? "#0f2f22" : "#10245f");
  background.addColorStop(1, "#020617");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
}

function drawVideoProgressBar(ctx, width, height, elapsedSeconds, totalDurationSeconds) {
  const progress = Math.max(0, Math.min(elapsedSeconds / totalDurationSeconds, 1));
  const barX = 36;
  const barY = height - 28;
  const barWidth = width - 72;
  const barHeight = 8;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, 999);
  ctx.fill();

  ctx.fillStyle = "#60a5fa";
  ctx.beginPath();
  ctx.roundRect(barX, barY, Math.max(barWidth * progress, barHeight), barHeight, 999);
  ctx.fill();
  ctx.restore();
}

function drawVideoBrandLogo(ctx, width, height, logoImage, options = {}) {
  if (!logoImage) return;

  const {
    x = width / 2,
    y = height - 230,
    maxWidth = 430,
    maxHeight = 185,
    align = "center",
  } = options;
  const ratio = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
  const logoWidth = logoImage.width * ratio;
  const logoHeight = logoImage.height * ratio;
  const logoX = align === "right" ? x - logoWidth : x - logoWidth / 2;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "rgba(2,6,23,0.42)";
  ctx.shadowBlur = 18;
  ctx.drawImage(logoImage, logoX, y, logoWidth, logoHeight);
  ctx.restore();

  return logoHeight;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth || !currentLine) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines;
}

function getFittedCanvasText(ctx, text, { maxWidth, maxHeight, maxLines = 4, startSize = 92, minSize = 34, weight = 900 }) {
  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px Arial, sans-serif`;
    const lines = wrapCanvasText(ctx, text, maxWidth);
    const lineHeight = Math.round(size * 1.16);
    if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) {
      return { lines, size, lineHeight };
    }
  }

  ctx.font = `${weight} ${minSize}px Arial, sans-serif`;
  return {
    lines: wrapCanvasText(ctx, text, maxWidth).slice(0, maxLines),
    size: minSize,
    lineHeight: Math.round(minSize * 1.16),
  };
}

function drawCanvasTextBlock(ctx, text, options) {
  const {
    x,
    y,
    maxWidth,
    maxHeight,
    startSize = 92,
    minSize = 34,
    maxLines = 4,
    weight = 900,
    color = "#ffffff",
  } = options;
  const fitted = getFittedCanvasText(ctx, text, { maxWidth, maxHeight, maxLines, startSize, minSize, weight });

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(15,23,42,0.72)";
  ctx.shadowBlur = 18;
  ctx.font = `${weight} ${fitted.size}px Arial, sans-serif`;

  let cursorY = y;
  fitted.lines.forEach((line) => {
    ctx.fillText(line, x, cursorY);
    cursorY += fitted.lineHeight;
  });
  ctx.restore();

  return cursorY - y;
}

function drawContainedCanvasImage(ctx, image, x, y, width, height, progress = 0) {
  const imageRatio = image.width / image.height;
  const frameRatio = width / height;
  const containScale = 0.94 + Math.min(progress, 1) * 0.06;
  let drawWidth = width;
  let drawHeight = height;

  if (imageRatio > frameRatio) {
    drawHeight = drawWidth / imageRatio;
  } else {
    drawWidth = drawHeight * imageRatio;
  }

  drawWidth *= containScale;
  drawHeight *= containScale;

  const centerY = 1920 * 0.55;
  const drawX = x + (width - drawWidth) / 2;
  const preferredY = centerY - drawHeight / 2;
  const drawY = Math.min(Math.max(preferredY, y + 24), y + height - drawHeight - 24);

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawMarketingReelFrame(ctx, canvas, image, logoImage, reel, elapsedSeconds) {
  const { width, height } = canvas;
  const durationSeconds = 12;
  const safeTop = Math.round(height * 0.2);
  const safeBottom = Math.round(height * 0.8);
  const safeCenterY = (safeTop + safeBottom) / 2;
  const publicHeadline = cleanPublicReelLabel(reel.headline || reel.hook, reel.pipeline);
  const publicSubtext = cleanPublicReelLabel(reel.subtext || reel.hook, reel.pipeline);
  const publicTitle = cleanPublicReelLabel(reel.title, reel.pipeline);

  drawVideoBackground(ctx, width, height, reel.pipeline);

  if (elapsedSeconds < 3) {
    const popProgress = Math.min(elapsedSeconds / 0.45, 1);
    ctx.globalAlpha = popProgress;
    const hookY = safeCenterY - 185 - (1 - popProgress) * 18;
    let cursorY = hookY;
    const hookHeight = drawCanvasTextBlock(ctx, String(publicHeadline || "").toUpperCase(), {
      x: width / 2,
      y: cursorY,
      maxWidth: width - 140,
      maxHeight: 330,
      startSize: 104,
      minSize: 48,
      maxLines: 3,
      weight: 900,
    });
    cursorY += hookHeight + 22;
    cursorY += drawCanvasTextBlock(ctx, publicTitle || "", {
      x: width / 2,
      y: cursorY,
      maxWidth: width - 170,
      maxHeight: 120,
      startSize: 48,
      minSize: 28,
      maxLines: 2,
      weight: 800,
      color: "#e5e7eb",
    });
    cursorY += 28;
    drawCanvasTextBlock(ctx, reel.domain || "", {
      x: width / 2,
      y: cursorY,
      maxWidth: width - 220,
      maxHeight: 100,
      startSize: 42,
      minSize: 24,
      maxLines: 2,
      weight: 700,
      color: "#bfdbfe",
    });
    ctx.globalAlpha = 1;
    drawVideoBrandLogo(ctx, width, height, logoImage, { y: cursorY + 78, maxWidth: 480, maxHeight: 205 });
    drawVideoProgressBar(ctx, width, height, elapsedSeconds, durationSeconds);
    return;
  }

  if (elapsedSeconds < 8) {
    const textPanelGap = 28;
    const textPanelHeight = 320;
    const imageX = 60;
    const imageWidth = width - 120;
    const imageY = safeTop + 12;
    const imageHeight = safeBottom - textPanelHeight - textPanelGap - imageY;
    const textPanelY = imageY + imageHeight + textPanelGap;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(imageX, imageY, imageWidth, imageHeight, 44);
    ctx.clip();
    ctx.fillStyle = "#020617";
    ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
    drawContainedCanvasImage(ctx, image, imageX, imageY, imageWidth, imageHeight, (elapsedSeconds - 3) / 5);
    ctx.restore();

    ctx.fillStyle = "rgba(15,23,42,0.92)";
    ctx.beginPath();
    ctx.roundRect(60, textPanelY, width - 120, textPanelHeight, 36);
    ctx.fill();

    const textProgress = Math.min((elapsedSeconds - 3) / 0.45, 1);
    ctx.globalAlpha = textProgress;
    let cursorY = textPanelY + 44 + (1 - textProgress) * 22;
    if (reel.pipeline === "rent2buy") {
  cursorY += drawCanvasTextBlock(ctx, reel.priceLine || publicTitle || "", {
    x: width / 2,
    y: cursorY,
    maxWidth: width - 180,
    maxHeight: 180,
    startSize: 104,
    minSize: 48,
    maxLines: 2,
    weight: 900,
  });
} else {
  cursorY += drawCanvasTextBlock(ctx, reel.priceLine || publicTitle || "", {
    x: width / 2,
    y: cursorY,
    maxWidth: width - 140,
    maxHeight: 120,
    startSize: 82,
    minSize: 34,
    maxLines: 1,
    weight: 900,
  });
}
    cursorY += 26;
    drawCanvasTextBlock(ctx, publicTitle || "", {
      x: width / 2,
      y: cursorY,
      maxWidth: width - 180,
      maxHeight: 90,
      startSize: 42,
      minSize: 24,
      maxLines: 2,
      weight: 800,
      color: "#e5e7eb",
    });
    ctx.globalAlpha = 1;
    drawVideoBrandLogo(ctx, width, height, logoImage, { x: width - 54, y: height - 230, align: "right", maxWidth: 360, maxHeight: 145 });
    drawVideoProgressBar(ctx, width, height, elapsedSeconds, durationSeconds);
    return;
  }

  if (elapsedSeconds < 10) {
    const supportProgress = Math.min((elapsedSeconds - 8) / 0.45, 1);
    ctx.globalAlpha = supportProgress;
    drawCanvasTextBlock(ctx, publicSubtext || "", {
      x: width / 2,
      y: safeCenterY - 145 - (1 - supportProgress) * 18,
      maxWidth: width - 150,
      maxHeight: 360,
      startSize: 92,
      minSize: 44,
      maxLines: 4,
      weight: 900,
    });
    ctx.globalAlpha = 1;
    drawVideoBrandLogo(ctx, width, height, logoImage, { y: safeCenterY + 190, maxWidth: 430, maxHeight: 175 });
    drawVideoProgressBar(ctx, width, height, elapsedSeconds, durationSeconds);
    return;
  }

  const ctaProgress = Math.min((elapsedSeconds - 10) / 0.45, 1);
  ctx.globalAlpha = ctaProgress;
  let finalCursorY = safeCenterY - 190 - (1 - ctaProgress) * 18;
  finalCursorY += drawCanvasTextBlock(ctx, reel.ctaLine || "APPLY TODAY", {
    x: width / 2,
    y: finalCursorY,
    maxWidth: width - 150,
    maxHeight: 190,
    startSize: 104,
    minSize: 48,
    maxLines: 2,
    weight: 900,
  });
  finalCursorY += 26;
  drawCanvasTextBlock(ctx, reel.domain || "", {
    x: width / 2,
    y: finalCursorY,
    maxWidth: width - 220,
    maxHeight: 100,
    startSize: 42,
    minSize: 24,
    maxLines: 2,
    weight: 700,
    color: "#bfdbfe",
  });
  ctx.globalAlpha = 1;
  drawVideoBrandLogo(ctx, width, height, logoImage, { y: finalCursorY + 86, maxWidth: 500, maxHeight: 210 });
  drawVideoProgressBar(ctx, width, height, elapsedSeconds, durationSeconds);
}

export async function generateReelVideoAsset(reel) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Video generation is only available in the browser.");
  }

  if (typeof HTMLCanvasElement === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support reel generation.");
  }

  const { image, cleanup } = await loadCanvasImage(reel.image, "No reel image available.");
  let logoAsset;

  try {
    logoAsset = await loadCanvasImage(reelBrandAsset(reel.pipeline), "No reel branding logo available.");
  } catch (error) {
    cleanup();
    throw error;
  }

  const mimeType = getSupportedReelMimeType();
  if (!mimeType) {
    cleanup();
    logoAsset.cleanup();
    throw new Error("This browser cannot record canvas video.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cleanup();
    logoAsset.cleanup();
    throw new Error("Could not create reel canvas.");
  }

  let posterUrl = reel.image || "";
  try {
    drawMarketingReelFrame(ctx, canvas, image, logoAsset.image, reel, 4.2);
    posterUrl = canvas.toDataURL("image/jpeg", 0.88);
  } catch {
    posterUrl = reel.image || "";
  }

  const durationMs = 12000;
  const canvasStream = canvas.captureStream(30);
  let audioCleanup = () => {};
  let mixedStream = canvasStream;

  if (reel.musicOn) {
    try {
      const audioResult = await createReelAudioStream(durationMs, defaultReelAudio);
      audioCleanup = audioResult.cleanup;
      if (audioResult.stream) {
        mixedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioResult.stream.getAudioTracks(),
        ]);
      }
    } catch (error) {
      console.warn("Reel music disabled for this export:", error);
    }
  }

  const chunks = [];
  const recorder = new MediaRecorder(mixedStream, mimeType ? { mimeType } : undefined);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const started = Date.now();
  let animationFrame = 0;

  const finishedBlob = new Promise((resolve, reject) => {
    recorder.onerror = (event) => {
      reject(event?.error || new Error("Reel recording failed."));
    };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
    };
  });

  const renderLoop = () => {
    const elapsed = Date.now() - started;
    drawMarketingReelFrame(ctx, canvas, image, logoAsset.image, reel, elapsed / 1000);
    if (elapsed < durationMs) {
      animationFrame = window.requestAnimationFrame(renderLoop);
    } else if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start();
  renderLoop();

  try {
    const blob = await finishedBlob;
    const url = window.URL.createObjectURL(blob);
    const fileLabel = buildReelFilename(reel);
    cleanup();
    logoAsset.cleanup();
    audioCleanup();

    return {
      blob,
      extension: "webm",
      url,
      downloadName: `${fileLabel}.webm`,
      posterUrl,
      mimeType: blob.type,
      audioEmbedded: mixedStream.getAudioTracks().length > 0,
    };
  } catch (error) {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
    }
    cleanup();
    logoAsset.cleanup();
    audioCleanup();
    throw error;
  }
}

export function downloadReelVideo(reel) {
  if (!reel.url || !reel.downloadName) {
    throw new Error("This reel does not have a generated video file yet.");
  }

  triggerMediaDownload(reel.url, reel.downloadName);
}

export async function downloadCreativeReelVideo(creative) {
  const savedAsset = await loadReelVideoBlob(creative.id).catch(() => null);

  if (savedAsset?.blob) {
    const url = window.URL.createObjectURL(savedAsset.blob);
    triggerMediaDownload(url, savedAsset.downloadName || creative.downloadName || `${creative.id}.webm`);
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    return;
  }

  if (creative.mediaUrl || creative.url) {
    triggerMediaDownload(
      creative.mediaUrl || creative.url,
      creative.downloadName || creative.fileName || `${creative.id}.webm`
    );
    return;
  }

  throw new Error("This saved reel does not have downloadable video media in this browser.");
}

export function normalizeReelPreviewFilename(filename) {
  const safeName = String(filename || "daily-reel.png").replace(/\.(webm|mp4|txt)$/i, ".png");
  return safeName.toLowerCase().endsWith(".png") ? safeName : `${safeName}.png`;
}

function loadDrawableImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });

  if (currentLine) lines.push(currentLine);

  lines.slice(0, maxLines).forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });

  return Math.min(lines.length, maxLines) * lineHeight;
}

function drawContainImage(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function buildReelPreviewBlob(reel, includeImage = true) {
  const width = 1080;
  const height = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#07111f");
  gradient.addColorStop(0.45, reel.pipeline === "rent2buy" ? "#123524" : "#10245f");
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (includeImage) {
    const image = await loadDrawableImage(reel.image);
    if (image) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      drawContainImage(ctx, image, 110, 345, 860, 580);
      ctx.restore();
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(2, 6, 23, 0.42)";
  ctx.shadowBlur = 26;
  ctx.font = "900 92px Arial";
  drawWrappedText(
    ctx,
    cleanPublicReelLabel(reel.headline || reel.hook, reel.pipeline) || "DAILY REEL",
    width / 2,
    1060,
    850,
    96,
    3
  );

  ctx.font = "800 46px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  drawWrappedText(
    ctx,
    reel.priceLine || cleanPublicReelLabel(reel.title, reel.pipeline) || "",
    width / 2,
    1345,
    820,
    56,
    2
  );

  ctx.font = "800 42px Arial";
  ctx.fillStyle = "#ffffff";
  drawWrappedText(ctx, reel.ctaLine || "APPLY TODAY", width / 2, 1515, 780, 52, 2);

  ctx.font = "700 34px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  drawWrappedText(ctx, reel.domain || "", width / 2, 1625, 780, 44, 1);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create reel preview image."));
        }
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

export async function downloadReelPreviewImage(reel) {
  const filename = normalizeReelPreviewFilename(reel.fileName || buildReelFilename(reel));
  let blob;

  try {
    blob = await buildReelPreviewBlob(reel, true);
  } catch (error) {
    blob = await buildReelPreviewBlob(reel, false);
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
}

export function formatDateShort(value) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function parseMoney(value) {
  const numeric = String(value || "").replace(/[^\d.]/g, "");
  return numeric ? Number(numeric) : null;
}

export function vehicleDisplayLabel(vehicle) {
  return vehicle?.reg || vehicle?.title || vehicle?.name || "Unnamed vehicle";
}

export function filterVehicles(vehicles, filters) {
  const query = String(filters.search || "").trim().toLowerCase();
  const minPrice = parseMoney(filters.minPrice);
  const maxPrice = parseMoney(filters.maxPrice);

  return vehicles.filter((vehicle) => {
    if (filters.pipeline === "rent2buy" && vehicle.pipeline !== "rent2buy") {
      return false;
    }

    if (query) {
      const haystack = [
        vehicle.reg,
        vehicle.title,
        vehicle.name,
        vehicle.vanDescription,
        vehicle.description,
        vehicle.vanSpec,
        vehicle.spec,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    const price = parseMoney(vehicle.price);
    if (minPrice !== null && price !== null && price < minPrice) return false;
    if (maxPrice !== null && price !== null && price > maxPrice) return false;

    return true;
  });
}

export function filterCreatives(creatives, filters) {
  const query = String(filters.search || "").trim().toLowerCase();
  const minPrice = parseMoney(filters.minPrice);
  const maxPrice = parseMoney(filters.maxPrice);

  return creatives.filter((creative) => {
    if (filters.pipeline !== "all" && creative.vehicle?.pipeline !== filters.pipeline) {
      return false;
    }
      if (
        filters.status === "reel_asset" &&
        !["reel_asset", "draft", "ready_to_post", "posted"].includes(creative.status)
      ) {
        return false;
      }

      if (
        filters.status !== "all" &&
        filters.status !== "reel_asset" &&
        creative.status !== filters.status
      ) {
        return false;
      }
    if (filters.destination !== "all" && creative.postingChannel !== filters.destination) {
      return false;
    }

    if (query) {
      const haystack = [
        creative.vehicle?.reg,
        creative.vehicle?.name,
        creative.vehicle?.description,
        creative.vehicle?.spec,
        creative.templateType,
        creative.hookStyle,
        creative.cta,
        creative.caption,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    const price = parseMoney(creative.vehicle?.price);
    if (minPrice !== null && price !== null && price < minPrice) return false;
    if (maxPrice !== null && price !== null && price > maxPrice) return false;

    return true;
  });
}
