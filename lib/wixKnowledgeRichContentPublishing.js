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
import {
  createWixDraftFromPublished,
  resolveWixDraftItemsCollectionId,
  wixClientForCollection,
} from "./wixDraftPublishPluginSupport.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const normalizeType = (value) => clean(value, 100).toUpperCase().replace(/[\s-]+/g, "_");
const SAFE_LINK = /^(?:https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i;
const NEXT_STEP_HEADING = /(?:^|\n)#{1,6}\s+Next steps?\s*(?=\n|$)/i;

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
  const ctaForRenderer = NEXT_STEP_HEADING.test(application.markdown) ? "" : cta;
  const richContent = enrichLinkedFormatting(buildWixRichContent(application.markdown, [], ctaForRenderer));
  const finalLinkDecorationCount = countWixLinkDecorations(richContent);
  return {
    richContent,
    diagnostics: {
      ...application,
      final_link_decoration_count: finalLinkDecorationCount,
      contextual_links_optional: true,
      duplicate_next_step_prevented: Boolean(clean(cta, 2000) && !ctaForRenderer),
      contextual_link_warning:
        application.accepted_suggestions_loaded.length > 0 && finalLinkDecorationCount === 0
          ? "Accepted contextual-link suggestions did not match the current article and were skipped. The article was published without those optional links."
          : "",
    },
  };
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

async function findExistingWixItem(client, article, excludedItemId = "") {
  const excluded = clean(excludedItemId, 500);
  const crmMatches = (await client.find("crmArticleId", article.id)).filter((item) => clean(item?.id, 500) !== excluded);
  if (crmMatches.length > 1) throw new WixPublishingError("validation", "Wix contains more than one item for this CRM article. Resolve the duplicates in Wix before retrying.", 409);
  if (crmMatches[0]) return crmMatches[0];
  const slugMatches = (await client.find("slug", article.slug)).filter((item) => clean(item?.id, 500) !== excluded);
  const conflicting = slugMatches.find((item) => clean(item?.data?.crmArticleId, 500) !== clean(article.id, 500));
  if (conflicting) throw new WixPublishingError("validation", "That slug already belongs to another Wix item. Change the article slug before retrying.", 409);
  return slugMatches[0] || null;
}

async function resolveExistingWixItem(client, article, excludedItemId = "") {
  return clean((await findExistingWixItem(client, article, excludedItemId))?.id, 500);
}

function preserveManualWixFields(data, existingItem) {
  const featuredImage = clean(existingItem?.data?.featuredImage, 3000);
  if (!clean(data?.featuredImage, 3000) && featuredImage) return { ...data, featuredImage };
  return data;
}

async function seedPublishedItemIntoDrafts(publishedClient, draftClient, article, publishedItemId) {
  try {
    const createdDraft = await createWixDraftFromPublished(publishedClient, publishedItemId);
    return createdDraft || await findExistingWixItem(draftClient, article);
  } catch (error) {
    const recoveredDraft = await findExistingWixItem(draftClient, article).catch(() => null);
    if (recoveredDraft) return recoveredDraft;
    throw error;
  }
}

export async function createOrUpdateKnowledgeRichContentDraft({ article, suggestions = [], configuration, environment = process.env, fetchImpl = fetch }) {
  validateWixArticle(article);
  const publishedClient = new WixCmsClient(configuration, fetchImpl);
  const schema = await publishedClient.request(`/wix-data/v2/collections/${encodeURIComponent(configuration.collectionId)}`);
  const richContentFieldId = resolveKnowledgeRichContentField(schema, environment.WIX_KNOWLEDGE_RICH_CONTENT_FIELD_ID);
  const draftCollectionId = resolveWixDraftItemsCollectionId(schema, configuration.collectionId);
  const draftClient = wixClientForCollection(publishedClient, draftCollectionId);
  const built = buildRichArticleData(article, suggestions, richContentFieldId);
  const diagnostics = {
    ...built.diagnostics,
    resolved_rich_content_field_id: richContentFieldId,
    published_collection_id: configuration.collectionId,
    drafts_collection_id: draftCollectionId,
  };
  const data = built.data;
  const tableConversionWarnings = collectMarkdownTableWarnings(diagnostics.markdown);

  let draftRecord = await findExistingWixItem(draftClient, article);
  let itemId = clean(draftRecord?.id, 500);
  let operation = itemId ? "updated" : "created";
  let serverState = "DRAFT";
  let item;

  if (!itemId) {
    const publishedRecord = await findExistingWixItem(publishedClient, article);
    let publishedItemId = clean(publishedRecord?.id, 500);
    if (!publishedItemId && clean(article.wix_item_id, 500)) {
      try {
        draftRecord = await seedPublishedItemIntoDrafts(publishedClient, draftClient, article, clean(article.wix_item_id, 500));
        itemId = clean(draftRecord?.id, 500) || clean(article.wix_item_id, 500);
        operation = "updated";
        serverState = "CHANGED";
      } catch (error) {
        if (!isWixMissingItemError(error)) throw error;
      }
    }
    if (!itemId && publishedItemId) {
      draftRecord = await seedPublishedItemIntoDrafts(publishedClient, draftClient, article, publishedItemId);
      itemId = clean(draftRecord?.id, 500) || publishedItemId;
      operation = "updated";
      serverState = "CHANGED";
    }
  } else {
    const publishedRecord = await findExistingWixItem(publishedClient, article).catch(() => null);
    if (publishedRecord) serverState = "CHANGED";
  }

  if (itemId) {
    if (!draftRecord || clean(draftRecord?.id, 500) !== itemId) draftRecord = await findExistingWixItem(draftClient, article).catch(() => null);
    const updateData = preserveManualWixFields(data, draftRecord);
    diagnostics.preserved_manual_featured_image = Boolean(!clean(data.featuredImage, 3000) && clean(draftRecord?.data?.featuredImage, 3000));
    item = await draftClient.update(itemId, updateData);
  } else {
    try {
      item = await draftClient.create(data, article.id);
    } catch (error) {
      if (error.details?.wix_status !== 409) throw error;
      draftRecord = await findExistingWixItem(draftClient, article);
      const recoveredDraftId = clean(draftRecord?.id, 500);
      if (!recoveredDraftId) throw error;
      operation = "updated";
      itemId = recoveredDraftId;
      const updateData = preserveManualWixFields(data, draftRecord);
      diagnostics.preserved_manual_featured_image = Boolean(!clean(data.featuredImage, 3000) && clean(draftRecord?.data?.featuredImage, 3000));
      item = await draftClient.update(recoveredDraftId, updateData);
    }
  }

  const savedItemId = clean(item?.id, 500) || clean(itemId, 500);
  if (!savedItemId) throw new WixPublishingError("api", "Wix did not return an item ID.", 502);
  return {
    operation,
    itemId: savedItemId,
    collectionId: configuration.collectionId,
    draftCollectionId,
    dashboardUrl: configuration.dashboardUrl,
    syncStatus: "synced",
    serverState,
    payloadVersion: `${WIX_KNOWLEDGE_PAYLOAD_VERSION}-real-draft-surface`,
    contentFieldType: "RICH_CONTENT",
    contentFieldId: richContentFieldId,
    recoveredMissingItem: false,
    replacedItemId: null,
    tableConversionWarnings,
    diagnostics,
    data,
  };
}
