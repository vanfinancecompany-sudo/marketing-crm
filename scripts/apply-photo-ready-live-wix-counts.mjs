import fs from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../api/dealerkit-image-readiness.js", import.meta.url));
let source = fs.readFileSync(path, "utf8");
const marker = "PHOTO_READY_DIRECT_WIX_DETAIL_SOURCE";

if (!source.includes(marker)) {
  const start = source.indexOf("async function fetchPublicCmsItems(");
  const end = source.indexOf("\n\nfunction safeDealerKitDiagnostics", start);
  if (start === -1 || end === -1) {
    throw new Error("Photo-ready live Wix transform could not locate the CMS image-source block.");
  }

  const replacement = `// PHOTO_READY_DIRECT_WIX_DETAIL_SOURCE: use current Wix detail rows rather than lagging public helper feeds.
const WIX_DETAIL_COLLECTIONS = Object.freeze({
  finance: { collectionId: "VANFINANCEPAGES", galleryField: "mainImages", countField: "imageCount" },
  rent2buy: { collectionId: "VANPAGES", galleryField: "mediaGallery", countField: "numberOfImages" },
  cars: { collectionId: "CARPAGES", galleryField: "mainImages", countField: "numberOfImages" },
});

function wixHeaders(pipeline, environment = process.env) {
  const cars = pipeline === "cars";
  const apiKey = compact(cars
    ? (environment.WIX_CAR_API_KEY || environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY)
    : (environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY || environment.WIX_CAR_API_KEY));
  const siteId = compact(cars
    ? (environment.WIX_CAR_SITE_ID || environment.WIX_FINANCE_SITE_ID || environment.WIX_SITE_ID || FINANCE_WIX_SITE_ID)
    : (environment.WIX_FINANCE_SITE_ID || environment.WIX_SITE_ID || FINANCE_WIX_SITE_ID));
  if (!apiKey) throw new Error(pipeline + " Wix image readiness is not configured.");
  return {
    siteId,
    headers: {
      "Content-Type": "application/json",
      "wix-site-id": siteId,
      Authorization: apiKey,
    },
  };
}

function itemPublishStatus(item) {
  return compact(item?.data?._publishStatus || item?._publishStatus || "").toUpperCase();
}

async function fetchCmsItems(pipeline, fetchImplementation = fetch, environment = process.env) {
  const config = WIX_DETAIL_COLLECTIONS[pipeline];
  if (!config) return { items: [], refreshedAt: "" };
  const { headers } = wixHeaders(pipeline, environment);
  const items = [];
  let refreshedAt = "";

  for (let offset = 0; offset < MAX_WIX_ROWS; offset += WIX_PAGE_SIZE) {
    const response = await fetchImplementation(WIX_QUERY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dataCollectionId: config.collectionId,
        query: { paging: { limit: WIX_PAGE_SIZE, offset } },
        consistentRead: true,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = compact(await response.text()).slice(0, 500);
      throw new Error(pipeline + " Wix " + config.collectionId + " returned " + response.status + (detail ? ": " + detail : "") + ".");
    }

    const payload = await response.json();
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    for (const item of page) {
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      const data = item?.data || {};
      const registration = normalizeRegistration(data.title || data.registration || data.reg || "");
      if (!registration) continue;
      const updated = data?._updatedDate?.$date || data?._updatedDate || item?._updatedDate?.$date || item?._updatedDate || "";
      if (updated && (!refreshedAt || new Date(updated).getTime() > new Date(refreshedAt).getTime())) refreshedAt = new Date(updated).toISOString();
      const gallery = Array.isArray(data[config.galleryField]) ? data[config.galleryField].filter(Boolean) : [];
      const explicitCount = Number(data[config.countField]);
      items.push({
        registration,
        title: compact(data.titleText || data.title || registration),
        imageCount: Number.isFinite(explicitCount) && explicitCount >= 0 ? Math.max(explicitCount, gallery.length) : gallery.length,
        images: gallery,
      });
    }
    if (page.length < WIX_PAGE_SIZE) break;
  }

  return { items, refreshedAt };
}
`;

  source = source.slice(0, start) + replacement + source.slice(end);
  fs.writeFileSync(path, source);
}

const updated = fs.readFileSync(path, "utf8");
for (const required of [marker, "VANFINANCEPAGES", "VANPAGES", "CARPAGES"]) {
  if (!updated.includes(required)) throw new Error(`Photo-ready live Wix transform is missing ${required}.`);
}
if (updated.includes("async function fetchPublicCmsItems(")) {
  throw new Error("Photo-ready live Wix transform left the lagging public helper-feed path active.");
}

console.log("Applied photo-ready live Wix image counts for Finance, Rent2Buy and Cars.");
