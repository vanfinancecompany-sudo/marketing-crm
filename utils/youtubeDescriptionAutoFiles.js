const DESCRIPTION_PATCH_FLAG = "__vfcYoutubeDescriptionAutoFiles";

function cleanText(value) {
  return String(value || "")
    .replace(/Â£/g, "£")
    .replace(/â€“/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function safeFilePart(value) {
  return cleanText(value)
    .replace(/\.(mp4|webm|txt)$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "youtube-reel";
}

function triggerTextDownload(text, filename) {
  if (!text || typeof document === "undefined") return;

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isYoutubeGeneratorDownload(filename) {
  const value = cleanText(filename).toLowerCase();
  return /\.(mp4|webm)$/i.test(value)
    && (
      value.includes("reel-lab")
      || value.includes("youtube")
      || value.includes("rent2buy")
      || value.includes("finance")
    );
}

function registrationFromText(value) {
  const match = cleanText(value).toUpperCase().match(/\b[A-Z]{2}\s?\d{2}\s?[A-Z]{3}\b/);
  return match ? match[0].replace(/\s+/g, "") : "";
}

function productFromPage(filename) {
  const lowerFilename = cleanText(filename).toLowerCase();
  if (lowerFilename.includes("rent2buy")) return "rent2buy";
  if (lowerFilename.includes("finance")) return "finance";

  const bodyText = cleanText(document.body?.innerText || "").toLowerCase();
  const activeButton = Array.from(document.querySelectorAll("button, .is-active, [aria-selected='true']"))
    .map((node) => cleanText(node.innerText || node.textContent || ""))
    .find((text) => /rent2buy|van finance/i.test(text));

  if (/rent2buy/i.test(activeButton || "")) return "rent2buy";
  if (/van finance/i.test(activeButton || "")) return "finance";
  return bodyText.includes("rent2buy") && !bodyText.includes("van finance") ? "rent2buy" : "finance";
}

function selectedVehicleText(registration) {
  const options = Array.from(document.querySelectorAll("select option:checked"))
    .map((option) => cleanText(option.textContent || ""))
    .filter(Boolean);

  if (registration) {
    const match = options.find((text) => text.toUpperCase().replace(/\s+/g, "").includes(registration));
    if (match) return match;
  }

  return options.find((text) => registrationFromText(text)) || options[0] || "";
}

function pageTextSnippetAround(registration) {
  if (!registration) return "";
  const text = document.body?.innerText || "";
  const normalizedReg = registration.toUpperCase();
  const index = text.toUpperCase().replace(/\s+/g, " ").indexOf(normalizedReg);
  if (index < 0) return "";
  return cleanText(text.slice(Math.max(0, index - 200), index + 500));
}

function vehicleTitleFromPage(registration) {
  const selected = selectedVehicleText(registration);
  if (selected) {
    const withoutReg = cleanText(selected.replace(new RegExp(registration, "i"), "").replace(/^[-–|:\s]+/, ""));
    if (withoutReg && !/^(vehicle|select|images|duration|fps)$/i.test(withoutReg)) return withoutReg;
    return selected;
  }

  const snippet = pageTextSnippetAround(registration);
  if (snippet) {
    const sentence = snippet.split(/\n|\|/).map(cleanText).find((part) => part && !part.includes(registration));
    if (sentence) return sentence;
  }

  return registration ? `Vehicle ${registration}` : "Selected vehicle";
}

function findValueAfterLabel(label, registration) {
  const text = pageTextSnippetAround(registration) || document.body?.innerText || "";
  const pattern = new RegExp(`${label}\\s*:?\\s*([^\\n|]+)`, "i");
  const match = text.match(pattern);
  return cleanText(match?.[1] || "");
}

function vehicleUrl(product, registration) {
  if (product === "rent2buy") {
    return registration
      ? `https://www.rent2buyvans.co.uk/van-pages/${encodeURIComponent(registration)}`
      : "https://www.rent2buyvans.co.uk/";
  }

  return registration
    ? `https://www.vanfinancecompany.co.uk/van-finance/${encodeURIComponent(registration)}`
    : "https://www.vanfinancecompany.co.uk/";
}

function specsBlock(registration) {
  const lines = [];
  if (registration) lines.push(`REGISTRATION: ${registration}`);

  const year = findValueAfterLabel("YEAR", registration);
  const mileage = findValueAfterLabel("MILEAGE", registration);
  const euro = findValueAfterLabel("EURO", registration);

  if (year) lines.push(`YEAR: ${year}`);
  if (mileage) lines.push(`MILEAGE: ${mileage}`);
  if (euro) lines.push(`EURO: ${euro}`);

  return lines.join("\n");
}

function priceLine(product, filename, registration) {
  const snippet = pageTextSnippetAround(registration);
  const text = snippet || document.body?.innerText || "";

  if (product === "rent2buy") {
    const monthly = cleanText(text.match(/£\s?[0-9,.]+\s*(?:MTH|PM|P\/M|PER MONTH)/i)?.[0] || "");
    return monthly ? `NO CREDIT CHECK | ${monthly.toUpperCase()}` : "NO CREDIT CHECK";
  }

  const financeLine = cleanText(text.match(/FROM\s*£\s?99\s*DEPOSIT[^\n]*/i)?.[0] || "");
  if (financeLine) return financeLine.toUpperCase();

  const monthly = cleanText(text.match(/£\s?[0-9,.]+\s*(?:MTH|PM|P\/M|PER MONTH)/i)?.[0] || "");
  return monthly ? `FROM £99 DEPOSIT | FROM ${monthly.toUpperCase()}` : "FROM £99 DEPOSIT | Finance monthly options available";
}

function buildDescription(product, filename) {
  const registration = registrationFromText(filename) || registrationFromText(document.body?.innerText || "");
  const title = vehicleTitleFromPage(registration);
  const specs = specsBlock(registration);
  const line = priceLine(product, filename, registration);
  const url = vehicleUrl(product, registration);

  if (product === "rent2buy") {
    return `${line}

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

${url}`.trim();
  }

  return `${line}

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

${url}`.trim();
}

function installYoutubeDescriptionAutoFiles() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window[DESCRIPTION_PATCH_FLAG]) return;
  window[DESCRIPTION_PATCH_FLAG] = true;

  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedClick(...args) {
    const filename = this?.download || "";
    const shouldCreateTextFile = isYoutubeGeneratorDownload(filename);

    const result = originalClick.apply(this, args);

    if (shouldCreateTextFile && !filename.endsWith("-description.txt")) {
      window.setTimeout(() => {
        const product = productFromPage(filename);
        const description = buildDescription(product, filename);
        const descriptionFilename = `${safeFilePart(filename)}-description.txt`;
        triggerTextDownload(description, descriptionFilename);
      }, 150);
    }

    return result;
  };
}

installYoutubeDescriptionAutoFiles();
