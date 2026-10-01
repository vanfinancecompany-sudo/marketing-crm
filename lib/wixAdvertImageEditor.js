import { VAN_FINANCE_WIX_COLLECTIONS } from "./vanscoWixPrice.js";
import { convertWixImage } from "../services/marketingVehicleContract.js";

export const WIX_ADVERT_IMAGE_LANES = Object.freeze({
  finance: { label: "Finance", listing: "VANFINANCE-ALLVANS", detail: "VANFINANCEPAGES", gallery: "mainImages", count: "imageCount" },
  rent2buy: { label: "Rent2Buy", listing: "ALLRENT2BUYVANS", detail: "VANPAGES", gallery: "mediaGallery", count: "numberOfImages" },
  cars: { label: "Cars", listing: "CARFINANCE", detail: "CARPAGES", gallery: "mainImages", count: "numberOfImages" },
});

// Published category card fields in the same authoritative CMS; no review/source-stock dependency.
export const WIX_ADVERT_CATEGORY_IMAGE_FIELDS = Object.freeze({
  finance: Object.freeze(Object.fromEntries(VAN_FINANCE_WIX_COLLECTIONS
    .filter((collection) => collection.kind === "listing" && collection.id !== "VANFINANCE-ALLVANS")
    .map((collection) => [collection.id, "picture"]))),
  rent2buy: Object.freeze({
    SmallVans: "picture", MEDIUMVANS: "picture", LWBVANS: "picture", CREWVANS: "image",
    AUTOMATICVANS: "picture", ELECTRICVANS: "picture", PICKUPS: "picture", "TIPPERS-LUTONS-DROPSDIES": "picture",
  }),
  cars: Object.freeze({}),
});

export function wixGalleryImageSource(value) {
  if (value && typeof value === "object" && value.type && String(value.type).toLowerCase() !== "image") return "";
  const source = typeof value === "string" ? value : value?.src || value?.url || "";
  return typeof source === "string" && /^(https?:\/\/|wix:image:\/\/)/i.test(source) ? source : "";
}

export function createWixImageDraft(snapshot) {
  return { snapshot, items: snapshot.gallery.map((entry, index) => ({
    key: "existing-" + index, kind: "existing", index, src: convertWixImage(wixGalleryImageSource(entry)),
  })), confirmation: null };
}

export function appendWixImage(draft, uploaded) {
  draft.items.push({ key: "upload-" + uploaded.fileId, kind: "upload", token: uploaded.token, src: uploaded.url });
  draft.confirmation = null;
}

export function moveWixImage(draft, key, targetKey) {
  const from = draft.items.findIndex((item) => item.key === key);
  const to = draft.items.findIndex((item) => item.key === targetKey);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = draft.items.splice(from, 1);
  draft.items.splice(to, 0, item);
  draft.confirmation = null;
}

export function removeWixImage(draft, key) {
  draft.items = draft.items.filter((item) => item.key !== key);
  draft.confirmation = null;
}

export function wixImageProposal(draft) {
  return { baseline: draft.snapshot.baseline, images: draft.items.map((item) => item.kind === "existing"
    ? { kind: "existing", index: item.index } : { kind: "upload", token: item.token }) };
}
