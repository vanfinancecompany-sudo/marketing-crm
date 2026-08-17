import { WixCmsClient, WixPublishingError } from "./wixPublishing.js";

const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const normalizePluginType = (value) => clean(value, 100).toUpperCase().replace(/[\s-]+/g, "_");

function collectionPayload(payload = {}) {
  return payload.dataCollection || payload.collection || payload;
}

export function resolveWixDraftItemsCollectionId(payload = {}, publishedCollectionId = "") {
  const collection = collectionPayload(payload);
  const plugin = (Array.isArray(collection?.plugins) ? collection.plugins : [])
    .find((item) => normalizePluginType(item?.type) === "DRAFT_ITEMS");
  const draftsCollectionId = clean(
    plugin?.draftItemsOptions?.draftsCollectionId ||
    plugin?.draftItemsPluginOptions?.draftsCollectionId,
    500
  );
  if (!draftsCollectionId) {
    throw new WixPublishingError(
      "configuration",
      `Wix collection ${clean(publishedCollectionId, 500) || "Knowledge Hub"} is not configured for Save changes as draft first. Refusing to write Knowledge Hub content directly to the live collection.`,
      409,
      { published_collection_id: clean(publishedCollectionId, 500), draft_items_plugin_found: Boolean(plugin) }
    );
  }
  return draftsCollectionId;
}

export function wixClientForCollection(client, collectionId) {
  return new WixCmsClient({ ...client.configuration, collectionId: clean(collectionId, 500) }, client.fetchImpl);
}

export async function createWixDraftFromPublished(client, itemId) {
  const payload = await client.request("/wix-data/v2/items/create-draft", {
    method: "POST",
    body: {
      dataCollectionId: client.configuration.collectionId,
      dataItemId: clean(itemId, 500),
    },
  });
  return payload.dataItem;
}
