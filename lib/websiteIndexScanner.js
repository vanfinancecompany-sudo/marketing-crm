import {
  DISCOVERY_ROOT_URL,
  classifyDiscoveredDestination,
  duplicateUrlKey,
  extractWebsitePage,
  normalizeNavigationLabel,
  normalizeDiscoveryUrl,
} from "./websiteIndexDiscovery.js";

const MAX_HTML_BYTES = 2_000_000;
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

export async function fetchWebsiteDocument(url, {
  fetchImpl = fetch,
  rootUrl = DISCOVERY_ROOT_URL,
  timeoutMs = 8000,
  maximumRedirects = 5,
} = {}) {
  let current = normalizeDiscoveryUrl(url, rootUrl);
  if (!current) throw new Error("The website URL is outside the approved scan domain.");
  const redirectChain = [];
  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "VanFinanceCompany-WebsiteIndexDiscovery/1.0" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = normalizeDiscoveryUrl(location ? new URL(location, current).toString() : "", rootUrl);
      if (!next) throw new Error("The page redirects outside the approved website.");
      redirectChain.push(next);
      current = next;
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return { url: current, status: response.status, redirect_chain: redirectChain, html: "", scannable: false };
    }
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { url: current, status: response.status, redirect_chain: redirectChain, html, scannable: response.ok };
  }
  throw new Error("The page exceeded the redirect safety limit.");
}

export async function scanWebsite({
  rootUrl = DISCOVERY_ROOT_URL,
  maximumPages = 60,
  fetchImpl = fetch,
} = {}) {
  const approvedRoot = normalizeDiscoveryUrl(rootUrl, DISCOVERY_ROOT_URL);
  if (!approvedRoot) throw new Error("Only the Van Finance Company website can be scanned.");
  const queued = [{ url: approvedRoot, source_page: approvedRoot, navigation_text: "Home", evidence_type: "scan_root" }];
  const queuedKeys = new Set([duplicateUrlKey(approvedRoot, approvedRoot)]);
  const visited = new Set();
  const candidates = [];
  const broken = [];
  while (queued.length && visited.size < maximumPages) {
    const discovered = queued.shift();
    const key = duplicateUrlKey(discovered.url, approvedRoot);
    if (!key || visited.has(key)) continue;
    visited.add(key);
    try {
      const document = await fetchWebsiteDocument(discovered.url, { fetchImpl, rootUrl: approvedRoot });
      const page = extractWebsitePage(document.html, document.url, approvedRoot);
      const candidate = {
        local_id: `candidate_${candidates.length + 1}`,
        title: clean(
          normalizeNavigationLabel(page.title || discovered.navigation_text) ||
            new URL(document.url).pathname,
          300
        ),
        url: discovered.url,
        canonical_url: page.canonical_url || document.url,
        navigation_text: clean(normalizeNavigationLabel(discovered.navigation_text), 300),
        meta_description: page.meta_description,
        source_page: discovered.source_page,
        http_status: document.status,
        redirect_chain: document.redirect_chain,
        evidence: {
          evidence_type: discovered.evidence_type,
          public_html: document.scannable,
          source_navigation_text: discovered.navigation_text,
        },
        requires_manual_mapping: false,
        status: "pending_review",
        verified: false,
        available_to_internal_linking: false,
      };
      Object.assign(candidate, classifyDiscoveredDestination(candidate));
      candidates.push(candidate);
      if (!document.scannable) {
        broken.push({ url: document.url, status: document.status });
        continue;
      }
      for (const link of page.links) {
        const linkKey = duplicateUrlKey(link.url, approvedRoot);
        if (!linkKey || queuedKeys.has(linkKey) || visited.has(linkKey)) continue;
        queuedKeys.add(linkKey);
        queued.push(link);
      }
      for (const unmapped of page.categories_without_urls) {
        const candidateWithoutUrl = {
          ...unmapped,
          local_id: `candidate_${candidates.length + 1}`,
          canonical_url: null,
          meta_description: "",
          http_status: null,
          redirect_chain: [],
          evidence: { evidence_type: unmapped.evidence_type, category_detected: true, unique_url_detected: false },
          status: "pending_review",
          verified: false,
          available_to_internal_linking: false,
        };
        Object.assign(candidateWithoutUrl, classifyDiscoveredDestination(candidateWithoutUrl));
        candidates.push(candidateWithoutUrl);
      }
    } catch (error) {
      broken.push({ url: discovered.url, status: null, error: clean(error.message, 1000) });
    }
  }
  return { root_url: approvedRoot, pages_scanned: visited.size, candidates, broken_links: broken };
}
