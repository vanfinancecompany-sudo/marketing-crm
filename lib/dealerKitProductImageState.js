export const DEALERKIT_PRODUCT_IMAGE_MARKERS = Object.freeze({
  finance: "__VFC_PRODUCT_IMAGES__",
  rent2buy: "__R2B_PRODUCT_IMAGES__",
});

const PRODUCT_KEYS = Object.freeze(["finance", "rent2buy"]);
const MARKER_SET = new Set(Object.values(DEALERKIT_PRODUCT_IMAGE_MARKERS));

function clean(value, limit = 300) {
  return String(value ?? "").trim().slice(0, limit);
}

function unique(values = []) {
  const result = [];
  for (const raw of values) {
    const value = clean(raw);
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function hasProductMarkers(values = []) {
  return (Array.isArray(values) ? values : []).some((value) => MARKER_SET.has(clean(value)));
}

function splitProductSections(values = []) {
  const sections = { finance: [], rent2buy: [] };
  let current = null;
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw);
    if (!value) continue;
    const product = PRODUCT_KEYS.find((key) => DEALERKIT_PRODUCT_IMAGE_MARKERS[key] === value);
    if (product) {
      current = product;
      continue;
    }
    if (current) sections[current].push(value);
  }
  return sections;
}

function legacyValues(values = []) {
  return unique((Array.isArray(values) ? values : []).filter((value) => !MARKER_SET.has(clean(value))));
}

function orderedAgainstSource(values, sourceIds) {
  const sourceSet = new Set(sourceIds);
  const ordered = unique(values).filter((id) => sourceSet.has(id));
  for (const id of sourceIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function decodeDealerKitProductImageState(decision = {}, rawSourceIds = []) {
  const sourceIds = unique(rawSourceIds);
  const rawOrder = Array.isArray(decision.imageOrderIds) ? decision.imageOrderIds : [];
  const rawExcluded = Array.isArray(decision.excludedImageIds) ? decision.excludedImageIds : [];
  const splitOrder = hasProductMarkers(rawOrder);
  const splitExcluded = hasProductMarkers(rawExcluded);
  const split = splitOrder || splitExcluded;

  const legacyOrder = orderedAgainstSource(legacyValues(rawOrder), sourceIds);
  const legacyExcluded = new Set(legacyValues(rawExcluded).filter((id) => sourceIds.includes(id)));
  const orderSections = splitOrder ? splitProductSections(rawOrder) : null;
  const excludedSections = splitExcluded ? splitProductSections(rawExcluded) : null;

  const products = {};
  for (const product of PRODUCT_KEYS) {
    const orderIds = splitOrder
      ? orderedAgainstSource(orderSections[product], sourceIds)
      : [...legacyOrder];
    const excludedIds = splitExcluded
      ? unique(excludedSections[product]).filter((id) => sourceIds.includes(id))
      : Array.from(legacyExcluded);
    const excludedSet = new Set(excludedIds);
    const includedOrderIds = orderIds.filter((id) => !excludedSet.has(id));
    products[product] = {
      orderIds,
      excludedIds,
      includedOrderIds,
    };
  }

  const requestedFinancePrimary = clean(decision.primaryImageId);
  const financePrimaryId = requestedFinancePrimary
    && products.finance.includedOrderIds.includes(requestedFinancePrimary)
    ? requestedFinancePrimary
    : products.finance.includedOrderIds[0] || null;

  return {
    split,
    sourceIds,
    finance: { ...products.finance, primaryId: financePrimaryId },
    rent2buy: { ...products.rent2buy, primaryId: products.rent2buy.includedOrderIds[0] || null },
  };
}

export function encodeDealerKitProductImageState(state = {}) {
  const financeOrder = unique(state.finance?.orderIds);
  const rent2buyOrder = unique(state.rent2buy?.orderIds);
  const financeExcluded = unique(state.finance?.excludedIds);
  const rent2buyExcluded = unique(state.rent2buy?.excludedIds);
  const financeIncluded = financeOrder.filter((id) => !financeExcluded.includes(id));
  const requestedPrimary = clean(state.finance?.primaryId);
  const primaryImageId = requestedPrimary && financeIncluded.includes(requestedPrimary)
    ? requestedPrimary
    : financeIncluded[0] || null;

  return {
    imageOrderIds: [
      DEALERKIT_PRODUCT_IMAGE_MARKERS.finance,
      ...financeOrder,
      DEALERKIT_PRODUCT_IMAGE_MARKERS.rent2buy,
      ...rent2buyOrder,
    ],
    excludedImageIds: [
      DEALERKIT_PRODUCT_IMAGE_MARKERS.finance,
      ...financeExcluded,
      DEALERKIT_PRODUCT_IMAGE_MARKERS.rent2buy,
      ...rent2buyExcluded,
    ],
    primaryImageId,
  };
}

export function productIncludedDealerKitImageIds(decision = {}, rawSourceIds = [], { includeRent2Buy = true } = {}) {
  const state = decodeDealerKitProductImageState(decision, rawSourceIds);
  const ids = [...state.finance.includedOrderIds];
  if (includeRent2Buy) {
    for (const id of state.rent2buy.includedOrderIds) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}
