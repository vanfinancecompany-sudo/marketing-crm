const PRODUCT_HOSTS = {
  vanFinance: ["www.vanfinancecompany.co.uk", "vanfinancecompany.co.uk"],
  rent2buy: ["www.rent2buyvans.co.uk", "rent2buyvans.co.uk"],
};

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeRegistration(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeSearchText(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function normalizeImageUrl(value, baseUrl) {
  const text = String(value || "").trim();
  if (!text) return "";

  const wixMatch = text.match(/wix:image:\/\/v1\/([^/#?\s]+)/i);
  if (wixMatch) return `https://static.wixstatic.com/media/${wixMatch[1]}`;

  if (/^\/\//.test(text)) return `https:${text}`;

  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return "";
  }
}

function imageDedupeKey(value) {
  const text = String(value || "").trim();
  const staticMatch = text.match(/static\.wixstatic\.com\/media\/([^/?#]+)/i);
  if (staticMatch) return `wix:${staticMatch[1].toLowerCase()}`;

  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function normalizePgidImageUrl(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return "";
  }

  const pgid = url.searchParams.get("pgid") || url.searchParams.get("image") || url.searchParams.get("mediaId") || "";
  if (!pgid) return "";

  const decoded = decodeURIComponent(pgid);
  const direct = normalizeImageUrl(decoded, pageUrl);
  if (/static\.wixstatic\.com\/media\//i.test(direct)) return direct;

  if (/\.(jpe?g|png|webp)(\?|#|$)/i.test(decoded) || /^[a-z0-9_~-]+\.(jpe?g|png|webp)$/i.test(decoded)) {
    return `https://static.wixstatic.com/media/${decoded.replace(/^\/+/, "")}`;
  }

  return "";
}

function extractOrderedPageImages(html, pageUrl) {
  const ordered = [];
  const seen = new Set();
  const debug = {
    attributeImagesFound: 0,
    srcsetImagesFound: 0,
    wixImageRefsFound: 0,
    staticWixImagesFound: 0,
    mainImagesRefsFound: 0,
    galleryRefsFound: 0,
    candidateImagesFound: 0,
    pgidImageFound: false,
    dedupeHappened: false,
  };

  const addCandidate = (value, source) => {
    const normalized = normalizeImageUrl(value, pageUrl);
    if (!normalized) return;
    if (!/\.(jpe?g|png|webp)(\?|#|$)/i.test(normalized) && !/static\.wixstatic\.com\/media\//i.test(normalized)) return;
    if (/\/(logo|icon|favicon|placeholder|blank)[^/]*\.(jpe?g|png|webp)/i.test(normalized)) return;
    const key = imageDedupeKey(normalized);
    if (seen.has(key)) {
      debug.dedupeHappened = true;
      return;
    }
    seen.add(key);
    ordered.push({ url: normalized, source });
  };

  const pgidImage = normalizePgidImageUrl(pageUrl);
  if (pgidImage) {
    debug.pgidImageFound = true;
    addCandidate(pgidImage, "pgid");
  }

  for (const match of html.matchAll(/"mainImages?"\s*:\s*\[([\s\S]{0,5000}?)\]/gi)) {
    debug.mainImagesRefsFound += 1;
    for (const imageMatch of match[1].matchAll(/(?:wix:image:\/\/v1\/[^"',\\\s<>)]+|https?:\/\/static\.wixstatic\.com\/media\/[^"',\\\s<>)]+)/gi)) {
      if (/wix:image/i.test(imageMatch[0])) debug.wixImageRefsFound += 1;
      if (/static\.wixstatic/i.test(imageMatch[0])) debug.staticWixImagesFound += 1;
      addCandidate(imageMatch[0], "gallery/mainImages");
    }
  }

  for (const match of html.matchAll(/"(?:gallery|mediaItems|images)"\s*:\s*\[([\s\S]{0,8000}?)\]/gi)) {
    debug.galleryRefsFound += 1;
    for (const imageMatch of match[1].matchAll(/(?:wix:image:\/\/v1\/[^"',\\\s<>)]+|https?:\/\/static\.wixstatic\.com\/media\/[^"',\\\s<>)]+)/gi)) {
      if (/wix:image/i.test(imageMatch[0])) debug.wixImageRefsFound += 1;
      if (/static\.wixstatic/i.test(imageMatch[0])) debug.staticWixImagesFound += 1;
      addCandidate(imageMatch[0], "gallery/mainImages");
    }
  }

  for (const match of html.matchAll(/\\u002Fmedia\\u002F([^"',\\\s<>)]+)/gi)) {
    debug.staticWixImagesFound += 1;
    addCandidate(`https://static.wixstatic.com/media/${match[1].replace(/\\u002F/g, "/")}`, "gallery/mainImages");
  }

  debug.attributeImagesFound = (html.match(/(?:src|data-src|href|content)=["'][^"']+["']/gi) || []).length;
  debug.srcsetImagesFound = (html.match(/srcset=["'][^"']+["']/gi) || []).length;
  debug.candidateImagesFound = ordered.length;

  return {
    imageRecords: ordered.slice(0, 5),
    images: ordered.slice(0, 5).map((image) => image.url),
    debug,
  };
}

function titleMatchScore(html, title) {
  const needle = normalizeSearchText(title);
  if (!needle || needle.length < 5) return false;
  const haystack = normalizeSearchText(html);
  const titleParts = needle.split(" ").filter((part) => part.length > 2);
  if (haystack.includes(needle)) return true;
  return titleParts.length >= 3 && titleParts.slice(0, 4).filter((part) => haystack.includes(part)).length >= 3;
}

function productLabel(product) {
  return product === "rent2buy" ? "Rent2Buy" : "Van Finance";
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const queryUrl = new URL(request.url, "http://localhost");
  const product = queryUrl.searchParams.get("product") || "vanFinance";
  const pageUrl = queryUrl.searchParams.get("url") || "";
  const registration = normalizeRegistration(queryUrl.searchParams.get("registration") || "");
  const title = cleanText(queryUrl.searchParams.get("title") || "");
  const allowedHosts = PRODUCT_HOSTS[product] || [];

  if (!pageUrl) {
    sendJson(response, 200, {
      images: [],
      message: "No vehicle page URL is available for this selected vehicle.",
      registration,
      title,
      product,
      productLabel: productLabel(product),
      matchedRegistration: false,
      matchedTitle: false,
      debug: {
        selectedReg: registration,
        selectedTitle: title,
        selectedPageUrl: "",
        product,
        allowedHosts,
        registrationMatchFound: false,
        titleMatchFound: false,
        mainImagesRefsFound: 0,
        galleryRefsFound: 0,
        candidateImagesFound: 0,
        returnedImages: 0,
        image1Url: "",
        image2Url: "",
        image3Url: "",
        image4Url: "",
        image5Url: "",
        image1Source: "",
        dedupeHappened: false,
        finalOrderedImageCount: 0,
      },
    });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(pageUrl);
  } catch {
    sendJson(response, 400, { error: "Selected vehicle page URL is not valid." });
    return;
  }

  if (!allowedHosts.includes(targetUrl.hostname.toLowerCase())) {
    sendJson(response, 400, { error: "Selected vehicle page URL does not match the active Reel Lab product." });
    return;
  }

  try {
    const pageResponse = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Marketing CRM Reel Lab image test",
      },
    });

    if (!pageResponse.ok) {
      sendJson(response, 502, { error: `Vehicle page returned ${pageResponse.status}.` });
      return;
    }

    const html = await pageResponse.text();
    const pageText = normalizeRegistration(html);
    const matchedRegistration = registration ? pageText.includes(registration) : false;
    const matchedTitle = titleMatchScore(html, title);
    const extraction = extractOrderedPageImages(html, targetUrl.toString());
    const images = extraction.images;

    sendJson(response, 200, {
      images,
      imageRecords: extraction.imageRecords,
      registration,
      title,
      pageUrl: targetUrl.toString(),
      product,
      productLabel: productLabel(product),
      sourceHost: targetUrl.hostname,
      matchedRegistration,
      matchedTitle,
      debug: {
        selectedReg: registration,
        selectedTitle: title,
        selectedPageUrl: targetUrl.toString(),
        product,
        sourceHost: targetUrl.hostname,
        allowedHosts,
        registrationMatchFound: matchedRegistration,
        titleMatchFound: matchedTitle,
        htmlLength: html.length,
        ...extraction.debug,
        returnedImages: images.length,
        image1Url: images[0] || "",
        image2Url: images[1] || "",
        image3Url: images[2] || "",
        image4Url: images[3] || "",
        image5Url: images[4] || "",
        image1Source: extraction.imageRecords[0]?.source || "",
        finalOrderedImageCount: images.length,
      },
      message: images.length ? `Found ${images.length} image${images.length === 1 ? "" : "s"}.` : "No van page images found.",
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Could not fetch selected vehicle page images." });
  }
}
