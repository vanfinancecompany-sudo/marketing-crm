import {
  WixCmsClient,
  WixPublishingError,
  WIX_KNOWLEDGE_COLLECTION_ID,
  WIX_KNOWLEDGE_PAYLOAD_VERSION,
  applyAcceptedInternalLinks,
  buildWixArticleData,
  buildWixRichContent,
  collectMarkdownTableWarnings,
  isWixMissingItemError,
  validateWixArticle,
} from "./wixPublishing.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const normalizeType = (value) => clean(value, 100).toUpperCase().replace(/[\s-]+/g, "_");

function collectionFields(payload = {}) {
  const collection = payload.dataCollection || payload.collection || payload;
  return Array.isArray(collection?.fields) ? collection.fields : [];
}

function fieldKey(field = {}) {
  return clean(field.key || field.fieldKey || field.id, 500);
}

export function resolveKnowledgeRichContentField(payload = {}, configuredFieldId = "") {
  const fields = collectionFields(payload);
  const richFields = fields.filter((field) => ["RICH_CONTENT", "RICHCONTENT"].includes(normalizeType(field.type)));
  const configured = clean(configuredFieldId, 500);

  if (configured) {
    const match = fields.find((field) => fieldKey(field).toLowerCase() === configured.toLowerCase());
    if (!match) {
      throw new WixPublishingError(
        "configuration",
        `Configured Wix Rich Content field ${configured} was not found in collection ${WIX_KNOWLEDGE_COLLECTION_ID}.`,
        500,
        { configured_field: configured }
      );
    }
    if (!["RICH_CONTENT", "RICHCONTENT"].includes(normalizeType(match.type))) {
      throw new WixPublishingError(
        "configuration",
        `Configured Wix article-body field ${configured} is ${normalizeType(match.type) || "UNKNOWN"}, not Rich Content.`,
        500,
        { configured_field: configured, field_type: normalizeType(match.type) || "UNKNOWN" }
      );
    }
    return fieldKey(match);
  }

  const contentField = richFields.find((field) => fieldKey(field).toLowerCase() === "content");
  if (contentField) return fieldKey(contentField);
  if (richFields.length === 1) return fieldKey(richFields[0]);

  throw new WixPublishingError(
    "configuration",
    richFields.length
      ? `Wix collection ${WIX_KNOWLEDGE_COLLECTION_ID} has multiple Rich Content fields. Set WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID to the field bound to the live Rich Content Viewer.`
      : `Wix collection ${WIX_KNOWLEDGE_COLLECTION_ID} has no Rich Content field for the live article body. The plain Text content field cannot preserve hyperlinks.`,
    500,
    { rich_content_fields: richFields.map(fieldKey).filter(Boolean) }
  );
}

function buildRichArticleData(article, suggestions, richContentFieldId) {
  const base = buildWixArticleData(article, suggestions, "RICH_CONTENT");
  const { content, ...metadata } = base;
  return {
    ...metadata,
    [richContentFieldId]: content || buildWixRichContent(article.content_markdown, suggestions, article.cta),
  };
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

export async function createOrUpdateKnowledgeRichContentDraft({
  article,
  suggestions = [],
  configuration,
  environment = process.env,
  fetchImpl = fetch,
}) {
  validateWixArticle(article);
  const client = new WixCmsClient(configuration, fetchImpl);
  const schema = await client.request(`/wix-data/v2/collections/${encodeURIComponent(configuration.collectionId)}`);
  const richContentFieldId = resolveKnowledgeRichContentField(schema, environment.WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID);
  const data = buildRichArticleData(article, suggestions, richContentFieldId);
  const linkedMarkdown = applyAcceptedInternalLinks(article.content_markdown, suggestions);
  const tableConversionWarnings = collectMarkdownTableWarnings(linkedMarkdown);

  let itemId = clean(article.wix_item_id, 500);
  let operation = itemId ? "updated" : "created";
  let missingStoredItemId = "";
  let item;

  if (!itemId) {
    itemId = await resolveExistingWixItem(client, article);
    operation = itemId ? "updated" : "created";
  }

  if (itemId) {
    try {
      item = await client.update(itemId, data);
    } catch (error) {
      if (!isWixMissingItemError(error) || !clean(article.wix_item_id, 500)) throw error;
      missingStoredItemId = itemId;
      itemId = "";
      operation = "created";
    }
  }

  if (!item && missingStoredItemId) {
    try {
      itemId = await resolveExistingWixItem(client, article, missingStoredItemId);
      operation = itemId ? "updated" : "created";
      if (itemId) item = await client.update(itemId, data);
    } catch (error) {
      error.details = { ...(error.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true };
      throw error;
    }
  }

  if (!item) {
    try {
      item = await client.create(data, article.id);
    } catch (error) {
      try {
        if (error.details?.wix_status !== 409) throw error;
        const recovered = await client.find("crmArticleId", article.id);
        const recoveredId = clean(recovered[0]?.id, 500) || clean(article.id, 500);
        operation = "updated";
        item = await client.update(recoveredId, data);
      } catch (recoveryError) {
        if (missingStoredItemId) recoveryError.details = { ...(recoveryError.details || {}), stale_wix_item_id: missingStoredItemId, clear_stored_item_id: true };
        throw recoveryError;
      }
    }
  }

  const savedItemId = clean(item?.id, 500);
  if (!savedItemId) throw new WixPublishingError("api", "Wix did not return an item ID.", 502);

  return {
    operation,
    itemId: savedItemId,
    collectionId: configuration.collectionId,
    dashboardUrl: configuration.dashboardUrl,
    syncStatus: "synced",
    payloadVersion: `${WIX_KNOWLEDGE_PAYLOAD_VERSION}-rich-links`,
    contentFieldType: "RICH_CONTENT",
    contentFieldId: richContentFieldId,
    recoveredMissingItem: Boolean(missingStoredItemId),
    replacedItemId: missingStoredItemId || null,
    tableConversionWarnings,
    data,
  };
}
