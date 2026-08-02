import {
  WixCmsClient,
  WixPublishingError,
  WIX_KNOWLEDGE_COLLECTION_ID,
  WIX_KNOWLEDGE_PAYLOAD_VERSION,
  buildWixArticleData,
  buildWixRichContent,
  collectMarkdownTableWarnings,
  isWixMissingItemError,
  validateWixArticle,
} from "./wixPublishing.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const normalizeType = (value) => clean(value, 100).toUpperCase().replace(/[\s-]+/g, "_");
const SAFE_LINK = /^(?:https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;

function collectionFields(payload = {}) { const collection = payload.dataCollection || payload.collection || payload; return Array.isArray(collection?.fields) ? collection.fields : []; }
function fieldKey(field = {}) { return clean(field.key || field.fieldKey || field.id, 500); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function sanitizeKnowledgeMarkdownLinks(markdown = "") {
  return String(markdown).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, anchor, url) => SAFE_LINK.test(url) ? `[${anchor}](${url})` : anchor.replace(/^\*\*|\*\*$/g, ""));
}

export function applyKnowledgeLinkSuggestions(markdown = "", suggestions = []) {
  let output = sanitizeKnowledgeMarkdownLinks(markdown);
  const loaded = [];
  const inserted = [];
  const skipped = [];

  for (const suggestion of Array.isArray(suggestions) ? suggestions : []) {
    const item = {
      id: clean(suggestion?.id, 200),
      anchor_text: clean(suggestion?.anchor_text, 500),
      destination_url: clean(suggestion?.destination_url, 3000),
    };
    loaded.push(item);

    if (!item.anchor_text) { skipped.push({ ...item, reason: "empty_anchor_text" }); continue; }
    if (!SAFE_LINK.test(item.destination_url)) { skipped.push({ ...item, reason: "unsafe_or_malformed_url" }); continue; }

    const exactLink = `[${item.anchor_text}](${item.destination_url})`;
    if (output.includes(exactLink)) {
      inserted.push({ ...item, method: "already_present" });
      continue;
    }

    const existingLinkPattern = new RegExp(`\\[([^\\]]*${escapeRegExp(item.anchor_text)}[^\\]]*)\\]\\(([^)]+)\\)`, "i");
    const existingLink = output.match(existingLinkPattern);
    if (existingLink) {
      skipped.push({ ...item, reason: "anchor_already_linked", existing_url: clean(existingLink[2], 3000) });
      continue;
    }

    const anchorPattern = new RegExp(`(^|[^\\w\\[])(${escapeRegExp(item.anchor_text)})(?=$|[^\\w])`, "i");
    if (!anchorPattern.test(output)) {
      skipped.push({ ...item, reason: "anchor_text_not_found" });
      continue;
    }

    output = output.replace(anchorPattern, (_match, prefix, anchor) => `${prefix}[${anchor}](${item.destination_url})`);
    inserted.push({ ...item, method: "inserted_into_markdown" });
  }

  return { markdown: output, accepted_suggestions_loaded: loaded, suggestions_successfully_inserted: inserted, suggestions_skipped: skipped };
}

function enrichLinkedFormatting(richContent) {
  for (const node of richContent?.nodes || []) {
    for (const textNode of node?.nodes || []) {
      const decorations = textNode?.textData?.decorations || [];
      const hasLink = decorations.some((item) => item?.type === "LINK");
      const text = String(textNode?.textData?.text || "");
      if (hasLink && /^\*\*[^*]+\*\*$/.test(text)) {
        textNode.textData.text = text.slice(2, -2);
        if (!decorations.some((item) => item?.type === "BOLD")) decorations.push({ type: "BOLD" });
      }
      if (hasLink && /^\*[^*]+\*$/.test(text)) {
        textNode.textData.text = text.slice(1, -1);
        if (!decorations.some((item) => item?.type === "ITALIC")) decorations.push({ type: "ITALIC" });
      }
    }
  }
  return richContent;
}

export function countWixLinkDecorations(richContent = {}) {
  let count = 0;
  for (const node of richContent.nodes || []) for (const child of node?.nodes || []) count += (child?.textData?.decorations || []).filter((item) => item?.type === "LINK").length;
  return count;
}

export function buildKnowledgeWixRichContent(markdown, suggestions = [], cta = "") {
  const application = applyKnowledgeLinkSuggestions(markdown, suggestions);
  const richContent = enrichLinkedFormatting(buildWixRichContent(application.markdown, [], cta));
  return { richContent, diagnostics: { ...application, final_link_decoration_count: countWixLinkDecorations(richContent) } };
}

export function resolveKnowledgeRichContentField(payload = {}, configuredFieldId = "") {
  const fields = collectionFields(payload);
  const richFields = fields.filter((field) => ["RICH_CONTENT", "RICHCONTENT"].includes(normalizeType(field.type)));
  const configured = clean(configuredFieldId, 500);
  if (configured) {
    const match = fields.find((field) => fieldKey(field).toLowerCase() === configured.toLowerCase());
    if (!match) throw new WixPublishingError("configuration", `Configured Wix Rich Content field ${configured} was not found in collection ${WIX_KNOWLEDGE_COLLECTION_ID}.`, 500, { configured_field: configured });
    if (!["RICH_CONTENT", "RICHCONTENT"].includes(normalizeType(match.type))) throw new WixPublishingError("configuration", `Configured Wix article-body field ${configured} is ${normalizeType(match.type) || "UNKNOWN"}, not Rich Content.`, 500, { configured_field: configured, field_type: normalizeType(match.type) || "UNKNOWN" });
    return fieldKey(match);
  }
  const contentField = richFields.find((field) => fieldKey(field).toLowerCase() === "content");
  if (contentField) return fieldKey(contentField);
  if (richFields.length === 1) return fieldKey(richFields[0]);
  throw new WixPublishingError("configuration", richFields.length ? `Wix collection ${WIX_KNOWLEDGE_COLLECTION_ID} has multiple Rich Content fields. Set WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID to the field bound to the live Rich Content Viewer.` : `Wix collection ${WIX_KNOWLEDGE_COLLECTION_ID} has no Rich Content field for the live article body. The plain Text content field cannot preserve hyperlinks.`, 500, { rich_content_fields: richFields.map(fieldKey).filter(Boolean) });
}

function buildRichArticleData(article, suggestions, richContentFieldId) {
  const base = buildWixArticleData(article, [], "RICH_CONTENT");
  const { content: _content, ...metadata } = base;
  const built = buildKnowledgeWixRichContent(article.content_markdown, suggestions, article.cta);
  return { data: { ...metadata, [richContentFieldId]: built.richContent }, diagnostics: built.diagnostics };
}

async function resolveExistingWixItem(client, article, excludedItemId = "") {
  const excluded = clean(excludedItemId, 500);
  const crmMatches = (await client.find("crmArticleId", article.id)).filter((item) => clean(item?.id, 500) !== excluded);
  if (crmMatches.length > 1) throw new WixPublishingError("validation", "Wix contains more than one item for this CRM article. Resolve the duplicates in Wix before retrying.", 409);
  const crmItemId = clean(crmMatches[0]?.id, 500); if (crmItemId) return crmItemId;
  const slugMatches = (await client.find("slug", article.slug)).filter((item) => clean(item?.id, 500) !== excluded);
  const conflicting = slugMatches.find((item) => clean(item?.data?.crmArticleId, 500) !== clean(article.id, 500));
  if (conflicting) throw new WixPublishingError("validation", "That slug already belongs to another Wix item. Change the article slug before retrying.", 409);
  return clean(slugMatches[0]?.id, 500);
}

export async function createOrUpdateKnowledgeRichContentDraft({ article, suggestions = [], configuration, environment = process.env, fetchImpl = fetch }) {
  validateWixArticle(article);
  const client = new WixCmsClient(configuration, fetchImpl);
  const schema = await client.request(`/wix-data/v2/collections/${encodeURIComponent(configuration.collectionId)}`);
  const richContentFieldId = resolveKnowledgeRichContentField(schema, environment.WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID);
  const built = buildRichArticleData(article, suggestions, richContentFieldId);
  const diagnostics = { ...built.diagnostics, resolved_rich_content_field_id: richContentFieldId };
  const acceptedCount = diagnostics.accepted_suggestions_loaded.length;
  if (acceptedCount > 0 && diagnostics.final_link_decoration_count === 0) {
    throw new WixPublishingError("validation", "Accepted link suggestions produced zero Wix LINK decorations. Review the skipped-link diagnostics before republishing.", 409, diagnostics);
  }
  const data = built.data;
  const tableConversionWarnings = collectMarkdownTableWarnings(diagnostics.markdown);
  let itemId = clean(article.wix_item_id, 500), operation = itemId ? "updated" : "created", missingStoredItemId = "", item;
  if (!itemId) { itemId = await resolveExistingWixItem(client, article); operation = itemId ? "updated" : "created"; }
  if (itemId) { try { item = await client.update(itemId, data); } catch (error) { if (!isWixMissingItemError(error) || !clean(article.wix_item_id, 500)) throw error; missingStoredItemId = itemId; itemId = ""; operation = "created"; } }
  if (!item && missingStoredItemId) { try { itemId = await resolveExistingWixItem(client, article, missingStoredItemId); operation = itemId ? "updated" : "created"; if (itemId) item = await client.update(itemId, data); } catch (error) { error.details = { ...(error.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true }; throw error; } }
  if (!item) { try { item = await client.create(data, article.id); } catch (error) { try { if (error.details?.wix_status !== 409) throw error; const recovered = await client.find("crmArticleId", article.id); const recoveredId = clean(recovered[0]?.id, 500) || clean(article.id, 500); operation = "updated"; item = await client.update(recoveredId, data); } catch (recoveryError) { if (missingStoredItemId) recoveryError.details = { ...(recoveryError.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true }; throw recoveryError; } } }
  const savedItemId = clean(item?.id, 500); if (!savedItemId) throw new WixPublishingError("api", "Wix did not return an item ID.", 502);
  return { operation, itemId: savedItemId, collectionId: configuration.collectionId, dashboardUrl: configuration.dashboardUrl, syncStatus: "synced", payloadVersion: `${WIX_KNOWLEDGE_PAYLOAD_VERSION}-rich-links-diagnostics`, contentFieldType: "RICH_CONTENT", contentFieldId: richContentFieldId, recoveredMissingItem: Boolean(missingStoredItemId), replacedItemId: missingStoredItemId || null, tableConversionWarnings, diagnostics, data };
}
