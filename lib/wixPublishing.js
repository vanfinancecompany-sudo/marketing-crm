import { KNOWLEDGE_CATEGORIES, normalizeKnowledgeCategory } from "./knowledgeHub.js";
import {
  WIX_ARTICLE_BODY_TYPOGRAPHY,
  malformedTableToStackedText,
  renderMalformedTableHtml,
  renderResponsiveTableHtml,
  splitMarkdownTableSegments,
  tableToStackedText,
} from "./markdownTables.js";

const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
export const WIX_KNOWLEDGE_COLLECTION_ID = "Import3";
export const WIX_KNOWLEDGE_PAYLOAD_VERSION = "4";
export const WIX_KNOWLEDGE_CONTENT_FIELD_ID = "content";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

export class WixPublishingError extends Error {
  constructor(type, message, status = 400, details = {}) {
    super(message);
    this.name = "WixPublishingError";
    this.type = type;
    this.status = status;
    this.details = details;
  }
}

export function wixPublishingConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 10000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  const collectionId = clean(environment.WIX_KNOWLEDGE_COLLECTION_ID, 500);
  const missing = [!apiKey && "WIX_API_KEY", !siteId && "WIX_SITE_ID", !collectionId && "WIX_KNOWLEDGE_COLLECTION_ID"].filter(Boolean);
  if (missing.length) throw new WixPublishingError("configuration", `Wix publishing is not configured. Missing ${missing.join(", ")}.`, 500, { missing });
  if (collectionId !== WIX_KNOWLEDGE_COLLECTION_ID) throw new WixPublishingError("configuration", `WIX_KNOWLEDGE_COLLECTION_ID must be ${WIX_KNOWLEDGE_COLLECTION_ID}.`, 500);
  return {
    apiKey,
    siteId,
    collectionId,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || DEFAULT_WIX_API_BASE_URL,
    dashboardUrl: clean(environment.WIX_KNOWLEDGE_DASHBOARD_URL, 2000) || `https://manage.wix.com/dashboard/${encodeURIComponent(siteId)}/database/${encodeURIComponent(collectionId)}`,
  };
}

export function validateWixArticle(article = {}) {
  if (article.status !== "approved") throw new WixPublishingError("validation", "Only approved Knowledge Hub articles can be sent to Wix.", 400);
  const required = [["title", "Article title"], ["slug", "Slug"], ["content_markdown", "Article body"], ["seo_title", "SEO title"], ["meta_description", "Meta description"]];
  const missing = required.filter(([field]) => !clean(article[field])).map(([, label]) => label);
  if (!clean(article.id)) missing.push("CRM article ID");
  if (missing.length) throw new WixPublishingError("validation", `Complete these article fields before creating a Wix draft: ${missing.join(", ")}.`, 400, { missing });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean(article.slug))) throw new WixPublishingError("validation", "The Wix slug must contain lowercase letters, numbers and hyphens only.", 400);
  return article;
}

export function acceptedInternalLinks(suggestions = []) {
  const seen = new Set();
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter((item) => item?.status === "accepted")
    .map((item) => ({ anchorText: clean(item.anchor_text, 200), url: clean(item.destination_url, 2000) }))
    .filter((item) => item.anchorText && /^(?:https:\/\/|\/(?!\/))/i.test(item.url))
    .filter((item) => { const key = item.url.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function applyAcceptedInternalLinks(markdown, suggestions = []) {
  let output = clean(markdown, 200000);
  for (const link of acceptedInternalLinks(suggestions)) {
    if (output.includes(`](${link.url})`)) continue;
    const expression = new RegExp(`(^|[^\\[])(${escapeRegExp(link.anchorText)})(?![^\\[]*\\]\\([^)]*\\))`, "im");
    output = output.replace(expression, (_match, prefix, anchor) => `${prefix}[${anchor}](${link.url})`);
  }
  return output;
}

function normalizeArticleMarkdown(value) {
  return clean(value, 200000)
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/([^\n])\n(#{2,3}\s+)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inlineNodes(value, nextId, baseDecorations = []) {
  const text = String(value || "");
  const nodes = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push({ type: "TEXT", id: nextId(), textData: { text: text.slice(cursor, match.index), decorations: [...baseDecorations] } });
    if (match[1]) {
      nodes.push({ type: "TEXT", id: nextId(), textData: { text: match[1], decorations: [...baseDecorations, { type: "LINK", linkData: { link: { url: match[2] }, target: "BLANK" } }] } });
    } else {
      nodes.push({ type: "TEXT", id: nextId(), textData: { text: match[3] || match[4] || "", decorations: [...baseDecorations, ...(match[3] ? [{ type: "BOLD" }] : [{ type: "ITALIC" }])] } });
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length || !nodes.length) nodes.push({ type: "TEXT", id: nextId(), textData: { text: text.slice(cursor), decorations: [...baseDecorations] } });
  return nodes;
}

export function wixArticleBodyTextStyle() {
  return {
    textAlignment: "AUTO",
    fontFamily: WIX_ARTICLE_BODY_TYPOGRAPHY.fontFamily,
    fontSize: WIX_ARTICLE_BODY_TYPOGRAPHY.fontSize,
    lineHeight: WIX_ARTICLE_BODY_TYPOGRAPHY.lineHeight,
    color: WIX_ARTICLE_BODY_TYPOGRAPHY.color,
  };
}

function richParagraph(text, nextId, decorations = []) {
  return { type: "PARAGRAPH", id: nextId(), nodes: inlineNodes(text, nextId, decorations), paragraphData: { textStyle: wixArticleBodyTextStyle(), indentation: 0 } };
}
function richHeading(text, level, nextId) {
  return { type: "HEADING", id: nextId(), nodes: inlineNodes(text, nextId), headingData: { level, textStyle: { textAlignment: "AUTO" }, indentation: 0 } };
}
function richHtml(html, nextId) {
  return { type: "HTML", id: nextId(), htmlData: { html } };
}
function addHeadingSpacing(nodes, level, nextId) { if (nodes.length && [2, 3].includes(level)) nodes.push(richParagraph("", nextId)); }

function appendMarkdownNodes(markdown, nodes, nextId) {
  const blocks = String(markdown || "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const bullet = line.match(/^[-*]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      const text = heading?.[2] || bullet?.[1] || numbered?.[1] || line;
      if (heading) {
        const level = Math.min(6, heading[1].length);
        addHeadingSpacing(nodes, level, nextId);
        nodes.push(richHeading(text, level, nextId));
      } else {
        nodes.push(richParagraph(bullet ? `• ${text}` : numbered ? `${line.match(/^\d+/)?.[0]}. ${text}` : text, nextId));
      }
    }
  }
}

export function collectMarkdownTableWarnings(markdown) {
  return splitMarkdownTableSegments(markdown).warnings;
}

export function buildWixRichContent(markdown, suggestions = [], cta = "") {
  let sequence = 0;
  const nextId = () => `crm-${++sequence}`;
  const linkedMarkdown = applyAcceptedInternalLinks(normalizeArticleMarkdown(markdown), suggestions);
  const { segments } = splitMarkdownTableSegments(linkedMarkdown);
  const nodes = [];
  for (const segment of segments) {
    if (segment.type === "markdown") appendMarkdownNodes(segment.markdown, nodes, nextId);
    else if (segment.type === "table") nodes.push(richHtml(renderResponsiveTableHtml(segment.table), nextId));
    else nodes.push(richHtml(renderMalformedTableHtml(segment.table), nextId));
  }
  const ctaText = clean(cta, 2000);
  if (ctaText && !linkedMarkdown.includes(ctaText)) {
    addHeadingSpacing(nodes, 2, nextId);
    nodes.push(richHeading("Next step", 2, nextId));
    nodes.push(richParagraph(ctaText, nextId, [{ type: "BOLD" }]));
  }
  const now = new Date().toISOString();
  return { nodes, metadata: { version: 1, createdTimestamp: now, updatedTimestamp: now } };
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function buildWixPlainTextContent(markdown, suggestions = [], cta = "") {
  const linked = applyAcceptedInternalLinks(normalizeArticleMarkdown(markdown), suggestions);
  const { segments } = splitMarkdownTableSegments(linked);
  let content = segments.map((segment) => {
    if (segment.type === "table") return tableToStackedText(segment.table);
    if (segment.type === "table_fallback") return malformedTableToStackedText(segment.table);
    return segment.markdown;
  }).join("\n\n");
  if (clean(cta) && !content.includes(clean(cta))) content = `${content}\n\nNext step\n${clean(cta, 2000)}`;
  return stripInlineMarkdown(content)
    .replace(/^(#{1,6})\s+(.+)$/gm, "$2")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWixFieldType(value) { return clean(value, 100).toUpperCase().replace(/[\s-]+/g, "_"); }
export function resolveWixContentFieldType(payload = {}) {
  const collection = payload.dataCollection || payload.collection || payload;
  const fields = Array.isArray(collection?.fields) ? collection.fields : [];
  const field = fields.find((candidate) => clean(candidate?.key || candidate?.fieldKey || candidate?.id, 500).toLowerCase() === WIX_KNOWLEDGE_CONTENT_FIELD_ID);
  if (!field) throw new WixPublishingError("configuration", `Wix collection ${WIX_KNOWLEDGE_COLLECTION_ID} does not contain the ${WIX_KNOWLEDGE_CONTENT_FIELD_ID} field.`, 500);
  const fieldType = normalizeWixFieldType(field.type);
  if (fieldType === "TEXT") return "TEXT";
  if (fieldType === "RICH_CONTENT" || fieldType === "RICHCONTENT") return "RICH_CONTENT";
  throw new WixPublishingError("configuration", `Wix field ${WIX_KNOWLEDGE_CONTENT_FIELD_ID} must be Text or Rich Content; Wix reports ${fieldType || "an unknown type"}.`, 500, { field_type: fieldType || "UNKNOWN" });
}

function wixCategory(value) {
  const category = normalizeKnowledgeCategory(value);
  if (!category) throw new WixPublishingError("validation", `Choose a supported Knowledge Hub category before syncing to Wix: ${KNOWLEDGE_CATEGORIES.join(", ")}.`, 400, { allowed_categories: KNOWLEDGE_CATEGORIES });
  return category;
}

export function buildWixArticleData(article, suggestions = [], contentFieldType = "RICH_CONTENT") {
  validateWixArticle(article);
  const normalizedType = normalizeWixFieldType(contentFieldType);
  if (!["TEXT", "RICH_CONTENT"].includes(normalizedType)) throw new WixPublishingError("configuration", "The Wix article content field must be Text or Rich Content.", 500);
  return {
    title: clean(article.title, 500),
    slug: clean(article.slug, 500),
    excerpt: clean(article.excerpt, 3000),
    content: normalizedType === "TEXT" ? buildWixPlainTextContent(article.content_markdown, suggestions, article.cta) : buildWixRichContent(article.content_markdown, suggestions, article.cta),
    seoTitle: clean(article.seo_title, 500),
    metaDescription: clean(article.meta_description, 1000),
    category: wixCategory(article.category),
    ...(clean(article.featured_image, 3000) ? { featuredImage: clean(article.featured_image, 3000) } : {}),
    crmArticleId: clean(article.id, 500),
    syncStatus: "Draft",
  };
}

function safeWixMessage(payload, status) {
  const message = clean(payload?.message || payload?.details?.applicationError?.description || payload?.details?.validationError?.fieldViolations?.[0]?.description, 500);
  if (status === 401 || status === 403) return "Wix rejected the API credentials or site access.";
  if (status === 400) return message || "Wix rejected the article data.";
  return message || `Wix API request failed with status ${status}.`;
}
function findWixErrorCode(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value.match(/\bWDE\d{4}\b/i)?.[0]?.toUpperCase() || "";
  if (Array.isArray(value)) { for (const item of value) { const code = findWixErrorCode(item, depth + 1); if (code) return code; } return ""; }
  if (typeof value === "object") { for (const item of Object.values(value)) { const code = findWixErrorCode(item, depth + 1); if (code) return code; } }
  return "";
}
export function isWixMissingItemError(error) { return error?.details?.wix_error_code === "WDE0073"; }

export class WixCmsClient {
  constructor(configuration, fetchImpl = fetch) { this.configuration = configuration; this.fetchImpl = fetchImpl; }
  async request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.configuration.apiBaseUrl}${path}`, { method, headers: { Authorization: this.configuration.apiKey, "wix-site-id": this.configuration.siteId, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new WixPublishingError("api", "Wix could not be reached. Check the deployment network and retry.", 502); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const wixErrorCode = findWixErrorCode(payload);
      const type = [401, 403].includes(response.status) ? "authentication" : response.status === 400 ? "validation" : "api";
      throw new WixPublishingError(type, safeWixMessage(payload, response.status), type === "authentication" ? 502 : response.status, { wix_status: response.status, ...(wixErrorCode ? { wix_error_code: wixErrorCode } : {}) });
    }
    return payload;
  }
  async find(field, value) { const payload = await this.request("/wix-data/v2/items/query", { method: "POST", body: { dataCollectionId: this.configuration.collectionId, query: { filter: { [field]: { $eq: value } }, paging: { limit: 2 } } } }); return payload.dataItems || []; }
  async contentFieldType() { return resolveWixContentFieldType(await this.request(`/wix-data/v2/collections/${encodeURIComponent(this.configuration.collectionId)}`)); }
  async create(data, itemId) { const payload = await this.request("/wix-data/v2/items", { method: "POST", body: { dataCollectionId: this.configuration.collectionId, dataItem: { id: itemId, data } } }); return payload.dataItem; }
  async update(itemId, data) { const payload = await this.request(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, { method: "PUT", body: { dataCollectionId: this.configuration.collectionId, dataItem: { id: itemId, data } } }); return payload.dataItem; }
}

async function resolveExistingWixItem(client, article, excludedItemId = "") {
  const excluded = clean(excludedItemId, 500);
  const crmMatches = (await client.find("crmArticleId", article.id)).filter((item) => clean(item?.id, 500) !== excluded);
  if (crmMatches.length > 1) throw new WixPublishingError("validation", "Wix contains more than one item for this CRM article. Resolve the duplicates in Wix before retrying.", 409);
  const crmItemId = clean(crmMatches[0]?.id, 500);
  if (crmItemId) return crmItemId;
  const slugMatches = (await client.find("slug", article.slug)).filter((item) => clean(item?.id, 500) !== excluded);
  const conflicting = slugMatches.find((item) => clean(item?.data?.crmArticleId, 500) !== clean(article.id, 500));
  if (conflicting) throw new WixPublishingError("validation", "That slug already belongs to another Wix item. Change the article slug before retrying.", 409);
  return clean(slugMatches[0]?.id, 500);
}

export async function createOrUpdateWixDraft({ article, suggestions = [], configuration, fetchImpl = fetch }) {
  validateWixArticle(article);
  const client = new WixCmsClient(configuration, fetchImpl);
  const contentFieldType = await client.contentFieldType();
  const data = buildWixArticleData(article, suggestions, contentFieldType);
  const tableConversionWarnings = collectMarkdownTableWarnings(applyAcceptedInternalLinks(normalizeArticleMarkdown(article.content_markdown), suggestions));
  let itemId = clean(article.wix_item_id, 500);
  let operation = itemId ? "updated" : "created";
  let missingStoredItemId = "";
  let item;
  if (!itemId) { itemId = await resolveExistingWixItem(client, article); operation = itemId ? "updated" : "created"; }
  if (itemId) {
    try { item = await client.update(itemId, data); }
    catch (error) { if (!isWixMissingItemError(error) || !clean(article.wix_item_id, 500)) throw error; missingStoredItemId = itemId; itemId = ""; operation = "created"; }
  }
  if (!item && missingStoredItemId) {
    try { itemId = await resolveExistingWixItem(client, article, missingStoredItemId); operation = itemId ? "updated" : "created"; if (itemId) item = await client.update(itemId, data); }
    catch (error) { error.details = { ...(error.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true }; throw error; }
  }
  if (!item) {
    try { item = await client.create(data, article.id); }
    catch (error) {
      try { if (error.details?.wix_status !== 409) throw error; const recovered = await client.find("crmArticleId", article.id); const recoveredId = clean(recovered[0]?.id, 500) || clean(article.id, 500); operation = "updated"; item = await client.update(recoveredId, data); }
      catch (recoveryError) { if (missingStoredItemId) recoveryError.details = { ...(recoveryError.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true }; throw recoveryError; }
    }
  }
  const savedItemId = clean(item?.id, 500);
  if (!savedItemId) throw new WixPublishingError("api", "Wix did not return an item ID.", 502);
  return { operation, itemId: savedItemId, collectionId: configuration.collectionId, dashboardUrl: configuration.dashboardUrl, syncStatus: "synced", payloadVersion: WIX_KNOWLEDGE_PAYLOAD_VERSION, contentFieldType, recoveredMissingItem: Boolean(missingStoredItemId), replacedItemId: missingStoredItemId || null, tableConversionWarnings, data };
}
