const systemFields = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_publishStatus", "_publishDate", "_draftDate"]);
const temporaryStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export function stablePublishValue(value) {
  if (Array.isArray(value)) return value.map(stablePublishValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stablePublishValue(value[key])]));
}

export function samePublishValue(left, right) {
  return JSON.stringify(stablePublishValue(left)) === JSON.stringify(stablePublishValue(right));
}

export function vehicleRecordFields(item) {
  return Object.fromEntries(Object.entries(item?.data || {}).filter(([key]) => !systemFields.has(key)));
}

export function temporaryPublishError(error) {
  return !error?.details?.manualAttentionRequired && !error?.details?.code &&
    (error instanceof TypeError || temporaryStatuses.has(Number(error?.details?.wixStatus || error?.status)));
}

export async function retryTemporaryPublishOperation(run, {
  retry = temporaryPublishError,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  delays = [350, 900],
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= delays.length || !retry(error)) throw error;
      const delay = error?.details?.retryAfterMs;
      if (delay > 3000) throw error;
      await wait(Math.max(delays[attempt], delay || 0));
    }
  }
}

// An existing listing owns its route and references. Explicit price, copy and
// photo changes still use the approved DealerKit payload.
export function preserveVehicleRoutes(data, previous = {}) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [
    key,
    /^(?:title|slug|url|.*(?:link|url|slug)|applicationForm|seo.*)$/i.test(key) && previous[key]
      ? previous[key] : value,
  ]));
}
