import { WixCmsClient } from "./wixPublishing.js";

let installed = false;

export function installWixDraftPublishPluginSupport() {
  if (installed) return;
  installed = true;

  WixCmsClient.prototype.find = async function (field, value) {
    const payload = await this.request("/wix-data/v2/items/query", {
      method: "POST",
      body: {
        dataCollectionId: this.configuration.collectionId,
        publishPluginOptions: { includeDraftItems: true },
        consistentRead: true,
        query: { filter: { [field]: { $eq: value } }, paging: { limit: 2 } },
      },
    });
    return payload.dataItems || [];
  };

  WixCmsClient.prototype.update = async function (itemId, data) {
    const payload = await this.request(`/wix-data/v2/items/${encodeURIComponent(itemId)}`, {
      method: "PUT",
      body: {
        dataCollectionId: this.configuration.collectionId,
        publishPluginOptions: { includeDraftItems: true },
        dataItem: { id: itemId, data },
      },
    });
    return payload.dataItem;
  };
}

installWixDraftPublishPluginSupport();
