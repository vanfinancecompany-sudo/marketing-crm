import { WEBSITE_INDEX_CATEGORIES } from "./internalLinking.js";

export const DISCOVERY_ROOT_URL = "https://www.vanfinancecompany.co.uk";

const TRACKING_PARAMETERS = new Set([
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "ref", "source",
]);
const EXCLUDED_PATH = /(?:^|\/)(?:account|login|log-in|signin|sign-in|checkout|cart|basket|search|members?|profile)(?:\/|$)/i;
const EXCLUDED_EXTENSION = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|mp4|mov|avi|zip|docx?|xlsx?)(?:$|[?#])/i;
const CATEGORY_TERMS = new Map([
  ["all stock", ["Stock", ["all stock", "vans in stock"], ["browse", "buying"]]],
  ["small", ["Stock", ["small van", "small vans", "SWB", "short wheelbase", "Berlingo", "Partner", "Combo", "Caddy", "Kangoo", "Doblo"], ["browse stock"]]],
  ["medium", ["Stock", ["medium van", "medium vans", "MWB", "medium wheelbase", "Transit Custom", "Vivaro", "Trafic", "Expert", "Dispatch", "Primastar", "Proace"], ["browse stock"]]],
  ["large", ["Stock", ["large van", "large vans", "LWB", "long wheelbase", "Crafter", "Sprinter", "Relay", "Movano", "Master", "Ducato"], ["browse stock"]]],
  ["crew van", ["Stock", ["crew van", "crew vans", "double cab"], ["browse stock"]]],
  ["pickup", ["Stock", ["pickup", "pick-up", "pickups", "Ranger"], ["browse stock"]]],
  ["tipper", ["Stock", ["tipper", "tippers", "dropside"], ["browse stock"]]],
  ["luton", ["Stock", ["luton", "luton vans", "box van"], ["browse stock"]]],
  ["electric", ["Stock", ["electric van", "electric vans", "EV van"], ["browse stock"]]],
  ["automatic", ["Stock", ["automatic van", "automatic vans"], ["browse stock"]]],
  ["cars", ["Stock", ["cars", "car finance"], ["browse stock"]]],
  ["vans on finance", ["Finance", ["van finance", "vehicle finance", "hire purchase", "lease purchase"], ["commercial", "finance"]]],
  ["rent2buy vans", ["Products", ["Rent2Buy", "rent 2 buy", "rent-to-buy", "no credit check"], ["commercial", "rent2buy"]]],
  ["apply now", ["Applications", ["apply", "application", "finance application"], ["transactional", "ready to apply"]]],
  ["upload documents", ["Applications", ["upload documents", "documents", "proof of income", "documentation"], ["transactional", "documents"]]],
  ["faqs", ["Support", ["FAQ", "frequently asked questions", "help"], ["informational", "support"]]],
  ["contact", ["Support", ["contact", "speak to us", "enquiry"], ["transactional", "support"]]],
  ["knowledge hub", ["Knowledge Hub", ["knowledge hub", "van guide", "finance guide"], ["informational", "research"]]],
]);

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const decodeHtml = (value) =>
  clean(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
const stripTags = (value) => decodeHtml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const normalizedWords = (value) =>
  clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

export function normalizeDiscoveryUrl(value, rootUrl = DISCOVERY_ROOT_URL) {
  const raw = clean(value, 3000);
  if (!raw || /^(?:mailto:|tel:|javascript:|data:|#)/i.test(raw)) return null;
  try {
    const root = new URL(rootUrl);
    const url = new URL(raw, root);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.hostname.replace(/^www\./i, "").toLowerCase() !== root.hostname.replace(/^www\./i, "").toLowerCase()) return null;
    if (EXCLUDED_PATH.test(url.pathname) || EXCLUDED_EXTENSION.test(url.pathname)) return null;
    url.protocol = "https:";
    url.hostname = root.hostname.toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    if (url.searchParams.size) return null; // Wix filters/search state are not unique approved destinations.
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return null;
  }
}

export function duplicateUrlKey(value, rootUrl = DISCOVERY_ROOT_URL) {
  const normalized = normalizeDiscoveryUrl(value, rootUrl);
  if (!normalized) return "";
  const url = new URL(normalized);
  return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${url.pathname.toLowerCase().replace(/\/+$/, "") || "/"}`;
}

export function titleSimilarity(first, second) {
  const a = new Set(normalizedWords(first));
  const b = new Set(normalizedWords(second));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(a.size, b.size);
}

function attribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function evidenceType(attributes, context) {
  const text = `${attributes} ${context}`.toLowerCase();
  if (/footer/.test(text)) return "footer";
  if (/mobile|hamburger|drawer/.test(text)) return "mobile_navigation";
  if (/desktop|header|nav|menu/.test(text)) return "desktop_navigation";
  return "page_content";
}

function categoryMatch(value) {
  const normalized = normalizedWords(value).join(" ");
  for (const [label, configuration] of CATEGORY_TERMS) {
    if (normalized === label || normalized.includes(label)) return { label, configuration };
  }
  return null;
}

export function classifyDiscoveredDestination(input = {}) {
  const text = [input.title, input.navigation_text, input.url, input.meta_description].join(" ");
  const match = categoryMatch(text);
  let category = match?.configuration[0] || "Products";
  if (/knowledge|\/(?:blog|guides?)\//i.test(text)) category = /guide/i.test(text) ? "Guides" : "Knowledge Hub";
  if (!WEBSITE_INDEX_CATEGORIES.includes(category)) category = "Products";
  const matchingTerms = match?.configuration[1] || normalizedWords(input.navigation_text || input.title).slice(0, 8);
  const customerIntent = match?.configuration[2] || ["informational"];
  return {
    suggested_category: category,
    suggested_priority: ["Applications", "Finance", "Products"].includes(category) ? 5 : category === "Stock" ? 4 : 3,
    suggested_description: clean(input.meta_description || `${input.title} destination discovered from the website.`, 1000),
    suggested_keywords: [...new Set(normalizedWords(`${input.title} ${input.navigation_text}`).filter((word) => word.length > 2))].slice(0, 12),
    suggested_matching_terms: [...new Set(matchingTerms)],
    suggested_customer_intent: [...new Set(customerIntent)],
  };
}

export function extractWebsitePage(html, pageUrl, rootUrl = DISCOVERY_ROOT_URL) {
  const source = String(html || "");
  const title = stripTags(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const canonicalRaw = source.match(/<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0] || "";
  const canonicalUrl = normalizeDiscoveryUrl(attribute(canonicalRaw, "href"), rootUrl);
  const metaTags = [...source.matchAll(/<meta\b[^>]*>/gi)].map((item) => item[0]);
  const descriptionTag = metaTags.find((tag) => /(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag));
  const metaDescription = clean(attribute(descriptionTag, "content"), 1000);
  const links = [];
  const seen = new Set();
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = normalizeDiscoveryUrl(attribute(match[1], "href"), rootUrl);
    if (!href) continue;
    const text = stripTags(match[2]) || attribute(match[1], "aria-label") || attribute(match[1], "title");
    const key = duplicateUrlKey(href, rootUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, match.index - 300);
    links.push({
      url: href,
      navigation_text: clean(text, 300),
      evidence_type: evidenceType(match[1], source.slice(start, match.index)),
      source_page: pageUrl,
    });
  }
  // Wix sometimes serialises CMS routes before client-side navigation renders them.
  for (const match of source.matchAll(/"(?:url|pageUrl|relativeUrl|canonicalUrl)"\s*:\s*"((?:\\\/|[^"])*)"/gi)) {
    const raw = match[1].replace(/\\\//g, "/").replace(/\\"/g, '"');
    const url = normalizeDiscoveryUrl(raw, rootUrl);
    const key = duplicateUrlKey(url, rootUrl);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    links.push({ url, navigation_text: "", evidence_type: "wix_embedded_route", source_page: pageUrl });
  }
  const categoriesWithoutUrls = [];
  for (const match of source.matchAll(/<(button|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    if (tag === "div" && !/\brole\s*=\s*["']button["']/i.test(attributes)) continue;
    const text = stripTags(match[3]);
    const category = categoryMatch(text);
    if (!category || attribute(attributes, "href") || /<a\b/i.test(match[3]) || text.length > 80) continue;
    const key = category.label;
    if (categoriesWithoutUrls.some((item) => item.key === key)) continue;
    categoriesWithoutUrls.push({
      key,
      title: text,
      url: null,
      navigation_text: text,
      source_page: pageUrl,
      requires_manual_mapping: true,
      evidence_type: "wix_filter_control",
    });
  }
  return { title, canonical_url: canonicalUrl, meta_description: metaDescription, links, categories_without_urls: categoriesWithoutUrls };
}

export function findDuplicate(candidate, existing = [], earlierCandidates = [], rootUrl = DISCOVERY_ROOT_URL) {
  const candidateKeys = [
    ["canonical_url", duplicateUrlKey(candidate.canonical_url, rootUrl)],
    ["normalized_url", duplicateUrlKey(candidate.url, rootUrl)],
    ["redirect_destination", duplicateUrlKey(candidate.redirect_chain?.at?.(-1), rootUrl)],
  ].filter(([, key]) => key);
  for (const page of existing) {
    const pageKeys = new Set([duplicateUrlKey(page.url, rootUrl), duplicateUrlKey(page.canonical_url, rootUrl)].filter(Boolean));
    const match = candidateKeys.find(([, key]) => pageKeys.has(key));
    if (match) return { duplicate_type: match[0], existing_page_id: page.id };
    if (titleSimilarity(candidate.title, page.title) >= 0.82) {
      return { duplicate_type: "title_similarity", existing_page_id: page.id };
    }
  }
  for (const earlier of earlierCandidates) {
    const earlierKeys = new Set([duplicateUrlKey(earlier.url, rootUrl), duplicateUrlKey(earlier.canonical_url, rootUrl)].filter(Boolean));
    if (candidateKeys.some(([, key]) => earlierKeys.has(key)) || titleSimilarity(candidate.title, earlier.title) >= 0.9) {
      return { duplicate_type: "candidate", duplicate_of_candidate_id: earlier.id || earlier.local_id };
    }
  }
  return { duplicate_type: "none" };
}

export function discoverySummary(candidates = [], pagesScanned = 0, brokenLinks = 0) {
  return {
    pages_scanned: pagesScanned,
    candidates_found: candidates.length,
    existing_records: candidates.filter((item) => item.existing_page_id).length,
    duplicates: candidates.filter((item) => item.duplicate_type !== "none").length,
    rejected: candidates.filter((item) => item.status === "rejected").length,
    pending_review: candidates.filter((item) => item.status === "pending_review").length,
    categories_without_urls: candidates.filter((item) => item.requires_manual_mapping).length,
    broken_links: brokenLinks,
  };
}
