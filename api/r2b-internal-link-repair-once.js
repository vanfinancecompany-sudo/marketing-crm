import { readFile } from "node:fs/promises";

const TOKEN = "le4KOE_dqIsobqd_iuwB0eUjWdSN4RHNb09M3wDwx4o";
const SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const COLLECTION_ID = "Import3";
const API_BASE = "https://www.wixapis.com";
const VFC = "https://www.vanfinancecompany.co.uk";
const APP_URL = "/apply-for-no-credit-check-rent2buy-vans";
const STOCK_URL = "/view-all-vans";
const ABOUT_URL = "/what-is-rent2buy-vans";

let cachedMap;
async function getLinkMap() {
  if (cachedMap) return cachedMap;
  const raw = await readFile(new URL("../data/r2b-internal-link-map.json", import.meta.url), "utf8");
  cachedMap = JSON.parse(raw);
  return cachedMap;
}

function clean(value, limit = 3000) {
  return String(value || "").trim().slice(0, limit);
}

async function wix(path, { method = "GET", body } = {}) {
  const apiKey = clean(process.env.WIX_API_KEY, 10000);
  if (!apiKey) throw new Error("WIX_API_KEY is not available in this deployment.");
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: apiKey,
      "wix-site-id": SITE_ID,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.details?.applicationError?.description || `Wix request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

async function queryAll() {
  const payload = await wix("/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: COLLECTION_ID,
      query: { paging: { limit: 1000 } },
      returnTotalCount: true,
    },
  });
  return payload.dataItems || [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function linkUrlFromDecoration(decoration) {
  return clean(decoration?.linkData?.link?.url, 3000);
}

function isLinkDecoration(decoration) {
  return decoration?.type === "LINK" && Boolean(linkUrlFromDecoration(decoration));
}

function collectLinkEntries(content) {
  const entries = [];
  function walk(value, text = "") {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, text);
      return;
    }
    if (typeof value !== "object") return;
    const nextText = clean(value?.textData?.text, 2000) || text;
    if (Array.isArray(value?.textData?.decorations)) {
      for (const decoration of value.textData.decorations) {
        const url = linkUrlFromDecoration(decoration);
        if (url) entries.push({ text: nextText, url });
      }
    }
    for (const child of Object.values(value)) walk(child, nextText);
  }
  walk(content);
  return entries;
}

function allVisibleText(content) {
  const parts = [];
  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object") return;
    if (typeof value?.textData?.text === "string") parts.push(value.textData.text);
    for (const child of Object.values(value)) walk(child);
  }
  walk(content);
  return parts.join("\n");
}

function replacementForOldUrl(url, anchor = "") {
  const normalized = clean(url, 3000).toLowerCase();
  const label = clean(anchor, 1000).toLowerCase();
  if (!normalized.startsWith(VFC)) return "";
  if (normalized.includes("rent2buy-application")) return APP_URL;
  if (!normalized.includes("rent2buy")) return "";
  if (/\b(apply|application|eligib)/i.test(label)) return APP_URL;
  if (/\b(stock|available|view vans|prices?|vehicles?)\b/i.test(label)) return STOCK_URL;
  if (/credit check|how rent2buy|rent2buy works|scheme/i.test(label)) return ABOUT_URL;
  return ABOUT_URL;
}

function rewriteStructuredLinks(content, changes) {
  function walk(value, anchor = "") {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, anchor));
    if (typeof value !== "object") return;
    const text = clean(value?.textData?.text, 1500) || anchor;
    if (Array.isArray(value?.textData?.decorations)) {
      for (const decoration of value.textData.decorations) {
        if (!isLinkDecoration(decoration)) continue;
        const current = linkUrlFromDecoration(decoration);
        const replacement = replacementForOldUrl(current, text);
        if (replacement && replacement !== current) {
          decoration.linkData.link.url = replacement;
          decoration.linkData.target = "SELF";
          changes.push({ type: "replace_old", anchor: text, from: current, to: replacement });
        } else if (current.startsWith("/knowledge-hub-articles/") || [APP_URL, STOCK_URL, ABOUT_URL].includes(current)) {
          decoration.linkData.target = "SELF";
        }
      }
    }
    for (const child of Object.values(value)) walk(child, text);
  }
  walk(content);
}

function nextNodeId(state, base = "r2b-link") {
  state.seq += 1;
  return `${base}-${state.seq}`;
}

function makeTextNode(template, text, decorations, state) {
  return {
    ...clone(template),
    id: nextNodeId(state, clean(template?.id, 60) || "r2b-link"),
    textData: {
      ...(clone(template?.textData || {})),
      text,
      decorations,
    },
  };
}

function linkDecoration(url) {
  return { type: "LINK", linkData: { link: { url }, target: "SELF" } };
}

function normalizeMarkdownLinks(content, changes, state) {
  const pattern = /(\*\*)?\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)(\*\*)?/gi;
  for (const block of content?.nodes || []) {
    if (!Array.isArray(block?.nodes)) continue;
    const expanded = [];
    for (const child of block.nodes) {
      const text = String(child?.textData?.text || "");
      if (!text || (child?.textData?.decorations || []).some(isLinkDecoration) || !pattern.test(text)) {
        pattern.lastIndex = 0;
        expanded.push(child);
        continue;
      }
      pattern.lastIndex = 0;
      let cursor = 0;
      let matched = false;
      let match;
      while ((match = pattern.exec(text))) {
        matched = true;
        if (match.index > cursor) {
          expanded.push(makeTextNode(child, text.slice(cursor, match.index), clone(child.textData.decorations || []), state));
        }
        const anchor = match[2];
        const sourceUrl = match[3];
        const targetUrl = replacementForOldUrl(sourceUrl, anchor) || sourceUrl;
        const decorations = clone(child.textData.decorations || []).filter((item) => item?.type !== "LINK");
        decorations.push(linkDecoration(targetUrl));
        if ((match[1] || match[4]) && !decorations.some((item) => item?.type === "BOLD")) decorations.push({ type: "BOLD" });
        expanded.push(makeTextNode(child, anchor, decorations, state));
        changes.push({ type: sourceUrl.startsWith(VFC) ? "convert_old_markdown" : "convert_markdown", anchor, from: sourceUrl, to: targetUrl });
        cursor = pattern.lastIndex;
      }
      if (!matched) expanded.push(child);
      else if (cursor < text.length) expanded.push(makeTextNode(child, text.slice(cursor), clone(child.textData.decorations || []), state));
    }
    block.nodes = expanded;
  }
}

function hasUrl(content, url) {
  return collectLinkEntries(content).some((entry) => entry.url === url);
}

function addNaturalAnchorLink(content, anchor, url, changes, state) {
  if (!anchor || !url || hasUrl(content, url)) return false;
  const needle = anchor.toLowerCase();
  for (const block of content?.nodes || []) {
    if (block?.type === "HEADING" || !Array.isArray(block?.nodes)) continue;
    for (let index = 0; index < block.nodes.length; index += 1) {
      const child = block.nodes[index];
      const text = String(child?.textData?.text || "");
      if (!text || (child?.textData?.decorations || []).some(isLinkDecoration)) continue;
      const start = text.toLowerCase().indexOf(needle);
      if (start < 0) continue;
      const end = start + anchor.length;
      const before = text.slice(0, start);
      const linkedText = text.slice(start, end);
      const after = text.slice(end);
      const baseDecorations = clone(child.textData.decorations || []).filter((item) => item?.type !== "LINK");
      const parts = [];
      if (before) parts.push(makeTextNode(child, before, baseDecorations, state));
      parts.push(makeTextNode(child, linkedText, [...baseDecorations, linkDecoration(url)], state));
      if (after) parts.push(makeTextNode(child, after, baseDecorations, state));
      block.nodes.splice(index, 1, ...parts);
      changes.push({ type: "add_contextual", anchor: linkedText, to: url });
      return true;
    }
  }
  return false;
}

function ensureCommercialLink(content, changes, state) {
  const existing = collectLinkEntries(content).map((item) => item.url);
  if (existing.some((url) => [APP_URL, STOCK_URL, ABOUT_URL].includes(url))) return false;
  const text = allVisibleText(content).toLowerCase();
  if (text.includes("no credit check")) return addNaturalAnchorLink(content, "no credit check", ABOUT_URL, changes, state);
  for (const anchor of ["Rent2Buy application", "apply for Rent2Buy", "application process"]) {
    if (text.includes(anchor.toLowerCase()) && addNaturalAnchorLink(content, anchor, APP_URL, changes, state)) return true;
  }
  for (const anchor of ["view available Rent2Buy vans", "available Rent2Buy vans", "available vans", "browse available vans"]) {
    if (text.includes(anchor.toLowerCase()) && addNaturalAnchorLink(content, anchor, STOCK_URL, changes, state)) return true;
  }
  return false;
}

function transformItem(item, linkMap) {
  const content = clone(item?.data?.content || {});
  const before = JSON.stringify(content);
  const changes = [];
  const state = { seq: 0 };
  rewriteStructuredLinks(content, changes);
  normalizeMarkdownLinks(content, changes, state);
  const planned = linkMap[item.id] || linkMap[item?.data?.crmArticleId] || [];
  for (const [anchor, url] of planned.slice(0, 2)) addNaturalAnchorLink(content, anchor, url, changes, state);
  ensureCommercialLink(content, changes, state);
  const after = JSON.stringify(content);
  return { content, changed: before !== after, changes };
}

function audit(items) {
  const rows = [];
  let stale = 0;
  let articleLinks = 0;
  let commercialLinks = 0;
  let zeroLinkArticles = 0;
  for (const item of items) {
    const links = collectLinkEntries(item?.data?.content || {});
    const staleHere = links.filter((entry) => entry.url.startsWith(VFC));
    const articleHere = links.filter((entry) => entry.url.startsWith("/knowledge-hub-articles/"));
    const commercialHere = links.filter((entry) => [APP_URL, STOCK_URL, ABOUT_URL].includes(entry.url));
    stale += staleHere.length;
    articleLinks += articleHere.length;
    commercialLinks += commercialHere.length;
    if (!links.length) zeroLinkArticles += 1;
    rows.push({
      id: item.id,
      slug: item?.data?.slug || "",
      title: item?.data?.title || "",
      total_links: links.length,
      article_links: articleHere.length,
      commercial_links: commercialHere.length,
      stale_vfc_links: staleHere.length,
    });
  }
  return {
    article_count: items.length,
    stale_vfc_links: stale,
    article_to_article_links: articleLinks,
    rent2buy_commercial_links: commercialLinks,
    articles_with_zero_links: zeroLinkArticles,
    rows,
  };
}

async function patchContent(itemId, content) {
  return wix(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: {
      dataCollectionId: COLLECTION_ID,
      patch: {
        dataItemId: itemId,
        fieldModifications: [
          {
            fieldPath: "content",
            action: "SET_FIELD",
            setFieldOptions: { value: content },
          },
        ],
      },
    },
  });
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return output;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const token = clean(request.query?.token, 200);
  if (token !== TOKEN) return response.status(404).json({ ok: false });
  const mode = clean(request.query?.mode || "audit", 20).toLowerCase();
  if (!["audit", "apply"].includes(mode)) return response.status(400).json({ ok: false, message: "Use mode=audit or mode=apply." });

  try {
    const linkMap = await getLinkMap();
    const items = await queryAll();
    const before = audit(items);
    if (mode === "audit") return response.status(200).json({ ok: true, mode, before });

    if (items.length !== 52) {
      return response.status(409).json({ ok: false, message: `Expected 52 Rent2Buy articles, found ${items.length}. No changes made.`, before });
    }

    const transformed = items.map((item) => ({ item, ...transformItem(item, linkMap) }));
    const changed = transformed.filter((entry) => entry.changed);
    const results = await mapLimit(changed, 4, async (entry) => {
      try {
        await patchContent(entry.item.id, entry.content);
        return { ok: true, id: entry.item.id, slug: entry.item?.data?.slug || "", changes: entry.changes };
      } catch (error) {
        return { ok: false, id: entry.item.id, slug: entry.item?.data?.slug || "", message: clean(error.message, 1000) };
      }
    });
    const failures = results.filter((result) => !result.ok);
    const refreshed = await queryAll();
    const after = audit(refreshed);
    const changes = results.filter((result) => result.ok).flatMap((result) => result.changes.map((change) => ({ id: result.id, slug: result.slug, ...change })));

    return response.status(failures.length ? 207 : 200).json({
      ok: failures.length === 0,
      mode,
      before,
      attempted_articles: changed.length,
      updated_articles: results.filter((result) => result.ok).length,
      failed_articles: failures.length,
      failures,
      change_count: changes.length,
      changes,
      after,
      published_live: false,
      note: "Only the existing Rich Content field was patched; article titles, excerpts, slugs, SEO fields and article copy were not rewritten.",
    });
  } catch (error) {
    return response.status(500).json({ ok: false, message: clean(error.message, 2000) || "Rent2Buy internal-link repair failed." });
  }
}
